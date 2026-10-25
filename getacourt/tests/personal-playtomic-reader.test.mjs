import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const root=new URL("../browser-companion/",import.meta.url);
const background=readFileSync(new URL("background.js",root),"utf8");
const capture=readFileSync(new URL("capture.js",root),"utf8");
const search=readFileSync(new URL("search.js",root),"utf8");
const source="https://playtomic.com/clubs/fictional-club";
const popup={id:"reader",url:"chrome-extension://reader/popup.html"};
const reader={id:"reader",url:"chrome-extension://reader/reader.html",frameId:0};
const query={date:"2026-10-25",sport:"Padel",from:"14:00",to:"20:00",durationMinutes:90};
function observation(){return {sourceUrl:source,date:query.date,sport:query.sport,offers:[]};}
function harness(shared){
  const localStore=shared?.localStore||{},session=shared?.session||{},handlers={},created=[],windows=[],canceled=[];
  let calls=0,clock=Date.parse("2026-10-24T10:00:00.000Z"),tabUrl=source,readImpl,tabMissing=false,compactFailure=false,setImpl;
  const area=data=>({
    async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},
    async set(value){if(setImpl)await setImpl();Object.assign(data,value);},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];}
  });
  const chrome={
    runtime:{id:"reader",getURL:p=>"chrome-extension://reader/"+p,onMessage:{addListener:f=>handlers.internal=f},onMessageExternal:{addListener:()=>{throw Error("No external receiver allowed");}}},
    storage:{local:area(localStore),session:area(session)},
    tabs:{query:async()=>[{id:1,windowId:5,url:tabUrl}],get:async()=>{if(tabMissing)throw Error("fictional-private-tab");return {id:1,windowId:5,url:tabUrl};},
      create:async data=>{created.push({...data});return {id:2};},update:async()=>{},sendMessage:async(id,data)=>{canceled.push({id,...data});}},
    windows:{get:async()=>({width:1200}),create:async data=>{if(compactFailure)throw Error("fictional-private-window");windows.push({...data});return {id:6};},update:async()=>{}},
    scripting:{executeScript:async options=>{if(options.files)return [];calls++;return readImpl?readImpl():[{frameId:0,result:observation()}];}}
  };
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  vm.runInContext(background,vm.createContext({chrome,URL,Date:ClockDate,importScripts:()=>{},capturePlaytomic:()=>{}}));
  const call=(message,sender=reader)=>new Promise(resolve=>handlers.internal(message,sender,resolve));
  return {localStore,session,handlers,created,windows,canceled,call,connect:()=>call({action:"approve"},popup),
    advance:()=>clock+=60000,changeTab:()=>tabUrl="https://playtomic.com/padel-courts",closeTab:()=>tabMissing=true,
    captureResult:value=>readImpl=async()=>[{frameId:0,result:value}],rejectInjection:()=>readImpl=async()=>{throw Error("fictional-private-browser");},
    breakCompact:()=>compactFailure=true,get calls(){return calls;},
    defer:()=>{let resolve;readImpl=()=>new Promise(r=>resolve=r);return value=>resolve(value);},
    deferConsent:()=>{let resolve;setImpl=()=>new Promise(r=>resolve=r);return ()=>{setImpl=undefined;resolve();};}
  };
}
test("one popup approval opens the packaged reader, without IDs, codes or a localhost receiver",async()=>{
  const h=harness();
  assert.equal((await h.call({action:"read"})).code,"CONNECT_REQUIRED");
  const result=await h.connect();assert.equal(result.status,"connected");
  assert.equal(result.pairingKey,undefined);
  assert.deepEqual(h.localStore,{approvedSource:source});
  assert.deepEqual(h.session,{approvedTab:1});
  assert.deepEqual(h.created,[{url:"chrome-extension://reader/reader.html"}]);
  assert.equal((await h.call({action:"status"})).status,"connected");
  assert.equal((await h.call({action:"read"})).status,"observed");
  assert.equal(h.handlers.external,undefined);
});
test("reopening the reader or service worker keeps an existing session; a stored preference cannot grant a new session",async()=>{
  const first=harness();await first.connect();
  const resumed=harness(first);
  assert.equal((await resumed.call({action:"read"})).status,"observed");
  const restart=harness({localStore:first.localStore});
  assert.equal((await restart.call({action:"status"})).status,"disconnected");
  assert.equal((await restart.call({action:"read"})).code,"CONNECT_REQUIRED");
});
test("only exact packaged callers can search; neither a website nor the reader can grant tab consent",async()=>{
  const h=harness();
  for(const sender of [
    {url:"http://localhost:8765/personal-sources.html",frameId:0},
    {id:"foreign",url:reader.url,frameId:0},{...reader,url:reader.url+"?spoof=1"},{...reader,frameId:1},
    {id:"reader",url:"https://playtomic.com/clubs/fictional-club"}
  ])assert.equal((await h.call({action:"search",query},sender)).code,"REQUEST_REJECTED");
  assert.equal((await h.call({action:"approve"})).code,"REQUEST_REJECTED");
  assert.equal((await h.call({action:"search",query},popup)).code,"REQUEST_REJECTED");
  assert.equal(h.calls,0);assert.equal(h.created.length,0);
});
test("strict query bounds reject credentials, arbitrary URLs, dates, sports and excessive ranges before any provider work",async()=>{
  const h=harness();await h.connect();
  for(const message of [
    {action:"search",query,cookie:"fictional"},
    {action:"read",pairingKey:"retired"},
    ...[{...query,date:"2026-02-30"},{...query,date:"2026-10-23"},{...query,date:"2026-11-08"},
      {...query,sport:"Other"},{...query,from:"20:01",to:"20:00"},{...query,from:"25:00"},
      {...query,durationMinutes:360},{...query,url:source}].map(query=>({action:"search",query}))
  ])assert.equal((await h.call(message)).status,"unavailable");
  assert.equal(h.calls,0);assert.equal(h.windows.length,0);
});
test("one requested search moves only the approved tab and respects its query date and sport",async()=>{
  const h=harness();await h.connect();
  assert.equal((await h.call({action:"search",query})).status,"observed");
  assert.deepEqual(h.windows,[{tabId:1,type:"normal",width:480,height:850,focused:false}]);
  h.advance();h.captureResult({...observation(),date:"2026-10-26"});
  assert.equal((await h.call({action:"search",query})).code,"SCHEDULE_NOT_READY");
});
test("cooldown spans reads, searches, reconnect and disconnect; bursts never reach injection",async()=>{
  const h=harness();await h.connect();await h.call({action:"search",query});
  assert.equal((await h.call({action:"search",query})).code,"RATE_LIMITED");
  await h.connect();
  assert.equal((await h.call({action:"read"})).code,"RATE_LIMITED");
  await h.call({action:"revoke"});await h.connect();
  assert.equal((await h.call({action:"search",query})).code,"RATE_LIMITED");
  assert.equal(h.calls,1);
  h.advance();assert.equal((await h.call({action:"read"})).status,"observed");
});
test("changed/lost tabs and native failures stay unavailable with no reflected exception data",async()=>{
  const h=harness();await h.connect();h.changeTab();
  assert.equal((await h.call({action:"read"})).code,"TAB_CHANGED");
  h.closeTab();const closed=await h.call({action:"read"});
  assert.equal(closed.code,"TAB_ACCESS_REQUIRED");assert.doesNotMatch(JSON.stringify(closed),/fictional-private/);
  const broken=harness();await broken.connect();broken.rejectInjection();
  const failed=await broken.call({action:"read"});
  assert.equal(failed.code,"TAB_ACCESS_REQUIRED");assert.doesNotMatch(JSON.stringify(failed),/fictional-private/);
  const compact=harness();await compact.connect();compact.breakCompact();
  assert.equal((await compact.call({action:"search",query})).code,"COMPACT_VIEW_REQUIRED");assert.equal(compact.calls,0);
});
test("revoke cancels an in-flight search, removes consent and prevents late results",async()=>{
  const h=harness();await h.connect();const finish=h.defer();
  const pending=h.call({action:"search",query});await new Promise(r=>setImmediate(r));
  assert.equal((await h.call({action:"read"})).code,"READ_BUSY");
  assert.equal((await h.call({action:"revoke"})).status,"disconnected");
  finish([{frameId:0,result:observation()}]);
  assert.equal((await pending).code,"CONSENT_WITHDRAWN");
  assert.deepEqual(h.localStore,{});assert.equal(h.session.approvedTab,undefined);
  assert.ok(h.canceled.some(x=>x.id===1&&x.action==="cancelPersonalSearch"));
  h.advance();assert.equal((await h.call({action:"read"})).code,"CONNECT_REQUIRED");
});
test("a revoke queued during approval wins without a late restored grant",async()=>{
  const h=harness();const finish=h.deferConsent();
  const approval=h.connect();await new Promise(r=>setImmediate(r));
  const revocation=h.call({action:"revoke"});
  assert.equal((await h.call({action:"read"})).code,"CONSENT_WITHDRAWN");
  finish();await approval;await revocation;
  assert.deepEqual(h.localStore,{});assert.equal(h.session.approvedTab,undefined);
});
test("known capture failures survive injection; unrecognized failures are generic and never observations",async()=>{
  for(const code of ["NO_EXPANDED_OFFERS","OFFER_FORMAT_CHANGED","OFFER_SECTION_MISSING","CHALLENGE_REQUIRED","CONSENT_WITHDRAWN","fictional-private-error"]){
    const h=harness();await h.connect();h.captureResult({readerError:code});
    const result=await h.call({action:"search",query});
    assert.equal(result.status,"unavailable");assert.equal(result.observation,undefined);
    assert.equal(result.code,code==="fictional-private-error"?"READ_FAILED":code);
    assert.doesNotMatch(JSON.stringify(result),/fictional-private/);
  }
});
test("collector accepts only rendered explicit offers, strips account queries and enforces bounded search filters",()=>{
  const court={querySelector:()=>({innerText:"Fictional court\n1 options"})};
  const row={innerText:"3:30 PM - 5:00 PM • 90 min • €36.00 Book"};
  const button={getClientRects:()=>[{}],innerText:"Book",disabled:false,parentElement:row,closest:()=>({parentElement:{closest:()=>court}})};
  const region={querySelector:()=>({}),querySelectorAll:s=>s==='input[type="date"]'?[{value:"2026-10-25"}]:s==="select"?[{getClientRects:()=>[{}],selectedOptions:[{textContent:"Padel"}]}]:s==="button"?[button]:[]};
  const heading={textContent:"Available courts",parentElement:region,getClientRects:()=>[{}]};
  const document={querySelectorAll:s=>s==="h2"?[heading]:[],querySelector:()=>({innerText:"Book a court in Fictional venue"})};
  const context=vm.createContext({URL,location:{href:source+"?user_id=discard"},document,getComputedStyle:()=>({visibility:"visible"}),module:{exports:{}}});
  vm.runInContext(capture,context);const collect=context.module.exports.capturePlaytomic;
  const result=collect();assert.equal(result.sourceUrl,source);assert.equal(result.sourceFreshness,"unknown");assert.equal(result.offers[0].priceEur,36);
  assert.equal(collect({courts:["Other court"],fromMinutes:0,toMinutes:1439,durationMinutes:0}).readerError,"NO_EXPANDED_OFFERS");
  assert.equal(collect({courts:["Fictional court"],fromMinutes:0,toMinutes:1439,durationMinutes:60}).readerError,"NO_EXPANDED_OFFERS");
  button.getClientRects=()=>[];assert.equal(collect().readerError,"NO_EXPANDED_OFFERS");
  button.getClientRects=()=>[{}];row.innerText="price unknown Book";assert.equal(collect().readerError,"OFFER_FORMAT_CHANGED");
});
test("package has unchanged narrow permissions, no external bridge, no credential input or provider transport",()=>{
  const manifest=JSON.parse(readFileSync(new URL("manifest.json",root),"utf8"));
  assert.deepEqual(manifest.permissions,["activeTab","scripting","storage"]);assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.externally_connectable,undefined);assert.equal(manifest.web_accessible_resources,undefined);
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
  const page=readFileSync(new URL("reader.html",root),"utf8"),ui=readFileSync(new URL("reader.js",root),"utf8");
  assert.doesNotMatch(page,/id="(?:pairing|extension)"/);assert.doesNotMatch(ui,/localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(background+capture+search,/\bfetch\s*\(|XMLHttpRequest|document\.cookie|setInterval|webRequest|debugger/);
  // White DIV-grid disclosures and named Close are now necessary for the
  // verified Playtomic UI. Continue/Book/Pay and form submissions stay forbidden.
  assert.match(search,/cell\.click\(\)/);
  assert.match(search,/close\.click\(\)/);
  assert.match(search,/"bg-white"/);
  assert.doesNotMatch(search,/(?:book|continue|checkout|pay)\.click\s*\(|submit\s*\(|requestSubmit\s*\(/i);
  assert.match(search,/courtStarts>=2/);assert.match(search,/slice\(0,3\)/);
});
