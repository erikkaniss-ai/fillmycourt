// First-party GetACourt Google OAuth PKCE helper; no external runtime library.
// This does NOT authorize access to any third-party sports provider.
(function(root){
  "use strict";
  const KEY="gac.google.pkce.v1";
  const MAX_AGE_MS=5*60*1000;
  const bytesToBase64Url=bytes=>{
    let str="";
    for(const b of bytes)str+=String.fromCharCode(b);
    return btoa(str).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
  };
  function verifier(cryptoApi){
    if(!cryptoApi?.getRandomValues)throw Error("Secure random numbers are required");
    const bytes=new Uint8Array(32);cryptoApi.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }
  async function challenge(cryptoApi,codeVerifier){
    if(!cryptoApi?.subtle)throw Error("Secure crypto is required");
    const input=new TextEncoder().encode(codeVerifier);
    const digest=await cryptoApi.subtle.digest("SHA-256",input);
    return bytesToBase64Url(new Uint8Array(digest));
  }
  function authorizeUrl(baseUrl,redirectUrl,codeChallenge){
    const base=new URL(baseUrl);
    if(base.protocol!=="https:"||!/^[a-z0-9-]+\\.supabase\\.co$/.test(base.hostname)||base.pathname!=="/")
      throw Error("Invalid Supabase Auth endpoint");
    const redirect=new URL(redirectUrl);
    if(redirect.protocol!=="https:"||redirect.username||redirect.password||redirect.hash)
      throw Error("Invalid OAuth redirect URL");
    if(!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))throw Error("Invalid PKCE challenge");
    const target=new URL("/auth/v1/authorize",base);
    target.searchParams.set("provider","google");
    target.searchParams.set("redirect_to",redirect.href);
    target.searchParams.set("code_challenge",codeChallenge);
    target.searchParams.set("code_challenge_method","s256");
    return target.href;
  }
  function savePending(storage,codeVerifier,redirectUrl,now=Date.now()){
    if(!/^[A-Za-z0-9_-]{43}$/.test(codeVerifier))throw Error("Invalid PKCE verifier");
    storage.setItem(KEY,JSON.stringify({codeVerifier,redirectUrl,createdAt:now}));
  }
  function takePending(storage,now=Date.now()){
    const raw=storage.getItem(KEY);
    storage.removeItem(KEY);
    if(!raw)return null;
    try{
      const pending=JSON.parse(raw);
      if(!Number.isFinite(pending.createdAt)||now<pending.createdAt||now-pending.createdAt>MAX_AGE_MS)return null;
      if(!/^[A-Za-z0-9_-]{43}$/.test(pending.codeVerifier))return null;
      return pending;
    }catch{return null;}
  }
  function captureCallback(locationHref){
    const url=new URL(locationHref);
    const hasCode=url.searchParams.has("code"),hasError=url.searchParams.has("error");
    if(!hasCode&&!hasError)return null;
    const code=url.searchParams.get("code");
    const error=url.searchParams.get("error_description")||url.searchParams.get("error")||null;
    for(const key of ["code","error","error_code","error_description"])url.searchParams.delete(key);
    return {code,error,cleanUrl:url.pathname+url.search+url.hash,originPath:url.origin+url.pathname};
  }
  root.GACAuth=Object.freeze({verifier,challenge,authorizeUrl,savePending,takePending,captureCallback});
  if(typeof module!=="undefined"&&module.exports)module.exports=root.GACAuth;
})(globalThis);
