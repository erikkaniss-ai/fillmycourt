// Fictional DOM/UI tests only. No extension installation, login or live provider traffic.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,mkdir} from "node:fs/promises";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
if(!process.env.GAC_A11Y_TOOLS)throw Error("Pinned GAC_A11Y_TOOLS browser tools required");
const {chromium}=require(join(process.env.GAC_A11Y_TOOLS,"playwright-core"));
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../browser-companion");
const allowed=new Map([["/reader.html","text/html"],["/reader.css","text/css"],["/reader.js","text/javascript"],["/observation.js","text/javascript"]]);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(req.method!=="GET"||!allowed.has(path)){res.writeHead(403);res.end("Fixture only");return;}
  res.writeHead(200,{"Content-Type":allowed.get(path),"Cache-Control":"no-store"});
  res.end(await readFile(join(root,path)));
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const origin="http://127.0.0.1:"+server.address().port;
const artifactDir=process.env.GAC_INTEGRATION_ARTIFACT_DIR;
if(artifactDir)await mkdir(artifactDir,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--no-sandbox"],...(process.env.GAC_FIXTURE_BROWSER==="chrome"?{channel:"chrome"}:{})});
const capture=await readFile(join(root,"capture.js"),"utf8"),search=await readFile(join(root,"search.js"),"utf8");
const fixtureUrl="https://playtomic.com/clubs/fictional-club";
const time=(label,duration=90)=>'<details><summary>'+label+' 1 options</summary><div>'+label+' - '+(label==="2:00 PM"?"3:30 PM":label==="3:30 PM"?"5:00 PM":"6:30 PM")+' • '+duration+' min • €36.00 <button type="button">Book</button></div></details>';
const court=index=>'<details class="court"><summary>Fictional court '+index+'</summary>'+time("2:00 PM")+time("3:30 PM")+time("5:00 PM")+'</details>';
const providerFixture='<!doctype html><html lang="en"><head><title>Fictional provider fixture</title><style>details{padding:8px}button{padding:10px}</style></head><body><h1>Book a court in Fictional venue</h1><section><h2>Available courts</h2><input type="date" value="2026-10-24"><select><option>Padel</option><option>Tennis</option></select>'+[1,2,3,4].map(court).join("")+'</section></body></html>';
let checks=0;
try{
  // Fulfill a fictional provider URL entirely in-process; reject every other request.
  const context=await browser.newContext({viewport:{width:480,height:850}});
  const sourcePage=await context.newPage(),foreign=[];
  await sourcePage.route("**/*",route=>{
    if(route.request().url()===fixtureUrl)return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:providerFixture});
    foreign.push(route.request().url());return route.abort("blockedbyclient");
  });
  await sourcePage.goto(fixtureUrl);
  await sourcePage.addScriptTag({content: `
    window.fixtureMessages=[];window.fixtureListeners=[];window.bookClicks=0;window.changes=[];
    window.chrome={runtime:{id:"fixture",onMessage:{addListener:f=>fixtureListeners.push(f),removeListener:f=>fixtureListeners=fixtureListeners.filter(x=>x!==f)}}};
    document.addEventListener("click",event=>{if(event.target.closest("button"))bookClicks++;});
    document.addEventListener("change",event=>changes.push(event.target.tagName));
    document.querySelector('input[type="date"]').addEventListener("change",()=>{
      const loading=document.createElement("p");loading.textContent="Loading…";document.querySelector("section").append(loading);
      setTimeout(()=>{
        for(const row of document.querySelectorAll("details details div"))row.firstChild.textContent=row.firstChild.textContent.replace("€36.00","€40.00");
        loading.remove();
      },750);
    });
  `});
  await sourcePage.addScriptTag({content:capture});await sourcePage.addScriptTag({content:search});
  const query={date:"2026-10-25",sport:"Tennis",from:"14:00",to:"20:00",durationMinutes:90};
  const result=await sourcePage.evaluate(q=>searchPlaytomic(q),query);
  const diagnostic=result.readerError?await sourcePage.locator('details[open] details[open] button').evaluateAll(buttons=>buttons.slice(0,2).map(button=>({row:button.parentElement.innerText,court:button.closest('details').parentElement.closest('details')?.querySelector(':scope > summary')?.innerText}))):null;
  assert.equal(result.readerError,undefined,"Fictional search failed: "+JSON.stringify({result,diagnostic}));
  assert.equal(result.date,query.date);assert.equal(result.sport,"Tennis");assert.equal(result.offers.length,6);
  assert.equal(new Set(result.offers.map(x=>x.court)).size,3);
  assert.ok(result.offers.every(x=>x.priceEur===40&&x.durationMinutes===90),"No stale rows while the new date is loading");
  assert.equal(await sourcePage.locator("details details[open]").count(),6);
  assert.equal(await sourcePage.evaluate(()=>bookClicks),0);assert.deepEqual(await sourcePage.evaluate(()=>changes),["SELECT","INPUT"]);
  assert.equal(await sourcePage.evaluate(()=>fixtureListeners.length),0);checks++;
  // A security-check UI stops the search without an attempt to solve it.
  await sourcePage.locator("body").evaluate(body=>{const input=document.createElement("input");input.autocomplete="one-time-code";body.append(input);});
  assert.equal((await sourcePage.evaluate(q=>searchPlaytomic(q),query)).readerError,"CHALLENGE_REQUIRED");
  assert.equal(await sourcePage.evaluate(()=>bookClicks),0);checks++;
  await sourcePage.locator('input[autocomplete="one-time-code"]').evaluate(e=>e.remove());
  await sourcePage.locator("select").selectOption("Padel");
  await sourcePage.evaluate(()=>changes=[]);
  const cancelResult=await sourcePage.evaluate(async q=>{
    const pending=searchPlaytomic(q);
    setTimeout(()=>{for(const listener of fixtureListeners)listener({action:"cancelPersonalSearch"},{id:"fixture"});},350);
    return pending;
  },{...query,date:"2026-10-26"});
  assert.equal(cancelResult.readerError,"CONSENT_WITHDRAWN");assert.equal(await sourcePage.evaluate(()=>fixtureListeners.length),0);checks++;
  assert.deepEqual(await sourcePage.evaluate(()=>changes),["SELECT"]);
  assert.equal(await sourcePage.locator('input[type="date"]').inputValue(),"2026-10-25");
  // New public Playtomic grid variant: only an explicitly white court cell
  // is clicked to open the price popup. Continue must NEVER be activated.
  await sourcePage.setContent('<!doctype html><html><body><h1>Book a court in Fictional venue</h1>'+
    '<section><h2>Available courts</h2><input type="date" value="2026-10-24">'+
    '<select><option>PADEL</option><option>TENNIS</option></select>'+
    '<div id="freeCell" type="button" class="absolute z-0 h-11 cursor-pointer bg-white">Available</div>'+
    '<div id="busyCell" type="button" class="absolute z-0 h-11 cursor-pointer bg-gray">Not Available</div>'+
    '</section></body></html>');
  await sourcePage.addScriptTag({content:`
    window.gridClicks=0;window.checkoutClicks=0;window.fixtureListeners=[];
    window.chrome={runtime:{id:"fixture",onMessage:{addListener:f=>fixtureListeners.push(f),removeListener:f=>fixtureListeners=fixtureListeners.filter(x=>x!==f)}}};
    document.getElementById("freeCell").addEventListener("click",()=>{
      window.gridClicks++;
      const node=document.createElement("div");
      node.className="ui-stroke-neutral-default absolute z-50";
      node.innerHTML=
        '<div class="flex flex-col"><div class="font-bold">NATUREZA</div><div class="text-xs">6:30 AM</div></div>'+
        '<div class="bg-secondary-energy-50"><div class="text-sm">1 hr, 30 min</div><div class="text-sm">€36.00</div></div>'+
        '<button class="ui-bg-primary-highlight">Continue - €36.00</button><button>Close</button>';
      document.querySelector("section").append(node);
      node.querySelector("button").addEventListener("click",()=>{window.checkoutClicks++;});
      node.querySelectorAll("button")[1].addEventListener("click",()=>node.remove());
    });
  `});
  await sourcePage.addScriptTag({content:capture});
  await sourcePage.addScriptTag({content:search});
  const gridQuery={date:"2026-10-25",sport:"Padel",from:"06:00",to:"08:00",durationMinutes:90};
  const gridResult=await sourcePage.evaluate(q=>searchPlaytomic(q),gridQuery);
  assert.equal(gridResult.readerError,undefined,"New grid capture failed "+JSON.stringify(gridResult));
  assert.equal(gridResult.offers.length,1);
  assert.equal(gridResult.offers[0].court,"NATUREZA");
  assert.equal(gridResult.offers[0].startLabel,"6:30 AM");
  assert.equal(gridResult.offers[0].endLabel,"8:00 AM");
  assert.equal(gridResult.offers[0].durationMinutes,90);
  assert.equal(gridResult.offers[0].priceEur,36);
  assert.equal(await sourcePage.evaluate(()=>gridClicks),1);
  assert.equal(await sourcePage.evaluate(()=>checkoutClicks),0);
  assert.equal(await sourcePage.locator("#busyCell").getAttribute("class"),"absolute z-0 h-11 cursor-pointer bg-gray");
  await sourcePage.locator('div[class*="z-50"] button.ui-bg-primary-highlight').evaluate(button=>button.textContent="Continue - €99.00");
  const wrongPrice=await sourcePage.evaluate(()=>capturePlaytomic());
  assert.equal(wrongPrice.readerError,"OFFER_FORMAT_CHANGED");
  assert.equal(await sourcePage.evaluate(()=>checkoutClicks),0);
  assert.deepEqual(foreign,[]);await context.close();

  for(const width of [390,1440]){
    const uiContext=await browser.newContext({viewport:{width,height:1000}});
    const page=await uiContext.newPage(),requests=[],runtimeErrors=[];
    page.on("pageerror",error=>runtimeErrors.push(error.message));
    await page.route("**/*",route=>{
      if(new URL(route.request().url()).origin!==origin){requests.push(route.request().url());return route.abort("blockedbyclient");}
      return route.continue();
    });
    await page.clock.install({time:new Date("2026-10-24T10:00:00Z")});
    await page.addInitScript(()=>{
      window.fixtureClipboard="";window.fixtureCalls=[];window.fixtureMode="normal";
      Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.fixtureClipboard=text;}}});
      window.fixtureObservation=query=>({
        provider:"playtomic",source:"user_ui_observation",sourceUrl:"https://playtomic.com/clubs/fictional-club",
        venue:"Fictional venue",date:query.date,sport:query.sport,capturedAt:new Date().toISOString(),
        timezone:null,sourceFreshness:"unknown",coverage:"expanded_offers_only",
        offers:[{court:"Fictional court <b>1</b>",startLabel:"2:00 PM",endLabel:"3:30 PM",durationMinutes:90,priceEur:36}]
      });
      window.chrome={runtime:{sendMessage:async message=>{
        fixtureCalls.push(message);
        if(message.action==="status")return {status:"connected",sourceUrl:"https://playtomic.com/clubs/fictional-club"};
        if(message.action==="revoke")return {status:"disconnected"};
        if(message.action==="search"){
          if(fixtureMode==="defer")return new Promise(resolve=>window.finishFixtureSearch=()=>resolve({status:"observed",observation:fixtureObservation(message.query)}));
          return {status:"observed",observation:fixtureObservation(message.query)};
        }
        return {status:"opened"};
      }}};
    });
    await page.goto(origin+"/reader.html");
    await page.getByText("Club connected. Search when you are ready.",{exact:true}).waitFor();
    assert.equal(await page.locator('input[type="password"]').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.locator("#date").fill("2026-10-25");
    await page.locator("#from").fill("14:00");
    await page.locator("#duration").selectOption("90");
    await page.locator("#search").click();
    await page.locator("#results article").waitFor();
    assert.equal(await page.locator("#results b").count(),0);
    assert.match(await page.locator("#results").innerText(),/Fictional court <b>1<\/b>/);
    assert.equal(await page.locator("#search").isDisabled(),true);
    assert.equal(await page.locator("#copyObservation").isEnabled(),true);
    await page.locator("#copyObservation").click();
    const copied=await page.evaluate(()=>JSON.parse(fixtureClipboard));
    assert.equal(copied.provider,"playtomic");
    assert.equal(copied.source,"user_ui_observation");
    assert.equal(copied.sourceFreshness,"unknown");
    assert.equal(copied.offers.length,1);
    assert.deepEqual(Object.keys(copied).sort(),["capturedAt","coverage","date","offers","provider","source","sourceFreshness","sourceUrl","sport","timezone","venue"].sort());
    if(artifactDir)await page.screenshot({path:join(artifactDir,"personal-reader-fictional-"+width+".png"),fullPage:true});
    await page.clock.fastForward(60001);
    assert.equal(await page.locator("#results article").count(),0);
    assert.equal(await page.locator("#copyObservation").isDisabled(),true);
    assert.match(await page.locator("#status").innerText(),/Observation expired/);
    assert.equal(await page.locator("#search").isDisabled(),false);
    assert.equal(await page.evaluate(()=>fixtureCalls.filter(x=>x.action==="search").length),1);
    await page.evaluate(()=>fixtureMode="defer");
    await page.locator("#search").click();
    await page.waitForFunction(()=>typeof finishFixtureSearch==="function");
    await page.locator("#disconnect").click();
    await page.getByText("Disconnected. Club preference and results cleared.",{exact:true}).waitFor();
    await page.evaluate(()=>finishFixtureSearch());
    await page.waitForFunction(()=>!document.getElementById("filters").disabled);
    assert.equal(await page.locator("#results article").count(),0);
    assert.equal(await page.locator("#search").isDisabled(),true);
    assert.match(await page.locator("#status").innerText(),/Disconnected/);
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),[]);
    assert.deepEqual(await page.evaluate(()=>Object.keys(sessionStorage)),[]);
    assert.deepEqual(requests,[]);assert.deepEqual(runtimeErrors,[]);checks++;
    await uiContext.close();
  }
  // CI must load the real MV3 package in an isolated temporary Chromium profile.
  // Branded Chrome removed side-loading flags; the local fixture-only fallback
  // intentionally does not claim this native extension smoke test.
  if(process.env.GAC_FIXTURE_BROWSER!=="chrome"){
    const extensionContext=await chromium.launchPersistentContext("",{channel:"chromium",headless:true,
      args:["--no-sandbox","--disable-extensions-except="+root,"--load-extension="+root]});
    try{
      let [worker]=extensionContext.serviceWorkers();
      if(!worker)worker=await extensionContext.waitForEvent("serviceworker",{timeout:10000});
      const extensionId=worker.url().split("/")[2],page=await extensionContext.newPage();
      await page.goto("chrome-extension://"+extensionId+"/reader.html");
      await page.getByText("Open the intended Playtomic club, click the GetACourt icon, then Connect and open GetACourt.",{exact:true}).waitFor();
      assert.equal(await page.locator("#search").isDisabled(),true);
      await page.goto("chrome-extension://"+extensionId+"/popup.html");
      await page.locator("#approve").click();
      await page.getByText("Open an official Playtomic /clubs/ page before connecting.",{exact:true}).waitFor();
      checks++;
    }finally{await extensionContext.close();}
  }
  console.log("PASS: "+checks+" fictional browser scenarios; no live provider traffic, credentials or Book clicks.");
}finally{
  await browser.close();await new Promise(done=>server.close(done));
}
