// Real local Chromium test for isolated Connected Accounts fixture-only UX.
// All traffic is loopback-static; no OAuth, provider access or customer data.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,mkdir} from "node:fs/promises";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const toolsPath=process.env.GAC_A11Y_TOOLS;
if(!toolsPath)throw Error("GAC_A11Y_TOOLS pinned browser tools are required");
const {chromium}=require(join(toolsPath,"playwright-core"));
const axe=await readFile(join(toolsPath,"axe-core","axe.min.js"),"utf8");
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const allowed=new Map([
  ["/qa/connected-accounts-demo.html","text/html; charset=utf-8"],
  ["/qa/connected-accounts-demo.js","text/javascript; charset=utf-8"],
  ["/qa/connected-accounts-lifecycle.js","text/javascript; charset=utf-8"],
  ["/qa/connected-accounts-demo.css","text/css; charset=utf-8"],
  ["/assets/provider-supply-contract.js","text/javascript; charset=utf-8"]
]);
const badRequests=[];
const server=createServer(async(req,res)=>{
  const name=new URL(req.url||"/","http://localhost").pathname;
  if(req.method!=="GET"||(!allowed.has(name)&&name!=="/test/axe.js")){
    badRequests.push(req.method+" "+name);
    res.writeHead(403,{"Content-Type":"text/plain","Cache-Control":"no-store"});res.end("Fixture-only");return;
  }
  try{
    const data=name==="/test/axe.js"?axe:await readFile(join(root,name));
    res.writeHead(200,{"Content-Type":name==="/test/axe.js"?"text/javascript; charset=utf-8":allowed.get(name),
      "Cache-Control":"no-store"});
    res.end(data);
  }catch{
    res.writeHead(404);res.end("Missing fixture source");
  }
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const origin="http://127.0.0.1:"+server.address().port;
const artifactDir=process.env.GAC_INTEGRATION_ARTIFACT_DIR;
if(artifactDir)await mkdir(artifactDir,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
let completed=0;
try{
  for(const width of [320,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:880},reducedMotion:"reduce"});
    const page=await context.newPage();
    const runtimeErrors=[],foreign=[];
    page.on("pageerror",e=>runtimeErrors.push(e.message));
    await page.route("**/*",async route=>{
      if(new URL(route.request().url()).origin!==origin){
        foreign.push(route.request().url());
        await route.abort("blockedbyclient");
      }else await route.continue();
    });
    await page.goto(origin+"/qa/connected-accounts-demo.html",{waitUntil:"load"});
    await page.locator("#providers button").first().waitFor();
    const overflow=await page.evaluate(()=>({content:document.documentElement.scrollWidth,view:innerWidth}));
    assert.ok(overflow.content<=overflow.view+1,width+" horizontal overflow "+JSON.stringify(overflow));

    assert.equal(await page.locator("#providers button").count(),5,width+" candidate providers");
    const touchHeights=await page.locator("#providers button").evaluateAll(buttons=>
      buttons.map(b=>b.getBoundingClientRect().height));
    assert.ok(touchHeights.every(h=>h>=44),width+" all provider buttons have accessible touch targets: "+touchHeights);
    assert.equal(await page.locator("#providers button[aria-pressed=true]").count(),1);
    assert.match(await page.locator("#status").innerText(),/NOT connected/);
    assert.match(await page.locator("#result").innerText(),/UNKNOWN.*0 slots/);
    assert.match(await page.locator("#requestLog").innerText(),/Provider HTTP requests: 0/);

    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains("skip")),true);
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(()=>document.activeElement?.id),"main");

    await page.locator('[data-provider="matchi"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator('[data-provider="matchi"]').getAttribute("aria-pressed"),"true");
    assert.match(await page.locator("#providerTitle").innerText(),/MATCHi/);
    assert.match(await page.locator("#status").innerText(),/NOT connected/);

    await page.locator("#consentButton").focus();
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#status").innerText(),/Demo consent noted locally/);
    assert.match(await page.locator("#status").innerText(),/NOT connected/);
    assert.equal(await page.locator("#consentButton").isDisabled(),true);
    assert.equal(await page.locator("#withdrawButton").isEnabled(),true);
    assert.equal(await page.locator("#expireButton").isEnabled(),true);
    await page.locator("#expireButton").click();
    assert.match(await page.locator("#status").innerText(),/Demo consent expired/);
    assert.match(await page.locator("#status").innerText(),/NOT connected/);
    assert.equal(await page.locator("#expireButton").isDisabled(),true);
    assert.equal(await page.locator("#reconnectButton").isEnabled(),true);
    await page.locator("#reconnectButton").click();
    assert.match(await page.locator("#status").innerText(),/Demo reconnect requested locally/);
    assert.match(await page.locator("#status").innerText(),/NOT connected/);
    assert.equal(await page.locator("#reconnectButton").isDisabled(),true);
    assert.equal(await page.locator("#withdrawButton").isEnabled(),true);

    await page.locator("#withdrawButton").click();
    assert.match(await page.locator("#status").innerText(),/Demo consent withdrawn/);
    assert.match(await page.locator("#status").innerText(),/NOT connected/);
    assert.equal(await page.locator("#withdrawButton").isDisabled(),true);

    await page.locator("#clubMode").click();
    assert.equal(await page.locator("#clubMode").getAttribute("aria-pressed"),"true");
    assert.match(await page.locator("#status").innerText(),/Club-owned supply rights remain unverified/);
    assert.equal(await page.locator("#consentButton").isDisabled(),true);
    assert.equal(await page.locator("#withdrawButton").isDisabled(),true);
    assert.equal(await page.locator("#expireButton").isDisabled(),true);
    assert.equal(await page.locator("#reconnectButton").isDisabled(),true);
    assert.match(await page.locator("#scopeMessage").innerText(),/player.s consent cannot authorize club data/);
    await page.locator('[data-provider="playtomic"]').click();
    assert.match(await page.locator("#description").innerText(),/not permission to use a player.s third-party account/);

    // Returning to player resets all ephemeral consent records.
    await page.locator("#playerMode").click();
    assert.match(await page.locator("#status").innerText(),/Provider account NOT connected/);
    assert.equal(await page.locator("#consentButton").isEnabled(),true);
    assert.equal(await page.locator("#withdrawButton").isDisabled(),true);
    assert.match(await page.locator("#result").innerText(),/UNKNOWN.*0 slots/);

    // axe-core WCAG 2.2 A/AA on the rendered interactive state, not a source guess.
    await page.addScriptTag({url:origin+"/test/axe.js"});
    const issues=await page.evaluate(async()=>{
      const r=await window.axe.run(document,{
        runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22a","wcag22aa"]}
      });
      return r.violations.map(v=>({
        id:v.id,impact:v.impact,
        nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})).slice(0,8)
      }));
    });
    if(issues.length)console.error("Connected Accounts axe "+width+" "+JSON.stringify(issues));
    assert.deepEqual(issues,[],width+" fixture WCAG 2.2 A/AA accessibility");
    const storage=await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}));
    assert.deepEqual(storage,{local:0,session:0});
    assert.deepEqual(runtimeErrors,[],width+" no JS errors");
    assert.deepEqual(foreign,[],width+" zero external requests");
    if(artifactDir){
      await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
      await page.screenshot({path:join(artifactDir,"get-connected-accounts-"+width+"-FIXTURE-ONLY.png"),fullPage:true});
    }
    completed++;
    console.log("PASS connected accounts fixture "+width+"px: consent/revoke/player-vs-club/no-slots/axe/zero-egress");
    await context.close();
  }
  assert.deepEqual(badRequests,[],"No unexpected local API/auth/provider requests");
  assert.equal(completed,4);
  console.log("PASS Connected Accounts isolated Chromium 4/4 viewports; no remote traffic or persistence");
}finally{
  await browser.close();
  await new Promise(done=>server.close(done));
}