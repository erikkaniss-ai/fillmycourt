document.getElementById("identity").textContent = chrome.runtime.id;
for (const action of ["approve","revoke"]) document.getElementById(action).addEventListener("click",async () => {
  const r = await chrome.runtime.sendMessage({action});
  document.getElementById("status").textContent = r.status === "connected" ? "Club allowed. Open local GetACourt to read." : r.status === "disconnected" ? "Disconnected." : r.error;
});
