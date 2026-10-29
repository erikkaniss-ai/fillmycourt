// One normal first-party login and one explicit Chrome permission per provider.
// This popup never sees provider passwords, cookies or private booking APIs.
let selectedSource=null;
function identify(urlText){
  try{
    const url=new URL(urlText);
    if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash)return null;
    const clean=url.origin+url.pathname;
    if(url.search&&!(url.hostname==="www.matchi.se"&&[...url.searchParams.keys()].every(k=>k==="lang")))return null;
    if(/^https:\/\/playtomic\.com\/clubs\/[a-z0-9-]+$/.test(clean))
      return {provider:"playtomic",origin:"https://playtomic.com/*"};
    if(/^https:\/\/clubs\.tiesports\.com\/(?:en|pt)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/.test(clean))
      return {provider:"tiesports",origin:"https://clubs.tiesports.com/*"};
    if(clean==="https://racket.id/booking")
      return {provider:"racket_id",origin:"https://racket.id/*"};
    if(/^https:\/\/smashpro\.pt\/pt\/c\/[a-z0-9-]+$/.test(clean))
      return {provider:"smashpro",origin:"https://smashpro.pt/*"};
    if(/^https:\/\/www\.matchi\.se\/facilities\/[a-z0-9_-]+$/.test(clean))
      return {provider:"matchi",origin:"https://www.matchi.se/*"};
  }catch{}
  return null;
}
chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{
  selectedSource=identify(tab?.url||"");
}).catch(()=>{});
for(const action of ["approve","open","enableComparisonBridge","revoke"]){
  document.getElementById(action).addEventListener("click",async()=>{
    const button=document.getElementById(action);button.disabled=true;
    const label=document.getElementById("status");
    try{
      let call=action;
      if(action==="approve"){
        if(!selectedSource){
          label.textContent="Open an official Playtomic /clubs/ page before connecting.";
          return;
        }
        const granted=await chrome.permissions.request({origins:[selectedSource.origin]});
        if(!granted){label.textContent="Chrome site access was not granted. You can retry from this official player page.";return;}
        call=selectedSource.provider==="playtomic"?"approve":"approveAdditional";
      }
      const result=await chrome.runtime.sendMessage({action:call});
      label.textContent=result?.status==="connected"?
        "Connected "+(result.provider||"Playtomic")+". Future searches start in GetACourt. Provider login remains in Chrome.":
        result?.status==="disconnected"?"Provider access disconnected.":
        result?.status==="opened"?"GetACourt opened.":
        result?.status==="comparison_bridge_ready"?"Prepared report ready for the exact protected GetACourt page.":
        result?.error||"Could not connect. Use an official player club page and normal login.";
    }catch{
      label.textContent="Browser connection unavailable. Reload the existing extension.";
    }finally{button.disabled=false;}
  });
}
