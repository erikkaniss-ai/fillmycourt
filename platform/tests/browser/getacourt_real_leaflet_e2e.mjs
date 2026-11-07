// QA-09: real Leaflet 1.9.4 against localhost-only GetACourt UI fixture.
// No provider connections, auth, writes, payment or external network traffic.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {resolve,extname} from "node:path";
import {chromium} from "playwright-core";

const root=resolve(process.cwd(),"getacourt");
const dist=resolve(process.cwd(),"platform/tests/browser/node_modules/leaflet/dist");
const originRoot="https://unpkg.com/leaflet@1.9.4/dist/";
const assets={
 "leaflet.js":"sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
 "leaflet.css":"sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
};
const allowed=new Set(["index.html","assets/app.js","assets/auth-pkce.js",
 "assets/commercial-signals.js","assets/styles.css","manifest.webmanifest",
 "assets/icon-192.png","assets/icon-512.png"]);
const types={".html":"text/html",".js":"application/javascript",
 ".css":"text/css",".webmanifest":"application/manifest+json",".png":"image/png"};
test("real Chromium loads upstream SRI-pinned Leaflet and opens preview",async()=>{
 for(const [filename,hash] of Object.entries(assets)){
  const data=await readFile(resolve(dist,filename));
  assert.equal("sha256-"+createHash("sha256").update(data).digest("base64"),hash);
 }
 const config=await readFile(resolve(root,"netlify.toml"),"utf8");
 const csp=config.match(/Content-Security-Policy = "([^"]+)"/)?.[1];
 assert.ok(csp);
 let forbidden=0,server,browser,context;
 try{
  server=createServer(async(req,res)=>{
   const url=new URL(req.url,"http://127.0.0.1");
   if(url.pathname.startsWith("/api/")){
    if(req.method!=="GET")forbidden++;
    res.setHeader("Content-Type","application/json");
    if(url.pathname==="/api/gac/platform-config")
     return res.end(JSON.stringify({bookingEnabled:false,onlinePayments:false,
      emailSignInEnabled:false,googleSignInEnabled:false,authConfigured:false}));
    if(url.pathname==="/api/gac/search"){
     const date=url.searchParams.get("date")||"2026-10-15";
     return res.end(JSON.stringify({mode:"fixture_only",search:{radiusUsedKm:5},
      venues:[{id:"qa-venue",name:"LOCAL QA CLUB",area:"Cascais",sport:"padel",
       lat:38.696,lon:-9.422,distanceKm:1.2,source:"QA ONLY",tags:["Outdoor"],
       slots:[{id:"qa-slot",courtId:"qa-court",courtName:"Test Court",
        date,time:"17:00",startsAt:date+"T17:00:00Z",
        duration:90,price:20,currency:"EUR",status:"available",indoor:false}]}]}));
    }
    res.statusCode=403;return res.end(JSON.stringify({error:"NO_EXTERNAL_API"}));
   }
   const file=url.pathname==="/inside-qa"||url.pathname==="/"
     ?"index.html":url.pathname.slice(1);
   if(!allowed.has(file)){res.statusCode=404;return res.end();}
   try{
    const bytes=await readFile(resolve(root,file));
    res.setHeader("Content-Type",types[extname(file)]||"application/octet-stream");
    res.setHeader("Content-Security-Policy",csp);
    res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=(self)");
    res.end(bytes);
   }catch{res.statusCode=500;res.end();}
  });
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const url="http://127.0.0.1:"+server.address().port;
  const exe=[process.env.CHROME_BIN,"/usr/bin/google-chrome",
   "/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"]
   .filter(Boolean).find(existsSync);
  assert.ok(exe,"Local Chromium browser must be available");
  browser=await chromium.launch({headless:true,executablePath:exe,args:["--no-sandbox"]});
  context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.route("**/*",async route=>{
   const uri=route.request().url();
   if(new URL(uri).origin===url)return route.continue();
   const name=uri.startsWith(originRoot)?uri.slice(originRoot.length):"";
   if(Object.hasOwn(assets,name)){
    return route.fulfill({body:await readFile(resolve(dist,name)),status:200,
     contentType:name.endsWith(".css")?"text/css":"application/javascript",
     headers:{"Access-Control-Allow-Origin":"*"}});
   }
   return route.abort("blockedbyclient");
  });
  await page.goto(url+"/",{waitUntil:"domcontentloaded"});
  await page.locator(".venue-card").first().waitFor({timeout:15000});
  await page.locator("#mapViewButton").click();
  await page.locator("#resultsMap.leaflet-container").waitFor({timeout:15000});
  await page.locator("#resultsMap .leaflet-marker-icon").first().waitFor({timeout:15000});
  assert.equal(await page.evaluate(()=>window.L?.version),"1.9.4");
  assert.equal(await page.locator("#resultsMap .leaflet-marker-icon").count(),1);
  await page.locator("#resultsMap .leaflet-marker-icon").first().click();
  await page.locator("#resultsMap .leaflet-popup-content").first().waitFor();
  assert.match(await page.locator("#resultsMap .leaflet-popup-content").innerText(),/LOCAL QA CLUB/);
  await page.locator("#resultsMap .map-slot").first().click();
  assert.match(await page.locator("#bookingHeading").innerText(),/Booking preview/);
  assert.equal(await page.locator("#confirmBookingButton").isDisabled(),true);
  assert.equal(forbidden,0,"Never perform booking/payment/provider writes");
 }finally{
  await context?.close();
  await browser?.close();
  if(server?.listening)await new Promise(ok=>server.close(ok));
 }
});
