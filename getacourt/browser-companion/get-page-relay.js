// One-time installed extension relay on the EXACT protected Get search page.
// Queries come only from an explicit Find courts click; no polling or accounts.
(() => {
  "use strict";
  if(window.top!==window ||
    location.href!=="https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html")return;
  const nonceOk=v=>typeof v==="string"&&/^[a-f0-9]{48}$/.test(v);
  const timeOk=v=>typeof v==="string"&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
  const dateOk=v=>typeof v==="string"&&/^\d{4}-\d\d-\d\d$/.test(v);
  const publish=(name,detail)=>window.dispatchEvent(new CustomEvent(name,{detail}));
  window.addEventListener("gac:auto-search-request",event=>{
    const detail=event?.detail;
    if(!detail||typeof detail!=="object"||Array.isArray(detail)||
      Object.keys(detail).sort().join(",")!=="nonce,query"||
      !nonceOk(detail.nonce))return;
    const q=detail.query;
    if(!q||typeof q!=="object"||Array.isArray(q)||
      Object.keys(q).sort().join(",")!=="date,duration,from,location,sport,to"||
      !dateOk(q.date)||!timeOk(q.from)||!timeOk(q.to)||
      q.from>=q.to||!["padel","tennis"].includes(q.sport)||
      !["any","60","90"].includes(q.duration))return;
    const nonce=detail.nonce;
    publish("gac:auto-search-accepted",{nonce});
    const providerQuery={date:q.date,sport:q.sport==="padel"?"Padel":"Tennis",
      from:q.from,to:q.to,durationMinutes:q.duration==="any"?0:Number(q.duration)};
    chrome.runtime.sendMessage({action:"autoSearchFromGet",query:providerQuery})
      .then(result=>publish("gac:auto-search-response",{nonce,result}))
      .catch(()=>publish("gac:auto-search-response",{nonce,
        result:{status:"unavailable",code:"READER_UNAVAILABLE"}}));
  });
})();
