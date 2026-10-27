// Standalone, offline Playwright UAT for the isolated GetACourt accessibility lane.
// No live provider, auth, booking, payment or production service may be called.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,mkdir} from "node:fs/promises";
import {join,dirname,resolve,extname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const toolsPath=process.env.GAC_A11Y_TOOLS;
if(!toolsPath)throw Error("GAC_A11Y_TOOLS must resolve the CI's pinned browser tool installation");
const {chromium}=require(join(toolsPath,"playwright-core"));
const axeSource=await readFile(join(toolsPath,"axe-core","axe.min.js"),"utf8");
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const artifactDir=process.env.GAC_INTEGRATION_ARTIFACT_DIR;
if(artifactDir)await mkdir(artifactDir,{recursive:true});
const MIME={".js":"text/javascript; charset=utf-8",".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".webmanifest":"application/manifest+json",".png":"image/png"};

function sendJson(res,status,obj){
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(JSON.stringify(obj));
}
const forbidden=[];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/","http://localhost");
  if(req.method!=="GET"){forbidden.push(req.method+" "+url.pathname);sendJson(res,405,{error:"READ_ONLY_FIXTURE"});return;}
  if(url.pathname==="/api/gac/platform-config"){
    sendJson(res,200,{bookingEnabled:false,authConfigured:false,emailSignInEnabled:false,googleSignInEnabled:false,onlinePayments:false});return;
  }
  if(url.pathname==="/api/gac/search"){
    // Keep aria-busy observable. A zero-inventory fixture is intentional.
    await new Promise(done=>setTimeout(done,180));
    sendJson(res,200,{venues:[],search:{radiusUsedKm:10,expanded:false}});return;
  }
  if(url.pathname.startsWith("/api/")){
    forbidden.push(url.pathname);
    sendJson(res,403,{error:"NO_LIVE_SERVICE"});return;
  }
  const requested=url.pathname==="/"?"/index.html":url.pathname;
  const relative=requested.slice(1);
  if(!/^(index\.html|find\.html|manifest\.webmanifest|assets\/(?:app\.js|styles\.css|auth-pkce\.js|commercial-signals\.js|personal-booking-import\.js|icon-(?:192|512)\.png|court-search-page\.mjs|federated-search\.mjs|source-catalog\.mjs|federated-search\.css))$/.test(relative)){
    sendJson(res,404,{error:"NOT_FOUND"});return;
  }
  try{
    const buf=await readFile(join(root,relative));
    res.writeHead(200,{"content-type":MIME[extname(relative)],"cache-control":"no-store"});
    res.end(buf);
  }catch{
    sendJson(res,404,{error:"MISSING_FILE"});
  }
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const origin="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const widths=[320,390,768,1440];
let completed=0;
try{
  for(const width of widths){
    const context=await browser.newContext({viewport:{width,height:850},reducedMotion:"reduce"});
    const page=await context.newPage();
    const errors=[];
    const blocked=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){
        blocked.push(url.host);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await page.goto(origin+"/",{waitUntil:"domcontentloaded"});
    await page.locator("#resultCount").waitFor({state:"visible"});
    await page.waitForFunction(()=>document.querySelector("#resultsGrid")?.getAttribute("aria-busy")==="false"
      && document.querySelector("#resultCount")?.textContent?.includes("available slot"));
    const initialScroll=await page.evaluate(()=>window.scrollY);
    assert.ok(initialScroll<=2,width+" initial search must not jump past hero; y="+initialScroll);
    assert.equal(await page.locator("#myBookingsButton").isVisible(),true,width+" bookings visible");
    assert.equal(await page.locator("#myWatchesButton").isVisible(),true,width+" watches visible");
    assert.equal(await page.locator("#authButton").isVisible(),true,width+" account visible");
    const overflow=await page.evaluate(()=>({
      document:document.documentElement.scrollWidth,viewport:window.innerWidth,
      nav:document.querySelector(".nav").getBoundingClientRect().width
    }));
    assert.ok(overflow.document<=overflow.viewport+1,
      width+" document horizontal overflow "+JSON.stringify(overflow));

    // Keyboard Tab reaches the visible skip link; skip moves to the search landmark.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains("skip-link")),true,
      width+" skip link keyboard focus");
    assert.notEqual(await page.locator(".skip-link").evaluate(el=>getComputedStyle(el).outlineStyle),"none",
      width+" focus outline");
    await page.keyboard.press("Enter");
    await page.waitForFunction(()=>location.hash==="#discover");

    const sport=page.locator('[data-sport="squash"]');
    await sport.focus();
    await page.keyboard.press("Space");
    assert.equal(await sport.getAttribute("aria-pressed"),"true",width+" squash selected");
    assert.equal(await page.locator(".sport-chip[aria-pressed=true]").count(),1,
      width+" one sport selected");
    const filter=page.locator('[data-filter="indoor"]');
    await filter.focus();
    await page.keyboard.press("Space");
    assert.equal(await filter.getAttribute("aria-pressed"),"true",width+" indoor selected");
    assert.equal(await page.locator(".filter-pill[aria-pressed=true]").count(),1,
      width+" one filter selected");

    // A real keyboard action opens a native dialog; disabled email sign-in stays disabled.
    await page.locator("#authButton").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#authDialog").evaluate(el=>el.open),true,
      width+" auth dialog opened");
    assert.equal(await page.locator("#authEmail").isDisabled(),true,
      width+" delivery must remain off in staging");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#authDialog").evaluate(el=>el.open),false,
      width+" Escape dismisses modal");

    // Observe the busy transition and its announcement until the fixture finishes.
    await page.evaluate(()=>{
      window.__scrollOptions=[];
      Element.prototype.scrollIntoView=function(options){window.__scrollOptions.push(options);};
    });
    await page.locator(".search-cta").click();
    await page.waitForFunction(()=>document.querySelector("#resultsGrid")?.getAttribute("aria-busy")==="true");
    assert.match(await page.locator("#resultCount").innerText(),/Searching live inventory/);
    await page.waitForFunction(()=>document.querySelector("#resultsGrid")?.getAttribute("aria-busy")==="false"
      && document.querySelector("#resultCount")?.textContent?.includes("0 available slots"));
    assert.equal(await page.locator(".slot").count(),0,width+" no invented live slots");
    assert.equal(await page.evaluate(()=>window.__scrollOptions.at(-1)?.behavior),"auto",
      width+" reduced-motion programmatic scroll");
    assert.equal(await page.locator("#resultCount").getAttribute("aria-live"),"polite");

    // WCAG 2.2 A/AA axe-core audit on the rendered fixture. Rules cannot prove
    // full conformance; open real-provider and assistive-tech UAT is separate.
    await page.addScriptTag({content:axeSource});
    const evaluateAxe=()=>page.evaluate(async()=>{
      const report=await window.axe.run(document,{
        runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22a","wcag22aa"]}
      });
      return report.violations.map(v=>({
        id:v.id,impact:v.impact,description:v.description,
        nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})).slice(0,8)
      }));
    });
    const violations=await evaluateAxe();
    if(violations.length)console.error("AXE violations "+width+"px "+JSON.stringify(violations));
    assert.deepEqual(violations,[],width+" axe WCAG 2.2 A/AA audit");

    // Modal focus and dialog labelling must also pass a second audit.
    await page.locator("#authButton").click();
    const dialogViolations=await evaluateAxe();
    if(dialogViolations.length)console.error("AXE dialog violations "+width+"px "+JSON.stringify(dialogViolations));
    assert.deepEqual(dialogViolations,[],width+" axe modal WCAG 2.2 A/AA audit");
    await page.keyboard.press("Escape");

    // Audit all remaining dialogs as explicitly isolated UI states; no API
    // actions or sign-in are triggered by opening an empty native dialog.
    for(const dialogId of [
      "venueDialog","bookingDialog","bookingsDialog",
      "watchesDialog","watchDialog","profileDialog","importDialog"
    ]){
      await page.evaluate(id=>document.getElementById(id).showModal(),dialogId);
      const v=await evaluateAxe();
      if(v.length)console.error("AXE "+dialogId+" "+width+"px "+JSON.stringify(v));
      assert.deepEqual(v,[],width+" axe "+dialogId+" WCAG 2.2 A/AA audit");
      await page.evaluate(id=>document.getElementById(id).close(),dialogId);
    }


    assert.deepEqual(errors,[],width+" JS page errors");
    if(artifactDir){
      // Modal/skip-link tests may leave the page scrolled with restored focus.
      // Capture the stable entry layout, not full-page sticky-header artifacts.
      await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      await page.screenshot({path:join(artifactDir,`get-integrated-${width}-FIXTURE-ONLY.png`),fullPage:true});
    }
    // New release entry is extension-free and does not contact any source on load.
    await page.goto(origin+'/find.html',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Find courts',exact:true}).waitFor();
    await page.addScriptTag({content:axeSource});
    assert.deepEqual(await evaluateAxe(),[],width+' direct search WCAG 2.2 A/AA audit');
    assert.equal(await page.locator('#personalPayload').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(errors,[],width+' direct search JS errors');
    if(artifactDir)await page.screenshot({path:join(artifactDir,`get-direct-${width}-FIXTURE-ONLY.png`),fullPage:true});
    // External CDN assets are deliberately denied; they are not part of source UAT.
    assert.ok(blocked.every(host=>host==="unpkg.com"),width+" unexpected external origins "+blocked);
    completed++;
    console.log("PASS local Chromium GetACourt accessibility width="+width+
      " skip/focus/pressed/mobile-nav/auth-dialog/busy/reduced-motion/no-slots");
    await context.close();
  }
  assert.deepEqual(forbidden,[],"No booking, provider, payment, sign-in, or other API requests");
  console.log("PASS "+completed+"/4 Chromium viewports; zero external service requests");
}finally{
  await browser.close();
  await new Promise(done=>server.close(done));
}
