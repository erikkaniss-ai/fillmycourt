importScripts("capture.js");
let generation = 0, busy = false;
// Only these fixed messages may leave the companion. Never forward browser,
// provider or thrown-error text, which could contain account data or secrets.
const readerErrors = Object.freeze({
  REQUEST_REJECTED: "This request is not allowed. Use the local GetACourt reader page.",
  PAIRING_REQUIRED: "Pairing code missing or expired. Use Allow this club in the Playtomic extension popup, then enter its new code in local GetACourt.",
  CONNECT_REQUIRED: "No club tab is connected. Open the Playtomic club and use Allow this club in the extension popup.",
  CLUB_PAGE_REQUIRED: "Open an official Playtomic club page before allowing this club.",
  READ_BUSY: "A read is already running. Wait for it to finish.",
  RATE_LIMITED: "Wait 60 seconds after the previous read attempt, then press Read once. No automatic retry will run.",
  TAB_CHANGED: "The approved tab changed club. Reconnect from the intended club using the extension popup.",
  TAB_ACCESS_REQUIRED: "Chrome cannot read the approved tab. Keep it open and renew Allow this club in its extension popup.",
  CONSENT_WITHDRAWN: "Access was disconnected during this read. No offers were shared.",
  OFFER_SECTION_MISSING: "The visible English Available courts section was not found. Open the club schedule; other page layouts are not supported yet.",
  DATE_AMBIGUOUS: "The selected date could not be read unambiguously. No offers were shared.",
  SPORT_AMBIGUOUS: "The selected sport could not be read unambiguously. Select Padel or Tennis in the English club schedule.",
  VENUE_MISSING: "The club name could not be read. No offers were shared.",
  NO_EXPANDED_OFFERS: "No explicit offer is expanded. The reader currently supports the English mobile court/time accordion: expand a court and time until duration, price and Book are visible. Do not press Book.",
  OFFER_FORMAT_CHANGED: "The expanded offer layout is not supported. No availability was inferred or shared.",
  TOO_MANY_OFFERS: "Expand at most 20 offers before reading.",
  READ_FAILED: "The read could not be completed. No offers were shared. Keep the club tab open and check the visible schedule."
});
const readerFailure = code => { throw Object.assign(new Error("Personal reader unavailable"), {readerCode:code}); };
function unavailable(error) {
  const code = Object.hasOwn(readerErrors, error?.readerCode) ? error.readerCode : "READ_FAILED";
  return {status:"unavailable",code,error:readerErrors[code]};
}
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
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) readerFailure("REQUEST_REJECTED");
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  const u = new URL(tab?.url || "about:blank");
  const source = u.origin + u.pathname;
  if (!allowedSource(source)) readerFailure("CLUB_PAGE_REQUIRED");
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
  if (busy) readerFailure("READ_BUSY");
  busy = true;
  const epoch = generation;
  try {
    const {approvedSource} = await chrome.storage.local.get("approvedSource");
    const {approvedTab,lastAttempt=0} = await chrome.storage.session.get(["approvedTab","lastAttempt"]);
    if (!allowedSource(approvedSource) || !Number.isInteger(approvedTab)) readerFailure("CONNECT_REQUIRED");
    if (Date.now() - lastAttempt < 60000) readerFailure("RATE_LIMITED");
    let tab;
    try { tab = await chrome.tabs.get(approvedTab); }
    catch { readerFailure("TAB_ACCESS_REQUIRED"); }
    const u = new URL(tab.url);
    if (u.origin + u.pathname !== approvedSource || !allowedSource(u.origin+u.pathname)) readerFailure("TAB_CHANGED");
    await chrome.storage.session.set({lastAttempt:Date.now()});
    if (epoch !== generation) readerFailure("CONSENT_WITHDRAWN");
    let results;
    try { results = await chrome.scripting.executeScript({target:{tabId:approvedTab},func:capturePlaytomic}); }
    catch { readerFailure(epoch !== generation ? "CONSENT_WITHDRAWN" : "TAB_ACCESS_REQUIRED"); }
    const result = results.find(r => r.frameId === 0)?.result;
    if (epoch !== generation) readerFailure("CONSENT_WITHDRAWN");
    if (result?.readerError) readerFailure(result.readerError);
    if (!result) readerFailure("READ_FAILED");
    if (result.sourceUrl !== approvedSource) readerFailure("TAB_CHANGED");
    return {status:"observed",observation:result};
  } finally { busy = false; }
}
async function handle(message,sender,external) {
  if (!message || typeof message !== "object" || Array.isArray(message)) readerFailure("REQUEST_REJECTED");
  const allowed = external ? new Set(["action","pairingKey"]) : new Set(["action"]);
  if (Object.keys(message).some(k => !allowed.has(k))) readerFailure("REQUEST_REJECTED");
  if (external) {
    if (!receiverAllowed(sender)) readerFailure("REQUEST_REJECTED");
    const {pairingKey} = await chrome.storage.session.get("pairingKey");
    if (typeof pairingKey !== "string" || !/^[0-9a-f-]{36}$/.test(pairingKey) ||
        typeof message.pairingKey !== "string" || message.pairingKey !== pairingKey)
      readerFailure("PAIRING_REQUIRED");
  } else if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) {
    readerFailure("REQUEST_REJECTED");
  }
  if (message.action === "revoke") return revoke();
  if (message.action === "read") return read();
  if (!external && message.action === "approve") return approve(sender);
  readerFailure("REQUEST_REJECTED");
}
function listener(external) {
  return (message,sender,reply) => {
    handle(message,sender,external).then(reply).catch(error => reply(unavailable(error)));
    return true;
  };
}
chrome.runtime.onMessage.addListener(listener(false));
chrome.runtime.onMessageExternal.addListener(listener(true));
