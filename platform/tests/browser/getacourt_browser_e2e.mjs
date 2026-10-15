// GAC-MVP-QA-08: isolated actual Chromium journey tests against GetAcourt RC sources.
// Deliberately localhost-only; NO real OAuth accounts, Core, providers, payments or booking writes.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {resolve,extname} from "node:path";
import {chromium} from "playwright-core";

const root=resolve(process.cwd(),"getacourt");
const approvedFiles=new Set([
 "index.html","manifest.webmanifest","assets/app.js","assets/auth-pkce.js",
 "assets/styles.css","assets/commercial-signals.js","assets/icon-192.png","assets/icon-512.png"
]);
const forbiddenPaths=new Set([
 "/api/gac/hold","/api/gac/book","/api/gac/cancel","/api/gac/auth/magic-link",
 "/api/gac/player-profile/write","/api/gac/play-routines/write"
]);
const mime={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
 ".css":"text/css; charset=utf-8",".webmanifest":"application/manifest+json",".png":"image/png"};
const fakeJwt="fixture."+Buffer.from(JSON.stringify({
 sub:"qa-local-browser-only",email:"qa-browser@example.invalid"
})).toString("base64url")+".not-a-real-signature";
let server,browser,origin,googleEnabled=false;
let searchCalls=[],authExchanges=[],forbiddenWrites=[];
const json=(res,code,obj)=>{
 res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
 res.end(JSON.stringify(obj));
};
async function readBody(req){
 let text="";
 for await(const chunk of req){text+=chunk;if(text.length>8192)throw Error("Unexpected oversized local request");}
 return text?JSON.parse(text):{};
}
function fixture(date){
 const day=/^\d{4}-\d{2}-\d{2}$/.test(date||"")?date:"2030-01-01";
 return [{
  id:"qa-venue-1",name:"QA Fixture Court Club",area:"Cascais",sport:"padel",
  source:"LOCAL BROWSER QA FIXTURE — NOT LIVE",tags:["Outdoor"],lat:38.696,lon:-9.422,
  distanceKm:1.1,slots:[{
   id:"qa-slot-1",courtId:"qa-court-1",courtName:"QA Court One",venueId:"qa-venue-1",
   date:day,time:"17:00",startsAt:day+"T17:00:00Z",duration:90,
   currency:"EUR",price:24,status:"available",indoor:false
  }]
 }];
}
async function handler(req,res){
 try{
  const url=new URL(req.url,"http://127.0.0.1");
  const pathname=url.pathname;
  if(pathname.startsWith("/api/")){
   if(forbiddenPaths.has(pathname) || (req.method!=="GET" && ![
    "/api/gac/auth/google/exchange","/api/gac/auth/sign-out"
   ].includes(pathname))){
    forbiddenWrites.push({method:req.method,path:pathname});
    return json(res,503,{error:"QA_BLOCKED",message:"Writes prohibited in browser QA"});
   }
   if(pathname==="/api/gac/platform-config"){
    return json(res,200,{bookingEnabled:false,onlinePayments:false,
     authConfigured:true,emailSignInEnabled:false,googleSignInEnabled:googleEnabled,
     supabaseAuthUrl:"https://fixture-only.supabase.co/"});
   }
   if(pathname==="/api/gac/search"){
    if(req.method!=="GET")return json(res,405,{error:"METHOD"});
    const query=Object.fromEntries(url.searchParams.entries());
    searchCalls.push(query);
    return json(res,200,{mode:"qa-local-browser-fixture",venues:fixture(query.date),
     search:{radiusUsedKm:5,attemptedRadii:[5],expanded:false}});
   }
   if(pathname==="/api/gac/auth/google/exchange"&&req.method==="POST"){
    const body=await readBody(req);
    authExchanges.push({code:body.authCode,validVerifier:/^[A-Za-z0-9_-]{43}$/.test(body.codeVerifier||"")});
    if(body.authCode!=="qa-callback-only"||!authExchanges.at(-1).validVerifier){
     return json(res,400,{error:"INVALID_FIXTURE_AUTH"});
    }
    return json(res,200,{access_token:fakeJwt,refresh_token:"fixture-only-refresh",expires_in:3600});
   }
   if(pathname==="/api/gac/player-profile"&&req.method==="GET"){
    return json(res,200,{profile:{full_name:"QA Browser Player",home_area:"Cascais",
     preferred_sports:["padel"],marketing_consent:false}});
   }
   if((pathname==="/api/gac/play-routines"||pathname==="/api/gac/demand-notifications")&&req.method==="GET"){
    return json(res,200,{items:[]});
   }
   if(pathname==="/api/gac/auth/sign-out"&&req.method==="POST")return json(res,200,{});
   return json(res,404,{error:"NO_EXTERNAL_API_IN_QA"});
  }
  const file=pathname==="/"?"index.html":pathname.slice(1);
  if(!approvedFiles.has(file)){res.writeHead(404);res.end();return;}
  const data=await readFile(resolve(root,file));
  res.writeHead(200,{
   "content-type":mime[extname(file)]||"application/octet-stream",
   "cache-control":"no-store",
   "Permissions-Policy":"camera=(), microphone=(), geolocation=(self)",
   "Content-Security-Policy":globalThis.qaCsp
  });
  res.end(data);
 }catch(error){res.writeHead(500);res.end("QA fixture server error");}
}
before(async()=>{
 const config=await readFile(resolve(root,"netlify.toml"),"utf8");
 globalThis.qaCsp=config.match(/Content-Security-Policy = "([^"]+)"/)?.[1];
 assert.ok(globalThis.qaCsp,"Use the actual release candidate CSP");
 server=createServer(handler);
 await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
 origin="http://127.0.0.1:"+server.address().port;
 const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
  "/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
 assert.ok(chrome,"A preinstalled Chrome or Chromium binary is required");
 browser=await chromium.launch({headless:true,executablePath:chrome,args:["--no-sandbox"]});
});
after(async()=>{
 await browser?.close();
 if(server?.listening)await new Promise(ok=>server.close(ok));
 assert.deepEqual(forbiddenWrites,[],"QA must never create bookings, holds, CRM or payments");
});
async function pageFixture({mobile=false,grantLocation=false,denyLocation=false}={}){
 const context=await browser.newContext({
  viewport:mobile?{width:390,height:844}:{width:1280,height:850}
 });
 if(grantLocation){
  await context.setGeolocation({latitude:38.697,longitude:-9.421});
  await context.grantPermissions(["geolocation"],{origin});
 }
 if(denyLocation){
  await context.addInitScript(()=>{
   Object.defineProperty(navigator,"geolocation",{configurable:true,value:{
    getCurrentPosition:(success,error)=>error({code:1,message:"denied by QA fixture"})
   }});
  });
 }
 const page=await context.newPage();
 // Prohibit *all* requests to outside systems; Leaflet CDN failure exercises fallback.
 await page.route("**/*",route=>{
  const address=new URL(route.request().url());
  if(address.origin===origin)return route.continue();
  return route.abort("blockedbyclient");
 });
 return {context,page};
}
const ready=async page=>{
 await page.goto(origin+"/",{waitUntil:"domcontentloaded"});
 await page.locator(".venue-card").first().waitFor({timeout:15000});
};
test("real Chromium: fixture search → venue → preview; no hold/book calls",async()=>{
 googleEnabled=false;
 const {context,page}=await pageFixture({mobile:true});
 try{
  await ready(page);
  assert.match(await page.locator("#resultCount").innerText(),/available slot/);
  await page.locator(".venue-detail-button").first().click();
  assert.equal(await page.locator("#venueDialog").evaluate(el=>el.open),true);
  await page.locator("#closeVenueButton").click();
  await page.locator(".venue-card .slot").first().click();
  assert.equal(await page.locator("#bookingDialog").evaluate(el=>el.open),true);
  assert.match(await page.locator("#bookingHeading").innerText(),/Booking preview/);
  assert.equal(await page.locator("#confirmBookingButton").isDisabled(),true);
  assert.match(await page.locator("#bookingSummary").innerText(),/no hold/i);
 }finally{await context.close();}
});
test("Decision 104 shadow: browser funnel remains local and labels preview non-conversion",async()=>{
 const {context,page}=await pageFixture({mobile:true});
 try{
  await page.goto(origin+"/?utm_source=hotel&utm_campaign=qa-private%40example.invalid",{waitUntil:"domcontentloaded"});
  await page.locator(".venue-card").first().waitFor({timeout:15000});
  await page.locator(".venue-card .slot").first().click();
  const records=await page.evaluate(()=>window.GACSignals.snapshot());
  assert.deepEqual(records.map(x=>x.stage),
   ["search_requested","availability_result","slot_selected","booking_preview"]);
  assert.equal(records[0].acquisition_source,"hotel");
  assert.equal(records[1].source_class,"fixture_or_unknown");
  assert.equal(records[1].venues,1);
  assert.equal(records[1].available_slots,1);
  assert.equal(records[2].provider,"unknown"); // no trusted provider declared by fixture
  assert.equal(records[3].transaction_state,"preview_only");
  assert.ok(!records.some(x=>/confirm|handoff|booking_started/.test(x.stage)));
  const body=JSON.stringify(records);
  for(const forbidden of ["qa-private@example.invalid","latitude","longitude","email","home_country","accessToken"]){
   assert.equal(body.includes(forbidden),false,forbidden);
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem("gac.commercial.events")),null);
 }finally{await context.close();}
});
test("real Chromium: absent external Leaflet falls back from map to list",async()=>{
 const {context,page}=await pageFixture();
 try{
  await ready(page);
  await page.locator("#mapViewButton").click();
  await page.waitForFunction(()=>document.querySelector("#resultsMap").hidden===true);
  assert.equal(await page.locator("#resultsGrid").isVisible(),true);
  assert.match(await page.locator("#toast").innerText(),/Map is temporarily unavailable/);
 }finally{await context.close();}
});
test("real Chromium: list/map use identical venue coordinates (deterministic Leaflet stub)",async()=>{
 const {context,page}=await pageFixture();
 try{
  await context.addInitScript(()=>{
   window.qaMarkers=[];
   const map={fitBounds(bounds){window.qaMapBounds=bounds;},invalidateSize(){}};
   const layer={clearLayers(){window.qaMarkers=[];},addTo(){return layer;}};
   window.L={
    map:()=>map,
    tileLayer:()=>({addTo:()=>{}}),
    layerGroup:()=>layer,
    marker:coords=>({addTo:()=>({bindPopup:html=>{window.qaMarkers.push({coords,html});}})})
   };
  });
  await ready(page);
  const venueName=await page.locator(".venue-card h3").first().innerText();
  await page.locator("#mapViewButton").click();
  await page.waitForFunction(()=>Array.isArray(window.qaMarkers)&&window.qaMarkers.length===1);
  const points=await page.evaluate(()=>window.qaMarkers);
  assert.equal(await page.locator("#resultsMap").evaluate(el=>el.hidden),false);
  assert.deepEqual(points[0].coords,[38.696,-9.422]);
  assert.match(points[0].html,/QA Fixture Court Club/);
  assert.match(points[0].html,/17:00/);
  assert.equal(venueName,"QA Fixture Court Club");
 }finally{await context.close();}
});
test("real Chromium: explicit Near me consent forwards coordinates; typed city clears them",async()=>{
 const {context,page}=await pageFixture({grantLocation:true,mobile:true});
 try{
  await ready(page);
  const before=searchCalls.length;
  await page.locator("#nearMeButton").click();
  await page.waitForFunction(()=>document.querySelector("#locationInput").value==="Current location");
  assert.ok(searchCalls.length>before);
  const near=searchCalls.at(-1);
  assert.equal(Number(near.lat),38.697);
  assert.equal(Number(near.lon),-9.421);
  await page.locator("#locationInput").fill("Lisbon");
  await page.locator("#searchForm button[type=submit]").click();
  await page.waitForFunction(()=>document.querySelector("#resultsTitle").textContent.includes("Lisbon"));
  const manual=searchCalls.at(-1);
  assert.equal(manual.location,"Lisbon");
  assert.equal(manual.lat,undefined);
  assert.equal(manual.lon,undefined);
 }finally{await context.close();}
});
test("real Chromium: denied location keeps manual search functional",async()=>{
 const {context,page}=await pageFixture({denyLocation:true});
 try{
  await ready(page);
  const before=searchCalls.length;
  await page.locator("#nearMeButton").click();
  await page.waitForFunction(()=>document.querySelector("#toast").textContent.includes("permission was denied"));
  assert.equal(searchCalls.length,before);
  await page.locator("#locationInput").fill("Cascais");
  await page.locator("#searchForm button[type=submit]").click();
  await page.waitForFunction(()=>document.querySelector("#dateStatus").textContent.includes("Showing"));
  assert.ok(searchCalls.length>before);
 }finally{await context.close();}
});
test("real Chromium: date selection refreshes the fixture search",async()=>{
 const {context,page}=await pageFixture();
 try{
  await ready(page);
  const date=await page.locator("#dateInput").inputValue();
  const next=new Date(date+"T12:00:00Z");
  next.setUTCDate(next.getUTCDate()+4);
  const future=next.toISOString().slice(0,10);
  const before=searchCalls.length;
  await page.locator("#dateInput").fill(future);
  await page.locator("#dateInput").dispatchEvent("change");
  await page.waitForFunction(v=>document.querySelector("#dateStatus").textContent.includes(v),future===null?"":future,{timeout:1200}).catch(()=>{});
  await page.waitForFunction(v=>document.querySelector(".venue-card .slot")&&document.querySelector("#dateStatus").textContent.includes("Showing"),future);
  assert.ok(searchCalls.length>before);
  assert.equal(searchCalls.at(-1).date,future);
 }finally{await context.close();}
});
test("real Chromium: simulated Google callback → profile → signout, never Google provider",async()=>{
 googleEnabled=true;
 const {context,page}=await pageFixture();
 try{
  await ready(page);
  await page.evaluate(()=>sessionStorage.setItem("gac.google.pkce.v1",JSON.stringify({
   codeVerifier:"A".repeat(43),redirectUrl:location.origin+location.pathname,createdAt:Date.now()
  })));
  const before=authExchanges.length;
  await page.goto(origin+"/?code=qa-callback-only",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.querySelector("#authButton").textContent.includes("QA Browser Player"));
  assert.equal(new URL(page.url()).searchParams.has("code"),false,"Callback code removed from URL");
  assert.equal(authExchanges.length,before+1);
  assert.equal(authExchanges.at(-1).validVerifier,true);
  await page.locator("#authButton").click();
  await page.locator("#profileDialog[open]").waitFor({timeout:10000});
  assert.equal(await page.locator("#profileDialog").evaluate(el=>el.open),true);
  await page.locator("#profileSignOutButton").click();
  await page.waitForFunction(()=>document.querySelector("#authButton").textContent==="Sign in");
  assert.equal(await page.evaluate(()=>localStorage.getItem("gac.session")),null);
  await page.reload();
  assert.equal(await page.locator("#authButton").innerText(),"Sign in");
 }finally{await context.close();googleEnabled=false;}
});
