// Complete isolated browser proof: no live GetACourt source is modified.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const dir=process.env.GAC_OFFLINE_TOOLS;
if(!dir)throw Error("Set GAC_OFFLINE_TOOLS to CI-only Playwright node_modules");
const {chromium}=require(join(dir,"playwright-core"));
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const URL_ROOT="/getacourt/offline-safety/";
const SECRET="SYNTHETIC_PERSONAL_BOOKING_MUST_NOT_LEAK";
let privateReads=0;
let storedReads=0;
let simulatedNetworkDown=false;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/","http://127.0.0.1");
  const route=url.pathname;
  // Playwright offline flags may not affect service-worker fetch in all builds.
  // Enforce a real socket failure at the origin, not a mocked HTTP 503 page.
  if(simulatedNetworkDown && route!==URL_ROOT+"offline.html"){
    req.socket.destroy();return;
  }
  if(route===URL_ROOT+"sw.js"||route===URL_ROOT+"offline.html"){
    const file=await readFile(join(root,route.endsWith("sw.js")?"sw.js":"offline.html"));
    res.writeHead(200,{"content-type":route.endsWith("sw.js")?"text/javascript":"text/html",
      "cache-control":"no-store","x-content-type-options":"nosniff"});
    res.end(file);return;
  }
  if(route===URL_ROOT||route===URL_ROOT+"index.html"){
    res.writeHead(200,{"content-type":"text/html","cache-control":"no-store"});
    res.end("<!doctype html><html><head><title>Online source-only fixture</title></head><body><h1>LIVE FIXTURE</h1></body></html>");return;
  }
  if(route===URL_ROOT+"dynamic"){
    storedReads++;
    res.writeHead(200,{"content-type":"text/html","cache-control":"no-store"});
    res.end("<!doctype html><title>Dynamic online fixture</title><h1>ONLINE DYNAMIC ONLY</h1>");return;
  }
  if(route===URL_ROOT+"api/private"){
    privateReads++;
    res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
    res.end(JSON.stringify({booking:SECRET,availability:[{slot:SECRET}]}));return;
  }
  res.writeHead(404,{"content-type":"text/plain"});res.end("not found");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port+URL_ROOT;
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({serviceWorkers:"allow"});
const page=await context.newPage();
const errors=[];const external=[];
page.on("pageerror",error=>errors.push(error.message));
await page.route("**/*",route=>{
  const u=new URL(route.request().url());
  if(u.origin!==new URL(base).origin){external.push(u.href);return route.abort();}
  return route.continue();
});
try{
  await page.goto(base,{waitUntil:"domcontentloaded"});
  // Seed a previous Offline Safety release cache and an unrelated app cache.
  // Activation may evict its own obsolete namespace, NEVER other app caches.
  await page.evaluate(async()=>{
    const old=await caches.open("gac-offline-shell-v0");
    await old.put("./old-shell.html",new Response("<h1>OLD NOT SAFE</h1>",{
      headers:{"content-type":"text/html"}}));
    const other=await caches.open("other-app-static-v1");
    await other.put("./unrelated-style.css",new Response("body{}",{
      headers:{"content-type":"text/css"}}));
  });
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register("./sw.js",{scope:"./"});
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),{timeout:10000});
  const onlinePrivate=await page.evaluate(async()=>{
    const r=await fetch("./api/private",{cache:"no-store"});
    return r.json();
  });
  assert.equal(onlinePrivate.booking,SECRET);
  assert.equal(privateReads,1);
  const before=await page.evaluate(async()=>{
    const keys=await caches.keys();
    const byCache={};
    for(const name of keys){
      const cache=await caches.open(name);
      byCache[name]=(await cache.keys()).map(r=>r.url).sort();
    }
    return {keys:keys.sort(),byCache};
  });
  assert.deepEqual(before.keys,["gac-offline-shell-v1","other-app-static-v1"],
    "Activation evicts only old own cache and preserves other application caches");
  assert.deepEqual(before.byCache["gac-offline-shell-v1"],[base+"offline.html"],
    "Only a single public offline notice may be cached by this module");
  assert.deepEqual(before.byCache["other-app-static-v1"],[base+"unrelated-style.css"],
    "Unrelated caches must not be deleted during activation");

  // Reject network to force an actual SW fallback from the cache.
  simulatedNetworkDown=true;
  await context.setOffline(true);
  await page.goto(base+"dynamic",{waitUntil:"domcontentloaded"});
  const fallbackText=await page.locator("body").innerText();
  assert.match(fallbackText,/No current court availability/i);
  assert.match(fallbackText,/not available while offline/i);
  assert.doesNotMatch(fallbackText,/SYNTHETIC_PERSONAL_BOOKING_MUST_NOT_LEAK/);
  assert.doesNotMatch(fallbackText,/ONLINE DYNAMIC ONLY/);

  // Use a separate page for denial probes; preserve the original controlled
  // offline document as a trusted observer of CacheStorage after all failures.
  const deniedPage=await context.newPage();
  try{
    for(const target of ["api/private","book","auth/callback","search?token=fake"]){
      let failed=false;
      try{await deniedPage.goto(base+target,{waitUntil:"domcontentloaded",timeout:7000});}
      catch{failed=true;}
      assert.equal(failed,true,target+" must fail closed under real offline network");
    }
  }finally{await deniedPage.close();}
  const after=await page.evaluate(async()=>{
    const keys=await caches.keys();
    const byCache={};
    for(const name of keys){
      const cache=await caches.open(name);
      byCache[name]=(await cache.keys()).map(r=>r.url).sort();
    }
    return {keys:keys.sort(),byCache};
  });
  assert.deepEqual(after,before,"Even after failed sensitive navigations cache inventory must be unchanged");
  assert.deepEqual(errors,[],"no JavaScript errors");
  assert.deepEqual(external,[],"no external traffic");
  console.log("PASS offline shell: 1 static fallback cached; 0 dynamic/auth/provider/booking entries");
  console.log("PASS network loss returns static offline notice; sensitive routes fail closed");
  console.log("PASS no external origin requests; mock private GET never cached");
}finally{
  await context.close();
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
