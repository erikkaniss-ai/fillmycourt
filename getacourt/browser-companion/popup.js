for(const action of ["approve","open","revoke"])document.getElementById(action).addEventListener("click",async()=>{
  const button=document.getElementById(action);button.disabled=true;
  try{
    const result=await chrome.runtime.sendMessage({action});
    document.getElementById("status").textContent=result?.status==="connected"?"Connected. GetACourt is opening.":result?.status==="disconnected"?"Disconnected.":result?.status==="opened"?"GetACourt opened.":result?.error||"Could not connect. Open the Playtomic club and try again.";
  }catch{document.getElementById("status").textContent="Reader unavailable. Reload the existing extension in Chrome.";}
  finally{button.disabled=false;}
});
