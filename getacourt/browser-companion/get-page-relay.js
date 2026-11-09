// One-time installed extension relay on the EXACT protected Get search page.
// Queries come only from an explicit Find courts click; no polling or accounts.
(() => {
  "use strict";
  // Only same-document fragments may differ; queries (even bare ?) stay barred.
  const comparisonPageAllowed=value=>typeof value==="string"&&
    value.split("#",1)[0]==="https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html";
  if(window.top!==window||!comparisonPageAllowed(location.href))return;
  const nonceOk=v=>typeof v==="string"&&/^[a-f0-9]{48}$/.test(v);
  const timeOk=v=>typeof v==="string"&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
  const dateOk=v=>typeof v==="string"&&/^\d{4}-\d\d-\d\d$/.test(v);
  const publish=(name,detail)=>window.dispatchEvent(new CustomEvent(name,{detail}));
  let active=null;
  const seen=new Map();
  window.addEventListener("gac:auto-search-cancel",event=>{
    if(window.top!==window||!comparisonPageAllowed(location.href))return;
    const detail=event?.detail;
    if(!detail||Object.keys(detail).sort().join(",")!=="nonce"||
       !nonceOk(detail.nonce)||active?.nonce!==detail.nonce)return;
    const request=active;active=null;
    if(request.sent)chrome.runtime.sendMessage({action:"cancelPlaytomicSearchFromGet",nonce:detail.nonce}).catch(()=>{});
  });
  window.addEventListener("gac:auto-search-request",event=>{
    if(window.top!==window||!comparisonPageAllowed(location.href))return;
    const detail=event?.detail;
    if(!detail||typeof detail!=="object"||Array.isArray(detail)||
      Object.keys(detail).sort().join(",")!=="deadlineAt,nonce,query"||
      !nonceOk(detail.nonce))return;
    const now=Date.now();
    for(const [nonce,expiry] of seen)if(expiry<=now)seen.delete(nonce);
    if(!Number.isSafeInteger(detail.deadlineAt)||detail.deadlineAt<=now||
       detail.deadlineAt>now+45000||active||seen.has(detail.nonce)||seen.size>=32)return;
    const q=detail.query;
    if(!q||typeof q!=="object"||Array.isArray(q)||
      Object.keys(q).sort().join(",")!=="date,duration,from,location,sport,to"||
      !dateOk(q.date)||!timeOk(q.from)||!timeOk(q.to)||
      q.from>=q.to||!["padel","tennis"].includes(q.sport)||
      !["any","60","90"].includes(q.duration))return;
    const nonce=detail.nonce;
    const request={nonce,sent:false};active=request;seen.set(nonce,detail.deadlineAt);
    publish("gac:auto-search-accepted",{nonce});
    // A synchronous page reset during the ACK must prevent dispatch itself.
    if(active!==request)return;
    request.sent=true;
    const providerQuery={date:q.date,sport:q.sport==="padel"?"Padel":"Tennis",
      location:q.location,from:q.from,to:q.to,
      durationMinutes:q.duration==="any"?0:Number(q.duration)};
    chrome.runtime.sendMessage({action:"autoSearchPlaytomicClubsFromGet",query:providerQuery,
      nonce,deadlineAt:detail.deadlineAt})
      .then(result=>{
        if(active!==request)return;
        active=null;publish("gac:auto-search-response",{nonce,result});
      })
      .catch(()=>{
        if(active!==request)return;
        active=null;publish("gac:auto-search-response",{nonce,
          result:{status:"unavailable",code:"READER_UNAVAILABLE"}});
      });
  });
  // Independent, on-demand reads from the player's other explicitly connected
  // websites. A provider failure is not a Playtomic failure or "sold out".
  window.addEventListener("gac:additional-sources-request",event=>{
    if(window.top!==window||!comparisonPageAllowed(location.href))return;
    const detail=event?.detail;
    if(!detail||typeof detail!=="object"||Array.isArray(detail)||
      Object.keys(detail).sort().join(",")!=="nonce,query"||
      !nonceOk(detail.nonce))return;
    const q=detail.query;
    if(!q||typeof q!=="object"||Array.isArray(q)||
      Object.keys(q).sort().join(",")!=="date,duration,from,location,sport,to"||
      !dateOk(q.date)||!timeOk(q.from)||!timeOk(q.to)||q.from>=q.to||
      !["padel","tennis"].includes(q.sport)||!["any","60","90"].includes(q.duration))return;
    const nonce=detail.nonce;
    const providerQuery={date:q.date,sport:q.sport==="padel"?"Padel":"Tennis",
      location:q.location,from:q.from,to:q.to,durationMinutes:q.duration==="any"?0:Number(q.duration)};
    chrome.runtime.sendMessage({action:"autoSearchAdditionalFromGet",query:providerQuery})
      .then(result=>publish("gac:additional-sources-response",{nonce,result}))
      .catch(()=>publish("gac:additional-sources-response",{nonce,
        result:{status:"unavailable",code:"READER_UNAVAILABLE"}}));
  });

})();
