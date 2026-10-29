// Executed by chrome.scripting in an explicitly approved PLAYER booking page.
// Only normal visible DOM and ordinary date/sport controls. No fetch, APIs,
// hidden state, account credentials, checkout or booking controls.
async function readVisibleProviderPage(query) {
  const fail=code=>({readerError:code});
  const visible=element=>element&&element.getClientRects().length>0&&
    getComputedStyle(element).visibility!=="hidden";
  const url=new URL(location.href),sourceUrl=url.origin+url.pathname;
  const provider=url.hostname==="clubs.tiesports.com"?"tiesports":
    url.hostname==="racket.id"?"racket_id":
    url.hostname==="smashpro.pt"?"smashpro":
    url.hostname==="www.matchi.se"?"matchi":null;
  if(!provider||!globalThis.GetACourtVisibleProviderOffers)return fail("CLUB_PAGE_REQUIRED");
  // Never inspect a management portal, directory index, query token or checkout.
  const pathAllowed={
    tiesports:/^\/(?:en|pt)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/,
    racket_id:/^\/booking$/,
    smashpro:/^\/pt\/c\/[a-z0-9-]+$/,
    matchi:/^\/facilities\/[a-z0-9_-]+$/
  };
  if(!pathAllowed[provider].test(url.pathname)||url.hash||
     [...url.searchParams.keys()].some(k=>k!=="lang"||provider!=="matchi"))return fail("CLUB_PAGE_REQUIRED");
  if(provider==="smashpro"&&/este clube n[aã]o foi reclamado|perfil deste clube ainda n[aã]o foi reclamado|unclaimed club/i.test(document.body?.innerText.slice(0,400)||""))
    return fail("SOURCE_UNCLAIMED");
  const challenge=()=>[...document.querySelectorAll(
    'input[type="password"],input[autocomplete="one-time-code"],[id*="captcha"],iframe[src*="captcha"]'
  )].some(visible);
  if(challenge())return fail("CHALLENGE_REQUIRED");
  const headers=[...document.querySelectorAll("h2,h3,[role='heading']")].filter(visible);
  const title=/^(?:available\s+(?:courts|time slots)|court\s+booking|reservas?(?:\s+de\s+campos)?|hor[aá]rios?\s+dispon[ií]veis|lediga\s+tider)$/i;
  const heading=headers.find(h=>title.test(h.innerText.trim()));
  if(!heading)return fail("OFFER_SECTION_MISSING");
  let region=heading.closest("section,[role='region']")||heading.parentElement?.parentElement;
  if(!region)return fail("OFFER_SECTION_MISSING");
  const visibleDates=[...region.querySelectorAll('input[type="date"]')].filter(visible);
  // If the provider exposes a custom date picker, do not guess which date is
  // shown. Requires an explicit provider-specific adapter/UAT first.
  if(visibleDates.length!==1)return fail("DATE_AMBIGUOUS");
  const dateInput=visibleDates[0];
  if(dateInput.value!==query.date){
    try{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(dateInput,query.date);
      dateInput.dispatchEvent(new Event("input",{bubbles:true}));
      dateInput.dispatchEvent(new Event("change",{bubbles:true}));
    }catch{return fail("SCHEDULE_NOT_READY");}
    await new Promise(resolve=>setTimeout(resolve,450));
  }
  if(challenge())return fail("CHALLENGE_REQUIRED");
  const freshDates=[...region.querySelectorAll('input[type="date"]')].filter(visible);
  if(freshDates.length!==1||freshDates[0].value!==query.date||
     [...region.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].some(visible))
    return fail("SCHEDULE_NOT_READY");
  const sportOptions=[...region.querySelectorAll("select")].filter(visible).filter(select=>
    [...select.options].some(opt=>/^(?:padel|tennis|t[eé]nis)$/i.test(opt.textContent.trim())));
  if(sportOptions.length!==1)return fail("SPORT_AMBIGUOUS");
  const sport=sportOptions[0],selected=[...sport.options].find(option=>
    option.textContent.trim().toLowerCase()===(query.sport==="Padel"?"padel":"tennis"));
  if(!selected)return fail("SPORT_AMBIGUOUS");
  if(sport.value!==selected.value){
    try{
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(sport,selected.value);
      sport.dispatchEvent(new Event("input",{bubbles:true}));
      sport.dispatchEvent(new Event("change",{bubbles:true}));
    }catch{return fail("SCHEDULE_NOT_READY");}
    await new Promise(resolve=>setTimeout(resolve,450));
  }
  if(sport.selectedOptions.length!==1||
     sport.selectedOptions[0].textContent.trim().toLowerCase()!==(query.sport==="Padel"?"padel":"tennis"))
    return fail("SCHEDULE_NOT_READY");
  if(challenge())return fail("CHALLENGE_REQUIRED");
  // Reacquire DOM region after the ordinary first-party filters change.
  region=heading.closest("section,[role='region']")||heading.parentElement?.parentElement;
  if(!region||!visible(region))return fail("SCHEDULE_NOT_READY");
  const rows=[...region.querySelectorAll(
    'article,li,tr,[role="row"],[data-testid*="court"],[data-testid*="slot"]'
  )].filter(visible).slice(0,120).map(item=>{
    const action=[...item.querySelectorAll('button,a,[role="button"]')].find(button=>
      visible(button)&&!/disabled|unavailable|occupied|reservado/i.test(button.getAttribute("aria-label")||"")&&
      /^(?:book|reserve|reservar|reserva|available|dispon[ií]vel)$/i.test(button.innerText.trim()));
    return {text:item.innerText.trim().slice(0,320),
      action:action?.innerText.trim()||"",disabled:!action||
      action.hasAttribute("disabled")||action.getAttribute("aria-disabled")==="true"};
  });
  const venue=[...document.querySelectorAll("h1")].find(visible)?.innerText.trim();
  if(!venue||venue.length>160)return fail("VENUE_MISSING");
  return globalThis.GetACourtVisibleProviderOffers.buildObservation({
    provider,sourceUrl,venue,date:query.date,sport:query.sport,
    selectedDate:freshDates[0].value,
    selectedSport:query.sport,regionTitle:heading.innerText.trim(),
    claimed:provider!=="smashpro"||!/unclaimed|n[aã]o reclamado/i.test(document.body?.innerText.slice(0,400)||""),
    query,rows
  });
}
