importScripts("capture.js");
let generation = 0, busy = false;
const allowedSource = value => {
  try { const u = new URL(value); return u.origin === "https://playtomic.com" && /^\/clubs\/[a-z0-9-]+$/.test(u.pathname) && !u.search && !u.hash; }
  catch { return false; }
};
const receiverAllowed = sender => {
  try { const u = new URL(sender.url); return u.origin === "http://localhost:8765" && u.pathname === "/personal-sources.html" && sender.frameId === 0; }
  catch { return false; }
};
async function revoke() {
  generation++;
  await chrome.storage.local.remove("approvedSource");
  await chrome.storage.session.clear();
  return {status:"disconnected"};
}
async function approve(sender) {
  // Only our packaged popup may approve a tab; web pages cannot issue consent.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) throw Error("Use the extension popup to connect.");
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  const u = new URL(tab?.url || "about:blank");
  const source = u.origin + u.pathname;
  if (!allowedSource(source)) throw Error("Open an official Playtomic club page first.");
  await revoke();
  await chrome.storage.local.set({approvedSource:source});
  // A top-frame localhost URL is not an authentication factor: other local
  // applications can bind the same port. The user must pair the page with an
  // unguessable short-lived companion capability shown only in this popup.
  const pairingKey = crypto.randomUUID();
  await chrome.storage.session.set({approvedTab:tab.id,pairingKey});
  return {status:"connected",sourceUrl:source,pairingKey};
}
async function read() {
  if (busy) throw Error("A read is already running.");
  busy = true;
  const epoch = generation;
  try {
    const {approvedSource} = await chrome.storage.local.get("approvedSource");
    const {approvedTab,lastAttempt=0} = await chrome.storage.session.get(["approvedTab","lastAttempt"]);
    if (!allowedSource(approvedSource) || !Number.isInteger(approvedTab)) throw Error("Connect the club again from its extension popup.");
    if (Date.now() - lastAttempt < 60000) throw Error("Wait 60 seconds between reads.");
    const tab = await chrome.tabs.get(approvedTab);
    const u = new URL(tab.url);
    if (u.origin + u.pathname !== approvedSource || !allowedSource(u.origin+u.pathname)) throw Error("Approved tab changed. Reconnect explicitly.");
    await chrome.storage.session.set({lastAttempt:Date.now()});
    if (epoch !== generation) throw Error("Consent withdrawn.");
    const results = await chrome.scripting.executeScript({target:{tabId:approvedTab},func:capturePlaytomic});
    const result = results.find(r => r.frameId === 0)?.result;
    if (epoch !== generation) throw Error("Consent withdrawn during read.");
    if (!result || result.sourceUrl !== approvedSource) throw Error("Approved source changed during read.");
    return {status:"observed",observation:result};
  } finally { busy = false; }
}
async function handle(message,sender,external) {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw Error("Unsupported request.");
  const allowed = external ? new Set(["action","pairingKey"]) : new Set(["action"]);
  if (Object.keys(message).some(k => !allowed.has(k))) throw Error("Unsupported request.");
  if (external) {
    if (!receiverAllowed(sender)) throw Error("Only the local GetACourt personal-sources page may read.");
    const {pairingKey} = await chrome.storage.session.get("pairingKey");
    if (typeof pairingKey !== "string" || !/^[0-9a-f-]{36}$/.test(pairingKey) ||
        typeof message.pairingKey !== "string" || message.pairingKey !== pairingKey)
      throw Error("Companion not paired. Reconnect in the extension popup.");
  } else if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) {
    throw Error("Unsupported sender.");
  }
  if (message.action === "revoke") return revoke();
  if (message.action === "read") return read();
  if (!external && message.action === "approve") return approve(sender);
  throw Error("Unsupported action.");
}
function listener(external) {
  return (message,sender,reply) => {
    handle(message,sender,external).then(reply).catch(() => reply({status:"unavailable",error:"Read unavailable. Open the approved club, expand an offer, or reconnect from the extension popup. Reads require a 60-second interval."}));
    return true;
  };
}
chrome.runtime.onMessage.addListener(listener(false));
chrome.runtime.onMessageExternal.addListener(listener(true));
