for(const action of ["approve","open","enableComparisonBridge","revoke"])document.getElementById(action).addEventListener("click",async()=>{
  const button=document.getElementById(action);button.disabled=true;
  try{
    const result=await chrome.runtime.sendMessage({action});
    document.getElementById("status").textContent=result?.status==="connected"?"Connected. GetACourt is opening.":result?.status==="disconnected"?"Disconnected.":result?.status==="opened"?"GetACourt opened.":result?.status==="comparison_bridge_ready"?"Bridge enabled for this exact GetACourt page. It will share the prepared sanitized report only after the page requests it.":result?.error||"Could not connect. Open the Playtomic club and try again.";
  }catch{document.getElementById("status").textContent="Reader unavailable. Reload the existing extension in Chrome.";}
  finally{button.disabled=false;}
});
