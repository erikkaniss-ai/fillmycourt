// User-requested presentation/filter changes only. Never activate Book or checkout.
async function searchPlaytomic(query) {
  const fail=code=>{throw Object.assign(new Error("Search unavailable"),{readerCode:code});};
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=="hidden";
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let canceled=false,cancelWait;
  const cancel=(message,sender)=>{if(sender.id===chrome.runtime.id&&message?.action==="cancelPersonalSearch"){canceled=true;cancelWait?.();}};
  const check=()=>{if(canceled)fail("CONSENT_WITHDRAWN");};
  const challenge=()=>[...document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],[id*="captcha"]')].some(visible);
  const minutes=label=>{
    const m=/^(\d{1,2}):(\d{2}) ([AP]M)$/.exec(label);
    if(!m||+m[1]<1||+m[1]>12||+m[2]>59)return null;
    return (+m[1]%12)*60 + +m[2] + (m[3]==="PM"?720:0);
  };
  chrome.runtime.onMessage.addListener(cancel);
  try {
    const url=new URL(location.href);
    if(url.origin!=="https://playtomic.com"||!/^\/clubs\/[a-z0-9-]+$/.test(url.pathname))fail("CLUB_PAGE_REQUIRED");
    if(!query||!/^\d{4}-\d{2}-\d{2}$/.test(query.date)||!["Padel","Tennis"].includes(query.sport)||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(query.from)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(query.to)||
      query.from>query.to||![0,60,90,120].includes(query.durationMinutes))fail("QUERY_INVALID");
    check();
    await pause(200);
    check();
    if(innerWidth>640)fail("COMPACT_VIEW_REQUIRED");
    if(challenge())fail("CHALLENGE_REQUIRED");
    const heading=[...document.querySelectorAll("h2")].find(e=>e.textContent.trim()==="Available courts");
    const region=heading?.parentElement;
    if(!region||!visible(heading))fail("OFFER_SECTION_MISSING");
    const dateInputs=[...region.querySelectorAll('input[type="date"]')].filter(visible);
    const sportInputs=[...region.querySelectorAll("select")].filter(visible);
    if(dateInputs.length!==1)fail("DATE_AMBIGUOUS");
    if(sportInputs.length!==1)fail("SPORT_AMBIGUOUS");
    const dateInput=dateInputs[0],sportInput=sportInputs[0];
    const option=[...sportInput.options].find(o=>o.textContent.trim()===query.sport);
    if(!option)fail("SPORT_AMBIGUOUS");
    const set=(element,prototype,value)=>{
      check();
      Object.getOwnPropertyDescriptor(prototype,"value").set.call(element,value);
      element.dispatchEvent(new Event("input",{bubbles:true}));
      element.dispatchEvent(new Event("change",{bubbles:true}));
    };
    if(sportInput.value!==option.value)set(sportInput,HTMLSelectElement.prototype,option.value);
    // Wait for the control tree to settle between the two normal UI filters.
    const settle=()=>new Promise(resolve=>{
      let quiet,deadline,done=false;
      const finish=code=>{if(done)return;done=true;clearTimeout(quiet);clearTimeout(deadline);observer.disconnect();cancelWait=undefined;resolve(code);};
      const ready=()=>!region.querySelector('[aria-busy="true"],[role="progressbar"]')&&
        !/\bloading\b/i.test(region.innerText);
      const changed=()=>{clearTimeout(quiet);quiet=setTimeout(()=>{if(ready())finish(null);},500);};
      const observer=new MutationObserver(changed);
      cancelWait=()=>finish("CONSENT_WITHDRAWN");
      observer.observe(region,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["aria-busy","class","hidden"]});
      deadline=setTimeout(()=>finish("SCHEDULE_NOT_READY"),6000);
      changed();
    });
    let problem=await settle();check();if(problem)fail(problem);
    // A sport change may replace its controls. Reacquire only the visible date input.
    const currentDates=[...region.querySelectorAll('input[type="date"]')].filter(visible);
    if(currentDates.length!==1)fail("DATE_AMBIGUOUS");
    if(currentDates[0].value!==query.date)set(currentDates[0],HTMLInputElement.prototype,query.date);
    problem=await settle();check();if(problem)fail(problem);
    if(challenge())fail("CHALLENGE_REQUIRED");
    const selectedDates=[...region.querySelectorAll('input[type="date"]')].map(e=>e.value);
    const selectedSports=[...region.querySelectorAll("select")].map(e=>e.selectedOptions[0]?.textContent.trim());
    if(!selectedDates.length||selectedDates.some(d=>d!==query.date)||!selectedSports.length||selectedSports.some(s=>s!==query.sport))
      fail("SCHEDULE_NOT_READY");
    const courts=[...region.querySelectorAll("details")].filter(e=>!e.parentElement.closest("details")&&visible(e)).slice(0,3);
    const names=[];let starts=0;
    const from=+query.from.slice(0,2)*60 + +query.from.slice(3),to=+query.to.slice(0,2)*60 + +query.to.slice(3);
    for(const court of courts){
      check();court.open=true;await pause(50);check();
      const name=court.querySelector(":scope > summary")?.innerText.split("\n")[0].trim();
      if(!name||name.length>100)fail("VENUE_MISSING");
      names.push(name);
      const times=[...court.querySelectorAll("details")];
      for(const time of times){check();time.open=false;}
      let courtStarts=0;
      for(const time of times){
        check();
        const summary=time.querySelector(":scope > summary");
        const label=/^(\d{1,2}:\d{2} [AP]M)/.exec(summary?.innerText.trim()||"")?.[1];
        const start=minutes(label||"");
        if(starts>=6||courtStarts>=2||start===null||start<from||start>to||!visible(summary))continue;
        time.open=true;starts++;courtStarts++;await pause(50);
      }
    }
    check();
    if(!starts)fail("NO_EXPANDED_OFFERS");
    const result=capturePlaytomic({courts:names,fromMinutes:from,toMinutes:to,durationMinutes:query.durationMinutes});
    check();
    return result;
  } catch(error) {
    const allowed=["CLUB_PAGE_REQUIRED","QUERY_INVALID","COMPACT_VIEW_REQUIRED","CHALLENGE_REQUIRED","SCHEDULE_NOT_READY","OFFER_SECTION_MISSING","DATE_AMBIGUOUS","SPORT_AMBIGUOUS","VENUE_MISSING","NO_EXPANDED_OFFERS","CONSENT_WITHDRAWN"];
    return {readerError:allowed.includes(error?.readerCode)?error.readerCode:"READ_FAILED"};
  } finally {chrome.runtime.onMessage.removeListener(cancel);}
}
