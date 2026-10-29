// Unit acceptance for once-per-provider consent and Get-triggered UI search.
// Fictional provider, no network, auth cookie, password or real reservation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const base=new URL('../browser-companion/',import.meta.url);
const script=readFileSync(new URL('background.js',base),'utf8');
const relay=readFileSync(new URL('get-page-relay.js',base),'utf8');
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const source='https://playtomic.com/clubs/fictional-club';
const getPage='https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html';
const sender={id:'reader',url:getPage,frameId:0,tab:{id:9,url:getPage}};
const query={date:new Date().toISOString().slice(0,10),sport:'Padel',from:'08:00',to:'23:00',durationMinutes:90};

function fixture({approvedSource=source,grant=true,previousSession={},extraSources=null}={}){
  const local={...(approvedSource?{approvedSource}:{}),...(extraSources?{approvedExtraSources:extraSources}:{})},session={...previousSession};
  const handlers={},created=[],windows=[];let searchCount=0,newWindow=false;
  const store=data=>({
    async get(key){return Object.fromEntries((Array.isArray(key)?key:[key]).map(k=>[k,data[k]]));},
    async set(obj){Object.assign(data,obj);},
    async remove(keys){for(const key of (Array.isArray(keys)?keys:[keys]))delete data[key];}
  });
  const chrome={
    runtime:{id:'reader',getURL:p=>'chrome-extension://reader/'+p,onMessage:{addListener:f=>handlers.internal=f}},
    storage:{local:store(local),session:store(session)},
    permissions:{contains:async()=>grant},
    tabs:{
      query:async()=>[{id:1,windowId:5,url:source}],
      get:async id=>id===2?{id:2,windowId:newWindow?6:5,url:source,status:'complete'}:
        {id:1,windowId:5,url:source,status:'complete'},
      create:async data=>{created.push(data);return {id:2};},
      onUpdated:{addListener(){},removeListener(){}},
      sendMessage:async()=>({status:'delivered'}),
      update:async()=>{}
    },
    windows:{
      get:async id=>({width:id===6?480:1200}),
      create:async data=>{windows.push(data);if(data.tabId===2)newWindow=true;return {id:6};},
      update:async()=>{}
    },
    scripting:{executeScript:async data=>{if(data.func){
      searchCount++;
      return [{frameId:0,result:{sourceUrl:source,date:data.args[0].date,
        sport:data.args[0].sport,offers:[{court:'FICTIONAL',startLabel:'6:00 PM',
        endLabel:'7:30 PM',durationMinutes:90,priceEur:36}]}}];
    }return [];}}
  };
  const context=vm.createContext({chrome,URL,Date,setTimeout,clearTimeout,importScripts(){},
    globalThis:null});
  vm.runInContext(script,context);
  const call=(message,from=sender)=>new Promise(resolve=>handlers.internal(message,from,resolve));
  return {call,session,local,created,windows,get searchCount(){return searchCount;}};
}

test('without one-time site permission personal Get search fails closed, with zero provider UI work',async()=>{
  const f=fixture({grant:false});
  assert.equal((await f.call({action:'autoStatus'})).status,'not_configured');
  const response=await f.call({action:'autoSearchFromGet',query});
  assert.equal(response.status,'unavailable');
  assert.equal(response.code,'SITE_ACCESS_REQUIRED');
  assert.equal(f.searchCount,0);assert.equal(f.created.length,0);
});

test('one-time permission and ordinary remembered club survive service-worker and browser-tab restart',async()=>{
  const f=fixture();
  assert.equal((await f.call({action:'autoStatus'})).status,'configured');
  const result=await f.call({action:'autoSearchFromGet',query});
  assert.equal(result.status,'observed');
  assert.equal(result.observation.sourceUrl,source);
  assert.equal(f.created.length,1);
  assert.equal(f.created[0].url,source);
  assert.equal(f.created[0].active,false);
  assert.equal(f.windows[0].width,480);
  assert.equal(f.searchCount,1);
  assert.deepEqual(f.local,{approvedSource:source});
  assert.equal(Object.keys(f.session).includes('approvedTab'),true);
  const restarted=fixture({approvedSource:f.local.approvedSource});
  assert.equal((await restarted.call({action:'autoStatus'})).status,'configured');
  assert.equal((await restarted.call({action:'autoSearchFromGet',query})).status,'observed');
  assert.equal(restarted.searchCount,1);
  assert.ok(!JSON.stringify(restarted.local).includes('token'));
  assert.ok(!JSON.stringify(restarted.local).includes('cookie'));
  await restarted.call({action:'revoke'});
  assert.equal((await restarted.call({action:'autoSearchFromGet',query})).code,'CONNECT_REQUIRED');
});

