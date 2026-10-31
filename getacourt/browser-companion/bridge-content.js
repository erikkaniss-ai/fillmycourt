// Runs only after an explicit browser-action click on the exact GetACourt
// comparison page. It is not a public web bridge and has no provider access.
(() => {
  "use strict";
  if(window.top!==window)return;
  const root=document.documentElement;
  const validNonce=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{24,128}$/.test(value);
  const announce=()=>{
    const nonce=root.dataset.gacPersonalBridgeRequest;
    if(validNonce(nonce))chrome.runtime.sendMessage({action:"pageBridgeReady",nonce}).catch(()=>{});
  };
  if(root.dataset.gacPersonalBridgeContent!=="1"){
    root.dataset.gacPersonalBridgeContent="1";
    window.addEventListener("gac:request-personal-observation",event=>{
      const detail=event.detail;
      if(!detail||typeof detail!=="object"||Array.isArray(detail)||Object.keys(detail).join(",")!=="nonce"||!validNonce(detail.nonce))return;
      root.dataset.gacPersonalBridgeRequest=detail.nonce;
      announce();
    });
    chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
      if(!message||typeof message!=="object"||Array.isArray(message)||Object.keys(message).sort().join(",")!=="action,nonce,observation"||
        message.action!=="deliverComparisonObservation"||!validNonce(message.nonce)||root.dataset.gacPersonalBridgeRequest!==message.nonce){
        reply({status:"rejected"});return;
      }
      let accepted=false;
      const confirm=event=>{
        const detail=event?.detail;
        if(detail&&typeof detail==="object"&&!Array.isArray(detail)&&
          Object.keys(detail).join(",")==="nonce"&&detail.nonce===message.nonce)accepted=true;
      };
      window.addEventListener("gac:personal-observation-accepted",confirm);
      try{
        window.dispatchEvent(new CustomEvent("gac:personal-observation",{detail:{nonce:message.nonce,observation:message.observation}}));
      }finally{window.removeEventListener("gac:personal-observation-accepted",confirm);}
      if(!accepted){reply({status:"rejected"});return;}
      delete root.dataset.gacPersonalBridgeRequest;
      reply({status:"delivered"});
    });
  }
  announce();
})();
