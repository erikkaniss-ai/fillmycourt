(() => {
  const byId = id => document.getElementById(id);
  const validateObservation = globalThis.GetACourtPersonalSourceObservation?.validateObservation;
  const local = location.origin === "http://localhost:8765";
  let epoch = 0, pending = false, expiry;
  byId("environment").textContent = local ? "Local browser mode. Connect your club using the companion popup." : "Inactive here. Use http://localhost:8765/personal-sources.html in Chrome or Edge with the companion installed.";
  byId("read").disabled = byId("disconnect").disabled = !local;
  function clear() { clearTimeout(expiry); byId("results").replaceChildren(); }
  const identity = () => {
    const id = byId("extension").value.trim();
    if (!/^[a-p]{32}$/.test(id)) throw Error("Enter the extension ID shown in its popup.");
    if (!globalThis.chrome?.runtime?.sendMessage) throw Error("Browser companion unavailable. Use Chrome or Edge.");
    return id;
  };
  byId("read").addEventListener("click",async () => {
    if (!local || pending) return;
    pending = true; const current = ++epoch; clear();
    try {
      const result = await chrome.runtime.sendMessage(identity(),{action:"read"});
      if (current !== epoch) return;
      if (result?.status !== "observed") throw Error(result?.error || "Source unavailable.");
      if (typeof validateObservation !== "function") throw Error("Local source validation unavailable.");
      // Treat even the companion response as untrusted text. No HTML, links or
      // actions from offers are accepted, and only the Playtomic companion's
      // narrow rendered-row schema may reach this temporary view.
      const o = validateObservation(result.observation);
      byId("status").textContent = `${o.venue} · ${o.date} · ${o.sport}. Captured ${o.capturedAt}. Source freshness unknown.`;
      for (const offer of o.offers) {
        const article = document.createElement("article");
        article.textContent = `${offer.court}: ${offer.startLabel}–${offer.endLabel} · ${offer.durationMinutes} min · €${offer.priceEur}`;
        byId("results").append(article);
      }
      expiry = setTimeout(() => { ++epoch; clear(); byId("status").textContent = "Observation expired. Recheck the provider and read again."; },60000);
    } catch (e) { if (current === epoch) byId("status").textContent = e.message; }
    finally { pending = false; }
  });
  byId("disconnect").addEventListener("click",async () => {
    ++epoch; clear(); byId("status").textContent = "Local view cleared. Disconnecting companion…";
    try {
      const r = await chrome.runtime.sendMessage(identity(),{action:"revoke"});
      if (r?.status !== "disconnected") throw Error("Revoke unavailable");
      byId("extension").value = ""; byId("status").textContent = "Disconnected. Club preference removed.";
    } catch { byId("status").textContent = "View cleared. To revoke the stored club permission, use Disconnect in the companion popup or remove the extension."; }
  });
  addEventListener("pagehide",() => { ++epoch; clear(); });
})();