test('normal provider challenge is not bypassed; no retry, no booking or payment',async()=>{
  const badSender={id:'reader',url:'https://wrong.example.invalid/',frameId:0,tab:{id:9}};
  const f=fixture();
  assert.equal((await f.call({action:'autoSearchFromGet',query},badSender)).code,'REQUEST_REJECTED');
  assert.equal(f.searchCount,0);
  assert.equal((await f.call({action:'autoSearchFromGet',query})).status,'observed');
  assert.equal((await f.call({action:'autoSearchFromGet',query})).code,'RATE_LIMITED');
  const combined=script+relay;
  assert.doesNotMatch(combined,/\bfetch\s*\(|XMLHttpRequest|document\.cookie|navigator\.credentials|webRequest|debugger/);
  assert.doesNotMatch(combined,/\.click\(\).*?(?:Book|Continue|Pay)/);
});

test('site permission is optional and Get relay is limited to the exact protected site',()=>{
  assert.deepEqual(manifest.optional_host_permissions,[
    'https://playtomic.com/*','https://clubs.tiesports.com/*',
    'https://racket.id/*','https://smashpro.pt/*','https://www.matchi.se/*'
  ]);
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.externally_connectable,undefined);
  assert.deepEqual(manifest.content_scripts.map(x=>x.matches),[[getPage]]);
  assert.match(readFileSync(new URL('popup.js',base),'utf8'),/chrome\.permissions\.request/);
  const listeners={},notifications=[],window={
    addEventListener:(name,handler)=>{listeners[name]=handler;},
    dispatchEvent:event=>{notifications.push(event);},
  };
  window.top=window;
  const context={window,location:{href:getPage},chrome:{runtime:{sendMessage:async message=>{
    assert.equal(message.action,'autoSearchPlaytomicClubsFromGet');
    assert.equal(message.query.sport,'Padel');
    assert.equal(message.query.location,'Cascais');
    assert.equal(message.query.durationMinutes,90);
    return {status:'observed',observation:{sourceUrl:source}};
  }}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}}};
  vm.runInNewContext(relay,context);
  assert.ok(listeners['gac:auto-search-request']);
  listeners['gac:auto-search-request']({detail:{nonce:'a'.repeat(48),query:{
    location:'Cascais',sport:'padel',date:'2026-10-29',from:'08:00',to:'23:00',duration:'90'}}});
  assert.equal(notifications[0].type,'gac:auto-search-accepted');
  const otherListeners={},otherWindow={
    top:null,addEventListener:(name,handler)=>{otherListeners[name]=handler;},
    dispatchEvent:()=>{}
  };
  otherWindow.top=otherWindow;
  vm.runInNewContext(relay,{...context,window:otherWindow,location:{href:'https://evil.invalid/find.html'}});
  assert.equal(Object.keys(otherListeners).length,0);
});


test('extra provider browser-only search requires a saved, separately approved first-party site',async()=>{
  const src='https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy';
  const none=fixture({extraSources:{tiesports:src},grant:false});
  const missing=await none.call({action:'autoSearchAdditionalFromGet',query});
  assert.equal(missing.status,'partial');
  assert.equal(missing.sources.length,1);
  assert.equal(missing.sources[0].code,'SITE_ACCESS_REQUIRED');
  assert.equal(none.created.length,0);
  const valid=fixture({extraSources:{tiesports:src},grant:true});
  const output=await valid.call({action:'autoSearchAdditionalFromGet',query});
  // Test harness deliberately returns a Playtomic result for a TieSports tab:
  // must fail closed rather than laundering source identifiers across sites.
  assert.equal(output.status,'partial');
  assert.equal(output.sources.length,1);
  assert.equal(output.sources[0].status,'unavailable');
  assert.equal(output.sources[0].code,'OFFER_FORMAT_CHANGED');
  assert.equal(valid.created.length,1);
  assert.equal(valid.created[0].url,src);
  const rejected=await valid.call({action:'autoSearchAdditionalFromGet',query},
    {id:'reader',url:'https://evil.invalid/find.html',frameId:0,tab:{id:9}});
  assert.equal(rejected.code,'REQUEST_REJECTED');
  await valid.call({action:'revoke'});
  assert.equal(valid.local.approvedExtraSources,undefined);
});
