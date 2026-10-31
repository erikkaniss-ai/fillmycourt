// Executed only after activeTab consent. Reads rendered offer fields, never page state.
function capturePlaytomic(scope) {
  // Return fixed failure codes without depending on how the browser serializes
  // injected exceptions. Never return the caught exception text.
  const fail = code => { throw Object.assign(new Error("Offer unavailable"), {readerCode:code}); };
  try {
  const url = new URL(location.href);
  if (url.origin !== "https://playtomic.com" || !/^\/clubs\/[a-z0-9-]+$/.test(url.pathname))
    fail("CLUB_PAGE_REQUIRED");
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const heading = [...document.querySelectorAll("h2")].find(e => e.textContent.trim() === "Available courts");
  let region = heading?.parentElement;
  if (region && !region.querySelector('input[type="date"],select')) {
    const section = heading.closest("section");
    if(section?.querySelector('input[type="date"],select'))region=section;
  }
  if (!region || !visible(heading)) fail("OFFER_SECTION_MISSING");
  const dates = [...region.querySelectorAll('input[type="date"]')].map(e => e.value);
  if (!dates.length || new Set(dates).size !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0]))
    fail("DATE_AMBIGUOUS");
  const sports = [...region.querySelectorAll("select")].filter(visible).map(e => {
    const label=e.selectedOptions[0]?.textContent.trim().toLowerCase();
    return label==="padel"?"Padel":label==="tennis"?"Tennis":null;
  });
  if (!sports.length || sports.some(s=>!s) || new Set(sports).size !== 1)
    fail("SPORT_AMBIGUOUS");
  const venue = document.querySelector("h1")?.innerText.replace(/^Book a court in\s*/i, "").trim();
  if (!venue || venue.length > 160) fail("VENUE_MISSING");
  const offers = [];
  for (const button of region.querySelectorAll("button")) {
    if (!visible(button) || button.disabled || button.innerText.trim() !== "Book") continue;
    const timeGroup = button.closest("details");
    const courtGroup = timeGroup?.parentElement.closest("details");
    const court = courtGroup?.querySelector(":scope > summary")?.innerText.split("\n")[0].trim();
    if (scope && !scope.courts.includes(court)) continue;
    const row = button.parentElement.innerText.replace(/\s+/g, " ").trim();
    const m = /^(\d{1,2}:\d{2} [AP]M)\s*-\s*(\d{1,2}:\d{2} [AP]M)\s*•\s*(\d+) min\s*•\s*€(\d+(?:\.\d{2})?)\s*Book$/.exec(row);
    if (!court || court.length > 100 || !m || Number(m[3]) < 1 || Number(m[3]) > 360 || Number(m[4]) > 2000) fail("OFFER_FORMAT_CHANGED");
    if (scope) {
      const startMatch=/^(\d{1,2}):(\d{2}) ([AP]M)$/.exec(m[1]);
      const start=(Number(startMatch[1])%12)*60+Number(startMatch[2])+(startMatch[3]==="PM"?720:0);
      if (start<scope.fromMinutes || start>scope.toMinutes || (scope.durationMinutes && Number(m[3])!==scope.durationMinutes)) continue;
      if (offers.length===20) break;
    }
    offers.push({court, startLabel:m[1], endLabel:m[2], durationMinutes:Number(m[3]), priceEur:Number(m[4])});
    if (offers.length > 20) fail("TOO_MANY_OFFERS");
  }
  if (!offers.length) {
    // Contemporary Playtomic club booking UI uses a visible anchored popup,
    // not details/summary. Only parse the actual selected, visible duration and
    // total price AFTER an explicit court-time disclosure. Never click Continue.
    const panels=[...document.querySelectorAll('div[class*="z-50"][class*="absolute"]')].filter(visible);
    const minute=label=>{const m=/^([1-9]|1[0-2]):([0-5]\d) ([AP]M)$/.exec(label||"");
      return m?(Number(m[1])%12)*60+Number(m[2])+(m[3]==="PM"?720:0):null;};
    const timeLabel=value=>{
      const h=Math.floor(value/60),m=value%60;
      return (h%12||12)+":"+String(m).padStart(2,"0")+" "+(h<12?"AM":"PM");
    };
    for(const panel of panels){
      const button=[...panel.querySelectorAll("button")].filter(visible).find(e=>
        /^Continue\s*[-–]\s*€\d+(?:\.\d{2})?$/.test(e.innerText.trim()));
      if(!button || button.disabled)continue;
      const court=panel.querySelector("div.font-bold")?.innerText.trim();
      const startLabel=panel.querySelector("div.text-xs")?.innerText.trim();
      const picked=[...panel.querySelectorAll('div[class*="bg-secondary-energy-50"]')].filter(visible);
      if(picked.length!==1)fail("OFFER_FORMAT_CHANGED");
      const details=[...picked[0].querySelectorAll("div.text-sm")].filter(visible).map(e=>e.innerText.trim());
      if(details.length!==2)fail("OFFER_FORMAT_CHANGED");
      const durationText=/^(?:(\d+)\s*hr(?:,\s*|\s+))?(\d+)\s*min$/.exec(details[0]);
      const priceText=/^€(\d+(?:\.\d{2})?)$/.exec(details[1]);
      const priceAction=/^Continue\s*[-–]\s*€(\d+(?:\.\d{2})?)$/.exec(button.innerText.trim());
      const start=minute(startLabel),duration=durationText?Number(durationText[1]||0)*60+Number(durationText[2]):null;
      if(!court || court.length>100 || !startLabel || start===null || !duration ||
         duration>360 || start+duration>=1440 || !priceText || !priceAction ||
         Number(priceText[1])!==Number(priceAction[1]) || Number(priceText[1])<=0 ||
         Number(priceText[1])>2000)fail("OFFER_FORMAT_CHANGED");
      if(scope && (start<scope.fromMinutes||start>scope.toMinutes||
         (scope.durationMinutes && duration!==scope.durationMinutes)))continue;
      offers.push({court,startLabel,endLabel:timeLabel(start+duration),
        durationMinutes:duration,priceEur:Number(priceText[1])});
      if(offers.length>20)fail("TOO_MANY_OFFERS");
    }
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
