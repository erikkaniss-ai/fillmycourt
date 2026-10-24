// Executed only after activeTab consent. Reads rendered offer fields, never page state.
function capturePlaytomic() {
  // Return fixed failure codes without depending on how the browser serializes
  // injected exceptions. Never return the caught exception text.
  const fail = code => { throw Object.assign(new Error("Offer unavailable"), {readerCode:code}); };
  try {
  const url = new URL(location.href);
  if (url.origin !== "https://playtomic.com" || !/^\/clubs\/[a-z0-9-]+$/.test(url.pathname))
    fail("CLUB_PAGE_REQUIRED");
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const heading = [...document.querySelectorAll("h2")].find(e => e.textContent.trim() === "Available courts");
  const region = heading?.parentElement;
  if (!region || !visible(heading)) fail("OFFER_SECTION_MISSING");
  const dates = [...region.querySelectorAll('input[type="date"]')].map(e => e.value);
  if (!dates.length || new Set(dates).size !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0]))
    fail("DATE_AMBIGUOUS");
  const sports = [...region.querySelectorAll("select")].map(e => e.selectedOptions[0]?.textContent.trim());
  if (!sports.length || new Set(sports).size !== 1 || !["Padel", "Tennis"].includes(sports[0]))
    fail("SPORT_AMBIGUOUS");
  const venue = document.querySelector("h1")?.innerText.replace(/^Book a court in\s*/i, "").trim();
  if (!venue || venue.length > 160) fail("VENUE_MISSING");
  const offers = [];
  for (const button of region.querySelectorAll("button")) {
    if (!visible(button) || button.disabled || button.innerText.trim() !== "Book") continue;
    const timeGroup = button.closest("details");
    const courtGroup = timeGroup?.parentElement.closest("details");
    const court = courtGroup?.querySelector(":scope > summary")?.innerText.split("\n")[0].trim();
    const row = button.parentElement.innerText.replace(/\s+/g, " ").trim();
    const m = /^(\d{1,2}:\d{2} [AP]M)\s*-\s*(\d{1,2}:\d{2} [AP]M)\s*•\s*(\d+) min\s*•\s*€(\d+(?:\.\d{2})?)\s*Book$/.exec(row);
    if (!court || court.length > 100 || !m || Number(m[3]) < 1 || Number(m[3]) > 360 || Number(m[4]) > 2000) fail("OFFER_FORMAT_CHANGED");
    offers.push({court, startLabel:m[1], endLabel:m[2], durationMinutes:Number(m[3]), priceEur:Number(m[4])});
    if (offers.length > 20) fail("TOO_MANY_OFFERS");
  }
  if (!offers.length) fail("NO_EXPANDED_OFFERS");
  return {provider:"playtomic",source:"user_ui_observation",sourceUrl:url.origin+url.pathname,
    venue,date:dates[0],sport:sports[0],capturedAt:new Date().toISOString(),
    timezone:null,sourceFreshness:"unknown",coverage:"expanded_offers_only",offers};
  } catch (error) {
    const allowed = ["CLUB_PAGE_REQUIRED","OFFER_SECTION_MISSING","DATE_AMBIGUOUS","SPORT_AMBIGUOUS","VENUE_MISSING","OFFER_FORMAT_CHANGED","TOO_MANY_OFFERS","NO_EXPANDED_OFFERS"];
    return {readerError:allowed.includes(error?.readerCode) ? error.readerCode : "READ_FAILED"};
  }
}
if (typeof module !== "undefined") module.exports = {capturePlaytomic};
