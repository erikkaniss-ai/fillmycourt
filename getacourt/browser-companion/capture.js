// Executed only after activeTab consent. Reads rendered offer fields, never page state.
function capturePlaytomic() {
  const url = new URL(location.href);
  if (url.origin !== "https://playtomic.com" || !/^\/clubs\/[a-z0-9-]+$/.test(url.pathname))
    throw Error("Open an official Playtomic club page.");
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const heading = [...document.querySelectorAll("h2")].find(e => e.textContent.trim() === "Available courts");
  const region = heading?.parentElement;
  if (!region || !visible(heading)) throw Error("Available courts section not found.");
  const dates = [...region.querySelectorAll('input[type="date"]')].map(e => e.value);
  if (!dates.length || new Set(dates).size !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0]))
    throw Error("Selected date is ambiguous.");
  const sports = [...region.querySelectorAll("select")].map(e => e.selectedOptions[0]?.textContent.trim());
  if (!sports.length || new Set(sports).size !== 1 || !["Padel", "Tennis"].includes(sports[0]))
    throw Error("Selected sport is ambiguous.");
  const venue = document.querySelector("h1")?.innerText.replace(/^Book a court in\s*/i, "").trim();
  if (!venue || venue.length > 160) throw Error("Venue heading missing.");
  const offers = [];
  for (const button of region.querySelectorAll("button")) {
    if (!visible(button) || button.disabled || button.innerText.trim() !== "Book") continue;
    const timeGroup = button.closest("details");
    const courtGroup = timeGroup?.parentElement.closest("details");
    const court = courtGroup?.querySelector(":scope > summary")?.innerText.split("\n")[0].trim();
    const row = button.parentElement.innerText.replace(/\s+/g, " ").trim();
    const m = /^(\d{1,2}:\d{2} [AP]M)\s*-\s*(\d{1,2}:\d{2} [AP]M)\s*•\s*(\d+) min\s*•\s*€(\d+(?:\.\d{2})?)\s*Book$/.exec(row);
    if (!court || court.length > 100 || !m || Number(m[3]) < 1 || Number(m[3]) > 360 || Number(m[4]) > 2000) throw Error("Expanded offer format changed; no result shared.");
    offers.push({court, startLabel:m[1], endLabel:m[2], durationMinutes:Number(m[3]), priceEur:Number(m[4])});
    if (offers.length > 20) throw Error("Expand at most 20 offers.");
  }
  if (!offers.length) throw Error("Expand a court and time to show its Book offer. No availability inferred from empty results.");
  return {provider:"playtomic",source:"user_ui_observation",sourceUrl:url.origin+url.pathname,
    venue,date:dates[0],sport:sports[0],capturedAt:new Date().toISOString(),
    timezone:null,sourceFreshness:"unknown",coverage:"expanded_offers_only",offers};
}
if (typeof module !== "undefined") module.exports = {capturePlaytomic};
