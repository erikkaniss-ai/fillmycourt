(() => {
  const byId=id=>document.getElementById(id);
  const validate=globalThis.GetACourtPersonalSourceObservation.validateObservation;
  let connected=false,pending=false,epoch=0,expiry,cooldownTimer,cooldownUntil=0,latestObservation=null;
  const today=new Date();
  const localDate=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
  byId("date").value=byId("date").min=localDate(today);
  const last=new Date(today);last.setDate(last.getDate()+14);byId("date").max=localDate(last);
  const clear=()=>{clearTimeout(expiry);latestObservation=null;byId("results").replaceChildren();
    byId("copyObservation").disabled=true;byId("prepareComparison").disabled=true;byId("copyFallback").value="";
    byId("copyFallbackLabel").hidden=true;byId("copyStatus").textContent="No observation ready to copy.";};
  const controls=()=>{
    byId("search").disabled=!connected||pending||Date.now()<cooldownUntil;
    byId("filters").disabled=pending;
    byId("showClub").disabled=!connected;
  };
  const connection=result=>{
    connected=result?.status==="connected";
    byId("connection").textContent=connected?"Club connected. Search when you are ready.":"Open the intended Playtomic club, click the GetACourt icon, then Connect and open GetACourt.";
    byId("club").textContent=typeof result?.sourceUrl==="string"&&/^https:\/\/playtomic\.com\/clubs\/[a-z0-9-]+$/.test(result.sourceUrl)?result.sourceUrl:"";
    controls();
  };
  const send=message=>chrome.runtime.sendMessage(message);
  const reason=result=>typeof result?.error==="string"?result.error:"Reader unavailable. Open GetACourt from its extension icon.";
  send({action:"status"}).then(connection).catch(()=>connection(null));
  byId("searchForm").addEventListener("submit",async event=>{
    event.preventDefault();
    if(!connected||pending||Date.now()<cooldownUntil)return;
    const query={date:byId("date").value,sport:byId("sport").value,from:byId("from").value,to:byId("to").value,durationMinutes:Number(byId("duration").value)};
    if(query.from>query.to){byId("status").textContent="Start until must not be earlier than Start from.";return;}
    const current=++epoch;clear();pending=true;cooldownUntil=Date.now()+60000;controls();
    byId("status").textContent="Searching the approved club's visible offers…";
    byId("cooldown").textContent="Allow 60 seconds before another search. No automatic retry.";
    clearTimeout(cooldownTimer);
    cooldownTimer=setTimeout(()=>{byId("cooldown").textContent="";controls();},60000);
    try{
      const result=await send({action:"search",query});
      if(current!==epoch)return;
      if(result?.status!=="observed"){
        if(["CONNECT_REQUIRED","TAB_CHANGED","TAB_ACCESS_REQUIRED"].includes(result?.code))connection(null);
        throw Error(reason(result));
      }
      const observation=validate(result.observation);
      if(observation.date!==query.date||observation.sport!==query.sport)throw Error("The returned schedule does not match this search.");
      byId("status").textContent=observation.venue+" · "+observation.date+" · "+observation.sport+". Captured "+observation.capturedAt+". Provider freshness unknown.";
      const minute=label=>{const m=/^(\d{1,2}):(\d{2}) ([AP]M)$/.exec(label);return (+m[1]%12)*60 + +m[2] +(m[3]==="PM"?720:0);};
      const offers=observation.offers.filter(o=>{
        const start=minute(o.startLabel),from=+query.from.slice(0,2)*60 + +query.from.slice(3),to=+query.to.slice(0,2)*60 + +query.to.slice(3);
        return start>=from&&start<=to&&(!query.durationMinutes||o.durationMinutes===query.durationMinutes);
      }).sort((a,b)=>minute(a.startLabel)-minute(b.startLabel)||a.priceEur-b.priceEur||a.court.localeCompare(b.court));
      for(const offer of offers){
        const article=document.createElement("article"),heading=document.createElement("h3"),details=document.createElement("p");
        heading.textContent=offer.court;details.textContent=offer.startLabel+"–"+offer.endLabel+" · "+offer.durationMinutes+" min · €"+offer.priceEur;
        article.append(heading,details);byId("results").append(article);
      }
      if(!offers.length)byId("status").textContent="No matching offers in the inspected subset. Other slots may exist.";
      else{latestObservation=observation;byId("copyObservation").disabled=false;byId("prepareComparison").disabled=false;byId("copyStatus").textContent="Observed offers are ready. Open a private comparison or copy a sanitized report.";}
      expiry=setTimeout(()=>{++epoch;clear();byId("status").textContent="Observation expired. Search again to check the club.";},60000);
    }catch(error){if(current===epoch)byId("status").textContent=error.message;}
    finally{pending=false;controls();}
  });
  byId("copyObservation").addEventListener("click",async()=>{
    const current=latestObservation;
    if(!current){byId("copyStatus").textContent="Search your club first.";return;}
    if(!Number.isFinite(Date.parse(current.capturedAt))||Date.now()-Date.parse(current.capturedAt)>=60000){
      clear();byId("copyStatus").textContent="Observation expired. Search again.";return;
    }
    let sanitized;
    try{sanitized=JSON.stringify(validate(current));}catch{clear();byId("copyStatus").textContent="Observation failed validation.";return;}
    try{
      if(!navigator.clipboard?.writeText)throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(sanitized);
      byId("copyStatus").textContent="Copied observed offers only (no account data). Paste into GetACourt personal search. Expires 60 seconds after capture.";
    }catch{
      byId("copyFallback").value=sanitized;byId("copyFallbackLabel").hidden=false;
      byId("copyFallback").focus();byId("copyFallback").select();
      byId("copyStatus").textContent="Automatic clipboard blocked. Copy the selected sanitized report manually (Ctrl+C), then paste into GetACourt.";
    }
  });
  byId("prepareComparison").addEventListener("click",async()=>{
    const current=latestObservation;
    if(!current){byId("copyStatus").textContent="Search your club first.";return;}
    let sanitized;
    try{sanitized=validate(current);}catch{clear();byId("copyStatus").textContent="Observation failed validation.";return;}
    if(!Number.isFinite(Date.parse(sanitized.capturedAt))||Date.now()-Date.parse(sanitized.capturedAt)>=60000){
      clear();byId("copyStatus").textContent="Observation expired. Search again.";return;
    }
    byId("prepareComparison").disabled=true;
    try{
      const result=await send({action:"prepareComparison",observation:sanitized});
      if(result?.status!=="comparison_prepared")throw Error(result?.error||"Comparison unavailable.");
      byId("copyStatus").textContent="GetACourt personal search opened. Run the same search, choose Receive Reader offers, then click this extension icon in that exact GetACourt tab to deliver the report.";
    }catch(error){byId("copyStatus").textContent=error.message||"Comparison unavailable. No offers were shared.";}
    finally{byId("prepareComparison").disabled=!latestObservation;}
  });
  byId("filters").addEventListener("input",()=>{++epoch;clear();byId("status").textContent="Filters changed. Search to inspect these offers.";});
  byId("showClub").addEventListener("click",async()=>{
    try{const result=await send({action:"showClub"});if(result?.status!=="opened")byId("status").textContent=reason(result);}
    catch{byId("status").textContent="Club tab unavailable. Reconnect from its extension icon.";}
  });
  byId("disconnect").addEventListener("click",async()=>{
    ++epoch;clear();connected=false;controls();byId("status").textContent="Disconnecting…";
    try{
      const result=await send({action:"revoke"});
      if(result?.status!=="disconnected")throw Error("Disconnect unavailable.");
      connection(null);byId("status").textContent="Disconnected. Club preference and results cleared.";
    }catch{byId("status").textContent="Local results cleared. Use Disconnect in the extension popup to revoke access.";}
  });
  addEventListener("pagehide",()=>{++epoch;clear();clearTimeout(cooldownTimer);});
})();
