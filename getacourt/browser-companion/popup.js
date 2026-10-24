document.getElementById("identity").textContent = chrome.runtime.id;
for (const action of ["approve","revoke"]) document.getElementById(action).addEventListener("click",async () => {
  const r = await chrome.runtime.sendMessage({action});
  const paired = r.status === "connected" && typeof r.pairingKey === "string" && /^[0-9a-f-]{36}$/.test(r.pairingKey);
  document.getElementById("pairingHelp").hidden = !paired;
  document.getElementById("pairingValue").hidden = !paired;
  document.getElementById("pairingKey").textContent = paired ? r.pairingKey : "";
  document.getElementById("status").textContent = paired
    ? "Club allowed. Pair with local GetACourt using the code below."
    : r.status === "disconnected" ? "Disconnected." : r.error || "Companion unavailable.";
});
