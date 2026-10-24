import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const root = new URL('../browser-companion/',import.meta.url);
const background = readFileSync(new URL('background.js',root),'utf8');
const capture = readFileSync(new URL('capture.js',root),'utf8');
const source = 'https://playtomic.com/clubs/fictional-club';
const popup = {id:'reader',url:'chrome-extension://reader/popup.html'};
const local = {url:'http://localhost:8765/personal-sources.html',frameId:0};
function harness() {
  const localStore={},session={},handlers={}; let calls=0,clock=100000,tabUrl=source,readImpl;
  const area = data => ({async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},async set(v){Object.assign(data,v);},async remove(k){delete data[k];},async clear(){for(const k of Object.keys(data))delete data[k];}});
  const chrome={runtime:{id:'reader',getURL:p=>'chrome-extension://reader/'+p,onMessage:{addListener:f=>handlers.internal=f},onMessageExternal:{addListener:f=>handlers.external=f}},storage:{local:area(localStore),session:area(session)},tabs:{query:async()=>[{id:1,url:tabUrl}],get:async()=>({url:tabUrl})},scripting:{executeScript:async()=>{calls++;return readImpl?readImpl():[{frameId:0,result:{sourceUrl:source,offers:[]}}];}}};
  let pairingSequence=0;
  const context=vm.createContext({chrome,URL,Date:class extends Date {static now(){return clock;}},crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++pairingSequence).padStart(12,'0')}`},importScripts:()=>{},capturePlaytomic:()=>{}});
  vm.runInContext(background,context);
  return {localStore,session,call:(external,action,sender=external?local:popup)=>new Promise(resolve=>handlers[external?'external':'internal'](external && session.pairingKey && !('pairingKey' in action) && ['read','revoke'].includes(action.action) ? {...action,pairingKey:session.pairingKey} : action,sender,resolve)),get calls(){return calls;},advance:()=>clock+=60000,changeTab:()=>tabUrl='https://playtomic.com/clubs/another-club',defer:()=>{let resolve;readImpl=()=>new Promise(r=>resolve=r);return value=>resolve(value);}};
}
test('no read before popup consent; persisted preference alone cannot restore tab access',async()=>{
  const h=harness();assert.equal((await h.call(true,{action:'read'})).status,'unavailable');assert.equal(h.calls,0);
  h.localStore.approvedSource=source;assert.equal((await h.call(true,{action:'read'})).status,'unavailable');assert.equal(h.calls,0);
});
test('exact local top-frame receiver, strict request fields, no external consent grant',async()=>{
  const h=harness();
  for(const sender of [{url:'https://getacourt.com/personal-sources.html',frameId:0},{url:'http://localhost:8765/other.html',frameId:0},{...local,frameId:1}])assert.equal((await h.call(true,{action:'read'},sender)).status,'unavailable');
  assert.equal((await h.call(true,{action:'approve'})).status,'unavailable');
  assert.equal((await h.call(false,{action:'approve',cookie:'fictional'})).status,'unavailable');assert.equal(h.calls,0);
});
test('approved read is bounded, cooldown survives requests, revoke removes preference and session',async()=>{
  const h=harness();assert.equal((await h.call(false,{action:'approve'})).status,'connected');
  assert.equal((await h.call(true,{action:'read'})).status,'observed');
  assert.equal((await h.call(true,{action:'read'})).status,'unavailable');assert.equal(h.calls,1);
  h.advance();assert.equal((await h.call(true,{action:'read'})).status,'observed');
  assert.equal((await h.call(true,{action:'revoke'})).status,'disconnected');
  assert.deepEqual(h.localStore,{});assert.deepEqual(h.session,{});
  assert.equal((await h.call(true,{action:'read'})).status,'unavailable');assert.equal(h.calls,2);
});
test('pairing capability is required even for the exact localhost origin and rotates on consent',async()=>{
  const h=harness();
  const first=await h.call(false,{action:'approve'});
  assert.match(first.pairingKey,/^[0-9a-f-]{36}$/);
  assert.equal(h.session.pairingKey,first.pairingKey);
  for(const bad of [{action:'read',pairingKey:'00000000-0000-4000-8000-111111111111'},{action:'read',pairingKey:''},{action:'revoke',pairingKey:'00000000-0000-4000-8000-111111111111'}]){
    assert.equal((await h.call(true,bad)).status,'unavailable');
  }
  assert.equal(h.calls,0);
  assert.equal((await h.call(true,{action:'read',pairingKey:first.pairingKey})).status,'observed');
  const second=await h.call(false,{action:'approve'});
  assert.notEqual(first.pairingKey,second.pairingKey);
  assert.equal((await h.call(true,{action:'read',pairingKey:first.pairingKey})).status,'unavailable');
  assert.equal((await h.call(true,{action:'revoke',pairingKey:first.pairingKey})).status,'unavailable');
  assert.equal((await h.call(true,{action:'revoke',pairingKey:second.pairingKey})).status,'disconnected');
  assert.deepEqual(h.localStore,{}); assert.deepEqual(h.session,{});
});
test('changed club tab cannot reuse approval',async()=>{
  const h=harness();await h.call(false,{action:'approve'});h.changeTab();
  assert.equal((await h.call(true,{action:'read'})).status,'unavailable');assert.equal(h.calls,0);
});
test('withdrawal rejects an in-flight completion and concurrent read',async()=>{
  const h=harness();await h.call(false,{action:'approve'});const finish=h.defer();
  const pending=h.call(true,{action:'read'});await new Promise(r=>setImmediate(r));
  assert.equal((await h.call(true,{action:'read'})).status,'unavailable');
  await h.call(true,{action:'revoke'});finish([{frameId:0,result:{sourceUrl:source}}]);
  assert.equal((await pending).status,'unavailable');
});
test('collector reads only rendered explicit offer and strips account query',()=>{
  const court={querySelector:()=>({innerText:'Fictional court\n1 options'})};
  const row={innerText:'3:30 PM - 5:00 PM • 90 min • €36.00 Book'};
  const button={getClientRects:()=>[{}],innerText:'Book',disabled:false,parentElement:row,closest:()=>({parentElement:{closest:()=>court}})};
  const region={querySelectorAll:s=>s==='input[type="date"]'?[{value:'2026-10-23'}]:s==='select'?[{selectedOptions:[{textContent:'Padel'}]}]:[button]};
  const heading={textContent:'Available courts',parentElement:region,getClientRects:()=>[{}]};
  const document={querySelectorAll:()=>[heading],querySelector:()=>({innerText:'Book a court in Fictional venue'})};
  const context=vm.createContext({URL,location:{href:source+'?user_id=discard'},document,getComputedStyle:()=>({visibility:'visible'}),module:{exports:{}}});
  vm.runInContext(capture,context);const collect=context.module.exports.capturePlaytomic;
  const result=collect();assert.equal(result.sourceUrl,source);assert.equal(result.timezone,null);assert.equal(result.sourceFreshness,'unknown');assert.equal(result.offers[0].priceEur,36);
  button.getClientRects=()=>[];assert.throws(()=>collect(),/Expand/);
  button.getClientRects=()=>[{}];row.innerText='3:30 PM - 5:00 PM • price unknown Book';assert.throws(()=>collect(),/format changed/);
});
test('package has no cookie, host, background network or booking automation permissions',()=>{
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert.equal(manifest.host_permissions,undefined);
  assert.deepEqual(manifest.externally_connectable.matches,['http://localhost/*']);
  const localPage=readFileSync(new URL('../personal-sources.html',import.meta.url),'utf8');
  const localUi=readFileSync(new URL('../assets/personal-sources.js',import.meta.url),'utf8');
  const popupPage=readFileSync(new URL('popup.html',root),'utf8');
  assert.match(localPage,/id="pairing"[^>]*type="password"/);
  assert.match(localUi,/pairingKey:pairingKey\(\)/);
  assert.match(localUi,/pagehide[\s\S]*byId\("pairing"\).value = ""/);
  assert.match(popupPage,/id="pairingKey"/);
  assert.doesNotMatch(background+capture,/\bfetch\s*\(|XMLHttpRequest|document\.cookie|localStorage|\.click\s*\(|setInterval|webRequest|debugger/);
});
