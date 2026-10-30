// Two independent player-signed-in UI sources from ONE Get Find action.
// FICTIONAL HTML/observations only. No network, provider API or credentials.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {normalizePersonalObservation} from "../assets/personal-observation-bridge.mjs";
const require=createRequire(import.meta.url);
const validate=require("../assets/personal-source-observation.js").validateObservation;
const base=new URL("../browser-companion/",import.meta.url);
const background=readFileSync(new URL("background.js",base),"utf8");
const observations=readFileSync(new URL("observation.js",base),"utf8");
const relay=readFileSync(new URL("get-page-relay.js",base),"utf8");
const source1="https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy";
const source2="https://racket.id/booking";
const pageUrl="https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html";
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const q={location:"Lisboa",sport:"padel",date,from:"08:00",to:"23:00",duration:"90"};
const providerQuery={date,sport:"Padel",from:"08:00",to:"23:00",durationMinutes:90};
const official={
  tiesports:{url:source1,venue:"OPA OEIRAS"},
  racket_id:{url:source2,venue:"Rackets Pro Academy — Quinta da Marinha"}
};
function rig({denyRacket=false,wrongProvider=false,timeoutRacket=false,revokeRacket=false,existingRacket=false}={}){
  const local={approvedExtraSources:{tiesports:source1,racket_id:source2}};
  const session={},created=[],removed=[],calls=[],listeners={},consentReplies=[];
  const get=(data,keys)=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,data[key]]));
  let nextId=3;
  const storage=data=>({
    get:async keys=>get(data,keys),
    set:async obj=>Object.assign(data,obj),
    remove:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(k=>delete data[k])
  });
  const chrome={
    runtime:{id:"reader",getURL:p=>"chrome-extension://reader/"+p,onMessage:{addListener:f=>listeners.msg=f}},
    storage:{local:storage(local),session:storage(session)},
    permissions:{contains:async o=>!denyRacket||!o.origins.includes("https://racket.id/*")},
    tabs:{
      query:async filter=>filter?.url===source2&&existingRacket
        ?[{id:2,url:source2,windowId:1,status:"complete"}]
        :[{id:1,url:source1,windowId:1,status:"complete"}],
      create:async o=>{const tab={...o,id:nextId++};created.push(tab);return tab;},
      get:async id=>{
        const tab=created.find(t=>t.id===id);
        if(timeoutRacket&&tab?.url===source2)throw Error("TAB_LOAD_TIMEOUT");
        return {id,windowId:1,url:tab?.url||source1,status:"complete"};
      },
      remove:async id=>{removed.push(id);},
      onUpdated:{addListener(){},removeListener(){}},
      sendMessage:async()=>({status:"delivered"}),
      update:async()=>{}
    },
    windows:{get:async()=>({width:480}),create:async()=>({id:1}),update:async()=>{}},
    scripting:{executeScript:async data=>{
      if(data.files){
        calls.push({files:data.files});
        if(revokeRacket&&created.at(-1)?.url===source2)
          listeners.msg({action:"revoke"},sender,()=>{});
        return [];
      }
      const url=data.target.tabId===2?source2:created.find(t=>t.id===data.target.tabId)?.url;
      const provider=url===source1?"tiesports":"racket_id";
      const reference=official[provider];
      if(provider==='racket_id'&&data.args?.[0]?.location){
        const ask=(sender)=>new Promise(resolve=>listeners.msg({action:'racketNavigationConsent',epoch:data.args[1]},sender,resolve));
        consentReplies.push(await ask({id:'reader',url:source2,frameId:0,tab:{id:data.target.tabId}}));
        consentReplies.push(await ask({id:'reader',url:source2,frameId:0,tab:{id:999}}));
      }
      const offer={
        provider:wrongProvider&&provider==="racket_id"?"tiesports":provider,
        source:"user_ui_observation",sourceUrl:reference.url,venue:reference.venue,
        date,sport:"Padel",capturedAt:new Date().toISOString(),
        timezone:null,sourceFreshness:"unknown",coverage:"expanded_offers_only",
        offers:[{court:"Court 1",startLabel:"6:00 PM",endLabel:"7:30 PM",
          durationMinutes:90,priceEur:provider==="tiesports"?36:38}]
      };
      calls.push({source:url,func:true});
      return [{frameId:0,result:offer}];
    }}
  };
  const ctx=vm.createContext({chrome,URL,Date,setTimeout,clearTimeout,importScripts(){}});
  vm.runInContext(observations,ctx);
  vm.runInContext(background,ctx);
  const sender={id:"reader",url:pageUrl,frameId:0,tab:{id:9,url:pageUrl}};
  const send=message=>new Promise(resolve=>listeners.msg(message,sender,resolve));
  const posted=[],events={},window={
    addEventListener:(key,fn)=>events[key]=fn,
    dispatchEvent:ev=>{posted.push(ev);events[ev.type]?.(ev);}
  };
  window.top=window;
  const target=vm.createContext({window,location:{href:pageUrl},
    chrome:{runtime:{sendMessage:send}},
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
  vm.runInContext(relay,target);
  return {chrome,local,session,calls,posted,events,created,removed,send,consentReplies};
}
function find(rig){
  rig.events["gac:additional-sources-request"]({
    detail:{nonce:"d".repeat(48),query:q}
  });
}
const response=async rig=>{
  await new Promise(resolve=>setImmediate(resolve));
  return rig.posted.findLast(e=>e.type==="gac:additional-sources-response")?.detail?.result;
};
test("one Find fans out to independently consented TieSports and Racket ID session UI, preserving two official booking handoffs",async()=>{
  const r=rig();find(r);
  const result=await response(r);
  assert.equal(result.status,"partial");
  assert.equal(result.sources.length,2);
  assert.equal(result.sources.filter(s=>s.status==="observed").length,2);
  assert.equal(r.created.length,2);
  assert.deepEqual(r.created.map(x=>x.url),[source1,source2]);
  assert.deepEqual(r.removed,r.created.map(x=>x.id));
  assert.ok(!r.removed.includes(1));
  assert.equal(r.calls.filter(x=>x.func).length,2);
  for(const item of result.sources){
    const clean=validate(item.observation);
    const normalized=normalizePersonalObservation(JSON.stringify(clean),q,
      {now:Date.now(),validator:validate});
    assert.equal(normalized.sourceId,item.provider);
    assert.equal(normalized.offers.length,1);
    assert.equal(normalized.offers[0].sourceUrl,official[item.provider].url);
    assert.equal(normalized.offers[0].bookingEnabled,false);
    assert.equal(normalized.offers[0].priceMinor,item.provider==="tiesports"?3600:3800);
  }
  assert.equal(r.calls.some(x=>x.network),false);
  assert.ok(!JSON.stringify(r.local).includes("access_token"));
  assert.ok(!JSON.stringify(r.local).includes("cookie"));
});
test("failure of one platform permission or forged provider payload leaves independent valid source usable",async()=>{
  for(const options of [{denyRacket:true},{wrongProvider:true}]){
    const r=rig(options);find(r);
    const result=await response(r);
    assert.equal(result.sources.length,2);
    assert.equal(result.sources[0].provider,"tiesports");
    assert.equal(result.sources[0].status,"observed");
    assert.equal(result.sources[1].provider,"racket_id");
    assert.equal(result.sources[1].status,"unavailable");
    assert.equal(result.sources[1].code,
      options.denyRacket?"SITE_ACCESS_REQUIRED":"OFFER_FORMAT_CHANGED");
    assert.deepEqual(r.removed,r.created.map(x=>x.id));
    assert.ok(!r.removed.includes(1));
  }
});
test("each owned temporary tab closes after timeout, access revoke, or a partial provider result",async()=>{
  for(const [options,code] of [
    [{timeoutRacket:true},"READ_FAILED"],
    [{revokeRacket:true},"CONSENT_WITHDRAWN"]
  ]){
    const r=rig(options);find(r);
    const result=await response(r);
    assert.equal(result.status,"partial");
    assert.equal(result.sources[0].status,"observed");
    assert.equal(result.sources[1].status,"unavailable");
    assert.equal(result.sources[1].code,code);
    assert.deepEqual(r.removed,r.created.map(x=>x.id));
    assert.ok(!r.removed.includes(1));
  }
});
test("a later explicit Find cleans only its own newly created provider tabs",async()=>{
  const r=rig();
  find(r);await response(r);
  delete r.session["lastAttemptExtra:tiesports"];
  delete r.session["lastAttemptExtra:racket_id"];
  find(r);await response(r);
  assert.equal(r.created.length,4);
  assert.deepEqual(r.removed,r.created.map(x=>x.id));
  assert.ok(!r.removed.includes(1));
});
test("Get Find reads the one existing approved Racket preview and never closes the player's tab",async()=>{
  const r=rig({existingRacket:true});
  const result=await r.send({action:'autoSearchAdditionalFromGet',query:providerQuery});
  assert.equal(result.sources[1].status,'observed');
  assert.deepEqual(r.created.map(t=>t.url),[source1]);
  assert.deepEqual(r.removed,r.created.map(t=>t.id));
  assert.ok(!r.removed.includes(2));
});
test("Racket navigation consent is bound to the active owned tab and cannot be borrowed by the Get page",async()=>{
  const r=rig();
  assert.equal((await r.send({action:'racketNavigationConsent',epoch:0})).allowed,false);
  find(r);await response(r);
  assert.deepEqual(r.consentReplies.map(v=>v.allowed),[true,false]);
  assert.equal((await r.send({action:'racketNavigationConsent',epoch:0})).allowed,false);
});
test("normal Find carries location and owns its navigation tab, leaving an existing player tab untouched",async()=>{
  const r=rig({existingRacket:true});find(r);
  const result=await response(r);
  assert.equal(result.sources[1].status,'observed');
  assert.deepEqual(r.created.map(t=>t.url),[source1,source2]);
  assert.deepEqual(r.removed,r.created.map(t=>t.id));
  assert.ok(!r.removed.includes(2));
});
test("no provider is searched without an explicit Get Find gesture, no repeated bulk polling",async()=>{
  const r=rig();
  assert.equal(r.created.length,0);
  assert.equal(r.calls.length,0);
  find(r);await response(r);
  assert.equal(r.created.length,2);
  const forbidden=background+relay;
  assert.doesNotMatch(forbidden,/\bfetch\s*\(|XMLHttpRequest|document\.cookie|navigator\.credentials|webRequest|debugger/);
});

// Run the real page event handlers against a minimal DOM. This exercises the
// failed live path without accessing a real provider, extension or session.
function pageRig(){
  const pageQuery={...q,location:'Cascais'},handlers={},posted=[],nodes=new Map(),timers=new Map();
  let nextTimer=0,nonceByte=0;
  const element=()=>({children:[],events:{},value:'',textContent:'',
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=items;},
    addEventListener(name,fn){this.events[name]=fn;}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  node('search').elements={namedItem:()=>node('date')};
  const context=vm.createContext({Date,URL,Intl,TextEncoder,Uint8Array,JSON,
    normalizePersonalObservation,validateQuery:value=>value,localDay:()=>date,
    FormData:class extends Map {constructor(){super(Object.entries(pageQuery));}},
    crypto:{getRandomValues:array=>array.fill(++nonceByte)},
    setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},
    clearTimeout:id=>timers.delete(id),
    document:{getElementById:node,createElement:element,documentElement:{dataset:{}},addEventListener(){}},
    window:{addEventListener:(name,fn)=>handlers[name]=fn,dispatchEvent:event=>posted.push(event)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    GetACourtPersonalSourceObservation:{validateObservation:validate}
  });
  const page=readFileSync(new URL('../assets/court-search-page.mjs',import.meta.url),'utf8');
  vm.runInContext(page.replace(/^import .*;\r?$/gm,''),context);
  const find=()=>{
    node('search').events.submit({preventDefault(){}});
    return posted.findLast(e=>e.type==='gac:additional-sources-request').detail.nonce;
  };
  const respond=(nonce,result,type='gac:additional-sources-response')=>handlers[type]({detail:{nonce,result}});
  const text=el=>[el.textContent,...el.children.map(text)].join(' ');
  const expire=()=>{for(const {fn,delay} of [...timers.values()])if(delay===45000)fn();};
  const ack=nonce=>handlers['gac:auto-search-accepted']({detail:{nonce}});
  return {find,respond,node,text:id=>text(node(id)),timers,expire,ack};
}

test('page exposes top-level additional failure and genuinely returned version without raw exception data',()=>{
  for(const result of [
    {status:'unavailable',code:'REQUEST_REJECTED',version:'0.4.2',error:'PRIVATE EXCEPTION'},
    {status:'unavailable',code:'PRIVATE CODE',version:'0.4.2',error:'PRIVATE EXCEPTION'}
  ]){
    const p=pageRig();p.respond(p.find(),result);
    const coverage=p.text('sourceStatus');
    assert.match(coverage,/Racket ID Additional provider search failed/);
    assert.match(coverage,/connection and availability unverified/);
    assert.match(coverage,result.code==='REQUEST_REJECTED'?/REQUEST_REJECTED.*Reader 0\.4\.2/:/UNKNOWN.*Reader 0\.4\.2/);
    assert.doesNotMatch(coverage,/PRIVATE|Not connected/);
  }
});

test('empty, missing or oversized source lists never leave a misleading initial connection label',()=>{
  for(const result of [{},{status:'partial',sources:[]},
    {status:'partial',sources:[{provider:'unknown'}]},
    {status:'partial',sources:Array(5).fill({})}]){
    const p=pageRig();p.respond(p.find(),{...result,version:'0.4.2'});
    assert.match(p.text('sourceStatus'),/Racket ID (?:No additional booking sources reported|Additional provider response unsupported)/);
    assert.doesNotMatch(p.text('sourceStatus'),/Not connected/);
    assert.equal(p.node('offers').children.length,1);
  }
});

test('additional top-level failure preserves an independent valid Playtomic offer and handoff',()=>{
  const p=pageRig(),nonce=p.find();
  const observation={provider:'playtomic',source:'user_ui_observation',
    sourceUrl:'https://playtomic.com/clubs/cascais-padel-club',venue:'Cascais Padel Club',
    date,sport:'Padel',capturedAt:new Date().toISOString(),timezone:null,
    sourceFreshness:'unknown',coverage:'expanded_offers_only',
    offers:[{court:'FICTIONAL Court 1',startLabel:'6:00 PM',endLabel:'7:30 PM',durationMinutes:90,priceEur:36}]};
  p.respond(nonce,{status:'observed',observation,version:'0.4.2'},'gac:auto-search-response');
  assert.match(p.text('offers'),/FICTIONAL Court 1/);
  const card=p.node('offers').children[0];
  assert.equal(card.children.at(-1).href,observation.sourceUrl);
  p.respond(nonce,{status:'unavailable',code:'READ_FAILED',version:'0.4.2'});
  assert.match(p.text('offers'),/FICTIONAL Court 1/);
  assert.equal(p.node('offers').children[0],card);
  assert.match(p.text('sourceStatus'),/Playtomic Player-visible offer loaded/);
  assert.match(p.text('sourceStatus'),/Racket ID Additional provider search failed/);
});

test('wrong nonce, stale search and duplicate error cannot replace current source outcomes',()=>{
  const p=pageRig(),stale=p.find(),current=p.find();
  const failure={status:'unavailable',code:'READ_FAILED',version:'0.4.2'};
  const initial=p.text('sourceStatus');
  p.respond('f'.repeat(48),failure);p.respond(stale,failure);
  p.respond('f'.repeat(48),{...failure,version:'0.2.3'});
  p.respond(stale,{...failure,version:'0.2.3'});
  assert.equal(p.text('sourceStatus'),initial);
  p.respond(current,{status:'partial',sources:[{provider:'racket_id',status:'unavailable',code:'SITE_ACCESS_REQUIRED'}],version:'0.4.2'});
  const settled=p.text('sourceStatus');
  assert.match(settled,/Racket ID Chrome site permission not granted.*Reader 0\.4\.2/);
  p.respond(current,failure);
  assert.equal(p.text('sourceStatus'),settled);
});

test('additional timeout is visible per source and never hides the independent Playtomic state',()=>{
  const p=pageRig();p.find();
  p.expire();
  assert.match(p.text('sourceStatus'),/Racket ID Additional provider search timed out/);
  assert.match(p.text('sourceStatus'),/Playtomic One login/);
});

function pageObservation(provider){
  return {provider,source:'user_ui_observation',
    sourceUrl:provider==='playtomic'?'https://playtomic.com/clubs/cascais-padel-club':source2,
    venue:provider==='playtomic'?'Cascais Padel Club':official.racket_id.venue,
    date,sport:'Padel',capturedAt:new Date().toISOString(),timezone:null,
    sourceFreshness:'unknown',coverage:'expanded_offers_only',
    offers:[{court:'FICTIONAL compatible court',startLabel:'6:00 PM',endLabel:'7:30 PM',durationMinutes:90,priceEur:36}]};
}

test('an earlier legacy error cannot discard a later compatible successful reply in either independent group',()=>{
  for(const provider of ['playtomic','racket_id']){
    const p=pageRig(),nonce=p.find(),observation=pageObservation(provider);
    const event=provider==='playtomic'?'gac:auto-search-response':'gac:additional-sources-response';
    p.respond(nonce,{status:'unavailable',code:'REQUEST_REJECTED',version:'0.2.3'},event);
    assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
    const success=provider==='playtomic'?{status:'observed',observation}:
      {status:'partial',sources:[{provider,status:'observed',observation}]};
    p.respond(nonce,{...success,version:'0.4.2'},event);
    assert.match(p.text('offers'),/FICTIONAL compatible court/);
    assert.equal(p.node('offers').children[0].children.at(-1).href,observation.sourceUrl);
    const settled=p.text('sourceStatus');
    p.respond(nonce,{status:'unavailable',code:'REQUEST_REJECTED',version:'0.2.3'},event);
    assert.equal(p.text('sourceStatus'),settled);
  }
});

test('old-only replies expire explicitly at the original deadline and late current replies cannot create offers',()=>{
  const p=pageRig(),nonce=p.find();
  for(const event of ['gac:auto-search-response','gac:additional-sources-response'])
    p.respond(nonce,{status:'unavailable',code:'REQUEST_REJECTED',version:'0.2.3'},event);
  assert.match(p.text('sourceStatus'),/Waiting for compatible Reader 0\.4\.2/);
  p.expire();
  assert.match(p.text('sourceStatus'),/only unsupported replies received.*Reader 0\.2\.3.*Expected Reader 0\.4\.2 did not respond/);
  assert.match(p.text('personalStatus'),/only unsupported replies received/);
  p.respond(nonce,{status:'observed',observation:pageObservation('playtomic'),version:'0.4.2'},'gac:auto-search-response');
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
});

test('missing or malformed versions and old observations never settle or create cards; metadata stays bounded and sanitized',()=>{
  const p=pageRig(),nonce=p.find();
  for(const version of [undefined,'PRIVATE VERSION','0.2.3','0.2.4','0.3.0'])
    p.respond(nonce,{status:'observed',observation:pageObservation('racket_id'),version,
      code:'PRIVATE CODE',error:'PRIVATE ERROR',sourceUrl:'PRIVATE URL'});
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  p.expire();
  const text=p.text('sourceStatus');
  assert.match(text,/Reader version not reported \(UNKNOWN\).*Reader 0\.2\.3.*Reader 0\.2\.4/);
  assert.doesNotMatch(text,/PRIVATE|Reader 0\.3\.0/);
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
});

test('legacy responses and repeated acknowledgements never reset either 45-second deadline',()=>{
  const p=pageRig(),nonce=p.find();
  const deadlines=()=>[...p.timers].filter(([,t])=>t.delay===45000).map(([id])=>id);
  const initial=deadlines();assert.equal(initial.length,2);
  for(let i=0;i<5;i++){
    p.ack(nonce);
    p.respond(nonce,{status:'unavailable',code:'REQUEST_REJECTED',version:'0.2.3'});
    p.respond(nonce,{status:'unavailable',code:'REQUEST_REJECTED',version:'0.2.3'},'gac:auto-search-response');
  }
  assert.deepEqual(deadlines(),initial);
  p.expire();
  assert.match(p.text('personalStatus'),/Expected Reader 0\.4\.2 did not respond/);
});

test('no acknowledgement does not consume the result window and no-response expiry stays explicit',()=>{
  const p=pageRig(),nonce=p.find();
  [...p.timers.values()].find(t=>t.delay===1500).fn();
  p.respond(nonce,{status:'unavailable',code:'READ_FAILED',version:'0.4.2'},'gac:auto-search-response');
  assert.match(p.text('personalStatus'),/READ_FAILED.*Reader 0\.4\.2/);
  const empty=pageRig();empty.find();empty.expire();
  assert.match(empty.text('sourceStatus'),/timed out without a compatible Reader 0\.4\.2 response/);
});

test('the first compatible failure settles its group while another compatible source remains usable',()=>{
  const p=pageRig(),nonce=p.find(),observation=pageObservation('racket_id');
  p.respond(nonce,{status:'unavailable',code:'READ_FAILED',version:'0.4.2'},'gac:auto-search-response');
  const primary=p.text('personalStatus');
  p.respond(nonce,{status:'observed',observation:pageObservation('playtomic'),version:'0.4.2'},'gac:auto-search-response');
  assert.equal(p.text('personalStatus'),primary);
  p.respond(nonce,{status:'partial',sources:[{provider:'racket_id',status:'observed',observation}],version:'0.4.2'});
  assert.match(p.text('offers'),/FICTIONAL compatible court/);
  assert.equal(p.node('offers').children[0].children.at(-1).href,source2);
});
