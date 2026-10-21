// GetACourt isolated offline shell proof. NOT registered by the active app.
// Cache only a public, static offline notice. NEVER cache court, availability,
// venue, account, authentication, booking, payment or provider responses.
(function(root){
  "use strict";
  const CACHE_NAME="gac-offline-shell-v1";
  const CACHE_PREFIX="gac-offline-shell-";
  const BLOCKED_SEGMENTS=new Set([
    "api","auth","oauth","login","logout","session","token","tokens",
    "account","accounts","profile","player-profile","private","my-bookings",
    "book","booking","bookings","hold","holds","checkout","payment",
    "payments","provider","providers","search","availability","courts",
    "courts-availability","slot","slots","callback","notifications"
  ]);
  const BLOCKED_QUERY_KEYS=new Set([
    "access_token","refresh_token","token","authorization","code",
    "session","secret","apikey","api_key","email","hold","booking",
    "payment","checkout","player","customer","user"
  ]);

  function shouldHandle(request,scope){
    if(!request||request.method!=="GET"||request.mode!=="navigate")return false;
    let url,base;
    try{url=new URL(request.url);base=new URL(scope);}catch{return false;}
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return false;
    // Encoded path separators / escapes are ambiguous. Never take over these.
    if(/%2f|%5c|%2e/i.test(url.pathname)||url.pathname.includes("\\"))return false;
    const parts=url.pathname.slice(base.pathname.length).split("/").filter(Boolean);
    if(parts.some(x=>BLOCKED_SEGMENTS.has(x.toLowerCase())))return false;
    for(const key of url.searchParams.keys())
      if(BLOCKED_QUERY_KEYS.has(key.toLowerCase()))return false;
    return true;
  }

  if(root&&typeof root.addEventListener==="function"&&root.registration){
    const scope=root.registration.scope;
    const fallback=new URL("./offline.html",scope).href;
    root.addEventListener("install",event=>{
      event.waitUntil((async()=>{
        // A known public document is the *only* cached content.
        const response=await fetch(fallback,{cache:"no-store",credentials:"omit",redirect:"error"});
        if(!response.ok||!(response.headers.get("content-type")||"").includes("text/html"))
          throw Error("Offline notice unavailable");
        const cache=await caches.open(CACHE_NAME);
        await cache.put(fallback,response);
        await root.skipWaiting();
      })());
    });
    root.addEventListener("activate",event=>{
      event.waitUntil((async()=>{
        const names=await caches.keys();
        await Promise.all(names
          .filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME)
          .map(name=>caches.delete(name)));
        await root.clients.claim();
      })());
    });
    root.addEventListener("fetch",event=>{
      if(!shouldHandle(event.request,scope))return;
      event.respondWith((async()=>{
        try{
          // Network-first, no cache write, no stale availability substitution.
          return await fetch(event.request,{cache:"no-store"});
        }catch{
          const notice=await caches.match(fallback);
          return notice||Response.error();
        }
      })());
    });
  }
  if(typeof module!=="undefined"&&module.exports)
    module.exports=Object.freeze({shouldHandle,cacheName:CACHE_NAME});
})(typeof self!=="undefined"?self:undefined);
