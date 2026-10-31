import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync("getacourt/assets/app.js","utf8");

test("PR12 integration retains current PKCE, referrer policy, installability and native booking gates",()=>{
  const html=readFileSync("getacourt/index.html","utf8");
  assert.match(html,/name="referrer" content="no-referrer"/);
  assert.match(html,/id="authHeading"/);assert.match(html,/id="googleSignInButton"/);
  assert.match(html,/assets\/auth-pkce.js/);assert.match(html,/id="installAppButton"/);
  assert.match(source,/await completeGoogleSignIn\(\)/);
  assert.match(source,/search\(\{initial:true\}\)/);
  assert.match(source,/state\.platform\.bookingEnabled && slot\.provider!=="fillmycourt"/);
  const manifest=JSON.parse(readFileSync("getacourt/manifest.webmanifest","utf8"));
  assert.equal(manifest.scope,"./");assert.equal(manifest.start_url,"./");
});

test("PR14 integration does not register the candidate or change the active app's cache lifecycle",()=>{
  for(const file of readdirSync("getacourt/assets").filter(name=>name.endsWith(".js")))
    assert.doesNotMatch(readFileSync("getacourt/assets/"+file,"utf8"),/serviceWorker\s*\.\s*register\s*\(|offline-safety\/sw\.js/);
  assert.doesNotMatch(readFileSync("getacourt/index.html","utf8"),/offline-safety\/sw\.js/);
  assert.match(readFileSync("getacourt/offline-safety/sw.js","utf8"),/gac-offline-shell-v1/);
});

test("Stale search completion cannot clear newer aria-busy; initial/date scroll and reduced motion survive",async()=>{
  const start=source.indexOf("  function loading()"),end=source.indexOf("  function useCurrentLocation()",start);
  assert.ok(start>=0&&end>start);
  const values=new Map(),requests=[],scrolls=[];let renders=0;
  const state={searchRevision:0,sport:"padel",geo:null};
  const el={location:{value:"SYNTHETIC"},date:{value:"2030-01-01",min:"2030-01-01"},
    from:{value:"09:00"},to:{value:"10:00"},dateStatus:{},radiusNote:{},count:{},title:{},
    grid:{setAttribute:(k,v)=>values.set(k,v),innerHTML:""}};
  const context={state,el,URLSearchParams,Number,
    validSearchDate:(v,min)=>v>=min,prettyDate:v=>v,shadowSignal(){},toast(){},renderWatchPrompt(){},
    render(){renders++;},window:{matchMedia:()=>({matches:true})},
    q:()=>({scrollIntoView:options=>scrolls.push(options)}),
    api:()=>new Promise(resolve=>requests.push(resolve))};
  vm.runInNewContext(source.slice(start,end)+"\nthis.search=search;",context);
  const old=context.search({initial:true}),current=context.search({scroll:false});
  assert.equal(values.get("aria-busy"),"true");
  requests[0]({venues:[]});await old;
  assert.equal(values.get("aria-busy"),"true");assert.equal(renders,0);
  requests[1]({venues:[]});await current;
  assert.equal(values.get("aria-busy"),"false");assert.equal(renders,1);assert.equal(scrolls.length,0);
  const manual=context.search();requests[2]({venues:[]});await manual;
  assert.equal(scrolls[0].behavior,"auto");
  const initial=context.search({initial:true});requests[3]({venues:[]});await initial;
  assert.equal(scrolls.length,1,"Initial search cannot skip the keyboard entry point");
});

test("Platform CI retains full regression and mandates both integrated browser proofs without deploy",()=>{
  const ci=readFileSync(".github/workflows/platform-ci.yml","utf8");
  const job=ci.slice(ci.indexOf("  integration-qa:"),ci.indexOf("  fast-contracts:"));
  assert.match(job,/getacourt\/tests\/integration-contract.test.mjs/);
  assert.match(job,/playwright-core@1.56.1 axe-core@4.14.0/);
  assert.match(job,/run: node getacourt\/tests\/browser-accessibility.mjs/);
  assert.match(job,/run: node getacourt\/offline-safety\/test\/browser-offline.mjs/);
  assert.doesNotMatch(job,/continue-on-error|netlify deploy|--prod|secrets\./);
  assert.match(ci,/pytest -q platform\/tests/);
  assert.match(ci,/getacourt_browser_e2e.mjs/);assert.match(ci,/getacourt_real_leaflet_e2e.mjs/);
});
