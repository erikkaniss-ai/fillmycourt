// Discover current official club in advance. On the actual user click, request
// Chrome's optional site permission immediately (retains user gesture).
let isOfficialClubTab=false;
chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{
  try{const url=new URL(tab?.url||'about:blank');
    isOfficialClubTab=url.origin==='https://playtomic.com'&&/^\/clubs\/[a-z0-9-]+$/.test(url.pathname);
  }catch{}
}).catch(()=>{});
for(const action of ["approve","open","enableComparisonBridge","revoke"])document.getElementById(action).addEventListener("click",async()=>{
  const button=document.getElementById(action);button.disabled=true;
  try{
    if(action==="approve"){
      if(!isOfficialClubTab){
        document.getElementById("status").textContent="Open an official Playtomic /clubs/ page before connecting.";
        return;
      }
      // The owner grants this named site ONCE via Chrome's own permission dialog.
      // No credentials/session are exported to GetACourt.
      const granted=await chrome.permissions.request({origins:["https://playtomic.com/*"]});
      if(!granted){document.getElementById("status").textContent="Playtomic access not granted. Choose Allow once to enable searches.";return;}
    }
    const result=await chrome.runtime.sendMessage({action});
    document.getElementById("status").textContent=result?.status==="connected"?"Connected. GetACourt is opening.":result?.status==="disconnected"?"Disconnected.":result?.status==="opened"?"GetACourt opened.":result?.status==="comparison_bridge_ready"?"Bridge enabled for this exact GetACourt page. It will share the prepared sanitized report only after the page requests it.":result?.error||"Could not connect. Open the Playtomic club and try again.";
  }catch{document.getElementById("status").textContent="Reader unavailable. Reload the existing extension in Chrome.";}
  finally{button.disabled=false;}
});
