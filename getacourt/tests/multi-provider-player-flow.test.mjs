// Two independent player-signed-in UI sources from ONE Get Find action.
// FICTIONAL HTML/observations only. No network, provider API or credentials.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {normalizePersonalObservation} from "../assets/personal-observation-bridge.mjs";
import {demoOffers,displayRows,distanceKm,originFor,TRUSTED_POSITION} from '../assets/player-search-view.mjs';
const require=createRequire(import.meta.url);
const validate=require("../assets/personal-source-observation.js").validateObservation;
const base=new URL("../browser-companion/",import.meta.url);
const background=readFileSync(new URL("background.js",base),"utf8");
const observations=readFileSync(new URL("observation.js",base),"utf8");
const relay=readFileSync(new URL("get-page-relay.js",base),"utf8");
const source1="https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy";
const source2="https://racket.id/booking";
const source3="https://smashpro.pt/pt/c/fictional-club";
const pageUrl="https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html";
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const q={location:"Lisboa",sport:"padel",date,from:"08:00",to:"23:00",duration:"90"};
const providerQuery={date,sport:"Padel",from:"08:00",to:"23:00",durationMinutes:90};
const official={
  tiesports:{url:source1,venue:"OPA OEIRAS"},
  racket_id:{url:source2,venue:"Rackets Pro Academy — Quinta da Marinha"},
  smashpro:{url:source3,venue:"FICTIONAL Smashpro Lisboa club"}
};
function rig({denySmashpro=false,wrongProvider=false,timeoutSmashpro=false,revokeSmashpro=false,existingRacket=false,racketFirst=false,redirectTieToRacket=false,lateRedirectTieToRacket=false}={}){
  const local={approvedExtraSources:racketFirst
    ?{racket_id:source2,tiesports:source1,smashpro:source3}
    :{tiesports:source1,racket_id:source2,smashpro:source3}};
  const session={},created=[],removed=[],calls=[],listeners={},consentReplies=[],permissionChecks=[],tabQueries=[],tabReads=[];
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
    permissions:{contains:async o=>{
      permissionChecks.push(...o.origins);
      return !denySmashpro||!o.origins.includes("https://smashpro.pt/*");
    }},
    tabs:{
      query:async filter=>{tabQueries.push(filter);return filter?.url===source2&&existingRacket
        ?[{id:2,url:source2,windowId:1,status:"complete"}]
        :[{id:1,url:source1,windowId:1,status:"complete"}];},
      create:async o=>{const tab={...o,id:nextId++};created.push(tab);return tab;},
      get:async id=>{
        tabReads.push(id);
        const tab=created.find(t=>t.id===id);
        if(timeoutSmashpro&&tab?.url===source3)throw Error("TAB_LOAD_TIMEOUT");
        return {id,windowId:1,url:redirectTieToRacket&&tab?.url===source1?source2:tab?.url||source1,status:"complete"};
      },
      remove:async id=>{removed.push(id);},
      onUpdated:{addListener(){},removeListener(){}},
      sendMessage:async()=>({status:"delivered"}),
      update:async()=>{}
    },
    windows:{get:async()=>({width:480}),create:async()=>({id:1}),update:async()=>{}},
    scripting:{executeScript:async data=>{
      const url=data.target.tabId===2?source2:created.find(t=>t.id===data.target.tabId)?.url;
      if(data.files){
        calls.push({files:data.files,source:url});
        if(revokeSmashpro&&url===source3)
          listeners.msg({action:"revoke"},sender,()=>{});
        return [];
      }
      const provider=url===source1?"tiesports":url===source3?"smashpro":"racket_id";
      const reference=official[provider];
      // A stale Racket content script asks while another provider is active.
      consentReplies.push(await new Promise(resolve=>listeners.msg(
        {action:'racketNavigationConsent',epoch:data.args[1]},
        {id:'reader',url:source2,frameId:0,tab:{id:2}},resolve)));
      const offer={
        provider:wrongProvider&&provider==="smashpro"?"tiesports":provider,
        source:"user_ui_observation",sourceUrl:reference.url,venue:reference.venue,
        date,sport:"Padel",capturedAt:new Date().toISOString(),
        timezone:null,sourceFreshness:"unknown",coverage:"expanded_offers_only",
        offers:[{court:"Court 1",startLabel:"6:00 PM",endLabel:"7:30 PM",
          durationMinutes:90,priceEur:provider==="tiesports"?36:38}]
      };
      // Execute the actual injected function so its URL binding is exercised.
      const actualUrl=lateRedirectTieToRacket&&url===source1?source2:url;
      const result=vm.runInNewContext('('+data.func.toString()+')(...args)',{
        args:data.args,location:new URL(actualUrl),readVisibleProviderPage:()=>{
          calls.push({source:actualUrl,func:true});return offer;
        }
      });
      return [{frameId:0,result}];
    }}
  };
  const ctx=vm.createContext({chrome,URL,Date,setTimeout,clearTimeout,importScripts(){}});
  vm.runInContext(observations,ctx);
  vm.runInContext(background,ctx);
  const sender={id:"reader",url:pageUrl,frameId:0,tab:{id:9,url:pageUrl}};
  const send=(message,from=sender)=>new Promise(resolve=>listeners.msg(message,from,resolve));
  const posted=[],events={},window={
    addEventListener:(key,fn)=>events[key]=fn,
    dispatchEvent:ev=>{posted.push(ev);events[ev.type]?.(ev);}
  };
  window.top=window;
  const target=vm.createContext({window,location:{href:pageUrl},
    chrome:{runtime:{sendMessage:send}},
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
  vm.runInContext(relay,target);
  return {chrome,local,session,calls,posted,events,created,removed,send,consentReplies,permissionChecks,tabQueries,tabReads};
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
test("one Find pauses granted Racket before provider work while independent TieSports and Smashpro remain usable",async()=>{
  const r=rig();find(r);
  const result=await response(r);
  assert.equal(result.status,"partial");
  assert.equal(result.sources.length,3);
  assert.equal(result.sources.filter(s=>s.status==="observed").length,2);
  assert.equal(r.created.length,2);
  assert.deepEqual(r.created.map(x=>x.url),[source1,source3]);
  assert.deepEqual(r.removed,r.created.map(x=>x.id));
  assert.ok(!r.removed.includes(1));
  assert.equal(r.calls.filter(x=>x.func).length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.sources.find(s=>s.provider==='racket_id'))),
    {provider:'racket_id',status:'unavailable',code:'SAFETY_REVIEW_REQUIRED'});
  assert.equal(r.permissionChecks.includes('https://racket.id/*'),false);
  assert.equal(r.tabQueries.length,0);
  assert.equal(r.calls.some(c=>c.source===source2),false);
  assert.equal(r.session['lastAttemptExtra:racket_id'],undefined);
  assert.equal(r.local.approvedExtraSources.racket_id,source2);
  for(const item of result.sources.filter(s=>s.status==='observed')){
    const clean=validate(item.observation);
    // Unknown clubs still require their exact venue name, never a guessed area.
    if(item.provider==='smashpro')assert.throws(()=>normalizePersonalObservation(
      JSON.stringify(clean),q,{now:Date.now(),validator:validate}),/OBSERVATION_LOCATION_MISMATCH/);
    const displayQuery=item.provider==='smashpro'?{...q,location:clean.venue}:q;
    const normalized=normalizePersonalObservation(JSON.stringify(clean),displayQuery,
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
test("an unpaused provider permission failure or forged payload leaves other valid sources and the Racket stop independent",async()=>{
  for(const options of [{denySmashpro:true},{wrongProvider:true}]){
    const r=rig(options);find(r);
    const result=await response(r);
    assert.equal(result.sources.length,3);
    assert.equal(result.sources[0].provider,"tiesports");
    assert.equal(result.sources[0].status,"observed");
    assert.equal(result.sources[1].provider,"racket_id");
    assert.equal(result.sources[1].status,"unavailable");
    assert.equal(result.sources[1].code,'SAFETY_REVIEW_REQUIRED');
    assert.equal(result.sources[2].provider,'smashpro');
    assert.equal(result.sources[2].status,'unavailable');
    assert.equal(result.sources[2].code,
      options.denySmashpro?"SITE_ACCESS_REQUIRED":"OFFER_FORMAT_CHANGED");
    assert.deepEqual(r.removed,r.created.map(x=>x.id));
    assert.ok(!r.removed.includes(1));
  }
});
test("each owned temporary tab closes after timeout, access revoke, or a partial provider result",async()=>{
  for(const [options,code] of [
    [{timeoutSmashpro:true},"READ_FAILED"],
    [{revokeSmashpro:true},"CONSENT_WITHDRAWN"]
  ]){
    const r=rig(options);find(r);
    const result=await response(r);
    assert.equal(result.status,"partial");
    assert.equal(result.sources[0].status,"observed");
    assert.equal(result.sources[1].status,"unavailable");
    assert.equal(result.sources[1].code,'SAFETY_REVIEW_REQUIRED');
    assert.equal(result.sources[2].code,code);
    assert.deepEqual(r.removed,r.created.map(x=>x.id));
    assert.ok(!r.removed.includes(1));
  }
});
test("a later explicit Find cleans only its own newly created provider tabs",async()=>{
  const r=rig();
  find(r);await response(r);
  delete r.session["lastAttemptExtra:tiesports"];
  delete r.session["lastAttemptExtra:smashpro"];
  find(r);await response(r);
  assert.equal(r.created.length,4);
  assert.deepEqual(r.removed,r.created.map(x=>x.id));
  assert.ok(!r.removed.includes(1));
});
test("another provider redirecting to Racket is rejected before injection or observation",async()=>{
  const r=rig({redirectTieToRacket:true,existingRacket:true});find(r);
  const result=await response(r);
  assert.equal(result.sources[0].code,'TAB_CHANGED');
  assert.equal(result.sources[1].code,'SAFETY_REVIEW_REQUIRED');
  assert.equal(result.sources[2].status,'observed');
  assert.equal(r.calls.some(c=>c.source===source1||c.source===source2),false);
  assert.deepEqual(r.calls.filter(c=>c.func).map(c=>c.source),[source3]);
  assert.equal(r.permissionChecks.includes('https://racket.id/*'),false);
  assert.equal(r.calls.some(c=>c.files?.includes('racket-preview.js')),false);
  assert.ok(!r.tabReads.includes(2));
  assert.ok(!r.removed.includes(2));
  assert.deepEqual(r.removed,r.created.map(t=>t.id));
});

test("a redirect after metadata validation cannot invoke the DOM observer on Racket",async()=>{
  const r=rig({lateRedirectTieToRacket:true});find(r);
  const result=await response(r);
  assert.equal(result.sources[0].code,'TAB_CHANGED');
  assert.equal(result.sources[1].code,'SAFETY_REVIEW_REQUIRED');
  assert.equal(result.sources[2].status,'observed');
  assert.deepEqual(r.calls.filter(c=>c.func).map(c=>c.source),[source3]);
  assert.equal(r.permissionChecks.includes('https://racket.id/*'),false);
  assert.equal(r.calls.some(c=>c.files?.includes('racket-preview.js')),false);
  assert.deepEqual(r.removed,r.created.map(t=>t.id));
});

test("a legacy query without location cannot read or close an existing approved Racket preview",async()=>{
  const r=rig({existingRacket:true});
  const result=await r.send({action:'autoSearchAdditionalFromGet',query:providerQuery});
  assert.equal(result.sources[1].status,'unavailable');
  assert.equal(result.sources[1].code,'SAFETY_REVIEW_REQUIRED');
  assert.deepEqual(r.created.map(t=>t.url),[source1,source3]);
  assert.deepEqual(r.removed,r.created.map(t=>t.id));
  assert.ok(!r.removed.includes(2));
  assert.ok(!r.tabReads.includes(2));
  assert.equal(r.tabQueries.length,0);
  assert.equal(r.calls.some(c=>c.source===source2),false);
});

test("Racket navigation consent stays denied before, during and after searches despite an existing granted tab",async()=>{
  const r=rig({existingRacket:true});
  assert.equal((await r.send({action:'racketNavigationConsent',epoch:0})).allowed,false);
  find(r);await response(r);
  assert.deepEqual(r.consentReplies.map(v=>v.allowed),[false,false]);
  assert.equal((await r.send({action:'racketNavigationConsent',epoch:0},
    {id:'reader',url:source2,frameId:0,tab:{id:2}})).allowed,false);
  assert.equal(r.permissionChecks.includes('https://racket.id/*'),false);
  assert.equal((await r.send({action:'racketNavigationConsent',epoch:0})).allowed,false);
});

test("a location Find with Racket first preserves its grant and existing tab without rate-state or provider work",async()=>{
  const r=rig({existingRacket:true,racketFirst:true}),before=JSON.stringify(r.local);find(r);
  const result=await response(r);
  assert.equal(result.sources[0].code,'SAFETY_REVIEW_REQUIRED');
  assert.equal(result.sources.filter(s=>s.status==='observed').length,2);
  assert.deepEqual(r.created.map(t=>t.url),[source1,source3]);
  assert.deepEqual(r.removed,r.created.map(t=>t.id));
  assert.ok(!r.removed.includes(2));
  assert.equal(JSON.stringify(r.local),before);
  assert.ok(!r.tabReads.includes(2));
  assert.equal(r.tabQueries.length,0);
  assert.equal(r.permissionChecks.includes('https://racket.id/*'),false);
  assert.equal(r.calls.some(c=>c.source===source2),false);
  assert.equal(r.session['lastAttemptExtra:racket_id'],undefined);
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
  const element=()=>({children:[],events:{},dataset:{},attributes:{},value:'',textContent:'',
    classList:{toggle(){},add(){}},focus(){},scrollIntoView(){},
    setAttribute(name,value){this.attributes[name]=value;},
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=items;},
    addEventListener(name,fn){this.events[name]=fn;}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  node('search').elements={namedItem:()=>node('date')};
  node('search').requestSubmit=()=>node('search').events.submit({preventDefault(){}});
  node('budgetFilter').value=node('radiusFilter').value='any';node('offerSort').value='time';
  const context=vm.createContext({Date,URL,Intl,TextEncoder,Uint8Array,JSON,
    normalizePersonalObservation,validateQuery:value=>value,localDay:()=>date,
    FormData:class extends Map {constructor(){super(Object.entries(pageQuery));}},
    crypto:{getRandomValues:array=>array.fill(++nonceByte)},
    setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},
    clearTimeout:id=>timers.delete(id),
    document:{getElementById:node,createElement:element,createTextNode:text=>({...element(),textContent:text}),documentElement:{dataset:{}},addEventListener(){}},
    Option:class{constructor(text,value){Object.assign(this,element(),{textContent:text,value});}},
    window:{addEventListener:(name,fn)=>handlers[name]=fn,dispatchEvent:event=>posted.push(event)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    GetACourtPersonalSourceObservation:{validateObservation:validate}
  });
  const page=readFileSync(new URL('../assets/court-search-page.mjs',import.meta.url),'utf8');
  const view=readFileSync(new URL('../assets/player-search-view.mjs',import.meta.url),'utf8');
  vm.runInContext(view.replace(/^export /gm,''),context);
  vm.runInContext(page.replace(/^import .*;\r?$/gm,''),context);
  const find=()=>{
    node('search').events.submit({preventDefault(){}});
    return posted.findLast(e=>e.type==='gac:additional-sources-request')?.detail.nonce;
  };
  const respond=(nonce,result,type='gac:additional-sources-response')=>handlers[type]({detail:{nonce,result}});
  const text=el=>[el.textContent,...el.children.map(text)].join(' ');
  const expire=()=>{for(const {fn,delay} of [...timers.values()])if(delay===45000)fn();};
  const ack=nonce=>handlers['gac:auto-search-accepted']({detail:{nonce}});
  return {find,respond,node,text:id=>text(node(id)),timers,expire,ack,posted};
}

test('demo mode cancels real nonces, dispatches no provider search and cannot accept late real offers',()=>{
  const p=pageRig(),nonce=p.find(),before=p.posted.length;
  p.node('demoMode').events.click();
  assert.equal(p.posted.length,before);
  assert.match(p.text('offers'),/DEMO.*FICTIONAL AVAILABILITY/);
  assert.doesNotMatch(p.text('offers'),/Continue on Playtomic/);
  p.respond(nonce,{status:'observed',version:'0.4.2',observation:pageObservation('playtomic')},'gac:auto-search-response');
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  assert.match(p.text('sourceStatus'),/DEMO.*No provider search/);
  p.node('realMode').events.click();
  assert.doesNotMatch(p.text('offers'),/Solis|Dune|Azul/);
  assert.equal(p.posted.length,before);
  p.respond(nonce,{status:'observed',version:'0.4.2',observation:pageObservation('playtomic')},'gac:auto-search-response');
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  assert.equal(p.node('requestPersonalBridge').disabled,true);
});

test('display model isolates fictional data, expires real rows, deduplicates and maps only reviewed venue/source pairs',()=>{
  const query={...q,location:'Cascais',duration:'any'},examples=demoOffers(query);
  assert.equal(examples.length,6);
  assert.ok(examples.every(r=>r.demo&&r.position.fictional&&r.o.sourceUrl===null));
  assert.equal(displayRows(examples,{mode:'real'}).length,0);
  const o={...examples[0].o,sourceId:'playtomic',sourceUrl:TRUSTED_POSITION.sourceUrl,clubName:TRUSTED_POSITION.venue};
  const record={o,captured:new Date().toISOString(),expires:new Date(Date.now()+30000).toISOString()};
  const rows=displayRows([record,record]);
  assert.equal(rows.length,1);assert.equal(rows[0].position,TRUSTED_POSITION);
  assert.equal(displayRows([record],{mode:'demo'}).length,0);
  assert.equal(displayRows([{...record,expires:new Date(Date.now()-1).toISOString()}]).length,0);
  assert.equal(displayRows([{...record,o:{...o,sourceUrl:'https://racket.id/booking'}}])[0].position,null);
  assert.equal(displayRows([{...record,o:{...o,clubName:'Unreviewed club',lat:1,lon:1}}])[0].position,null);
});

test('clearing or changing modes removes selected personal data from the screen-reader map announcement',()=>{
  for(const action of ['clear','query','demo']){
    const p=pageRig(),nonce=p.find();
    p.respond(nonce,{status:'observed',version:'0.4.2',observation:pageObservation('playtomic')},'gac:auto-search-response');
    const price=p.node('offers').children[0].children.find(child=>child.className==='price-row');
    price.children.find(child=>child.className==='map-card-button').events.click();
    assert.match(p.text('mapSelection'),/FICTIONAL compatible court/);
    if(action==='clear')p.node('clearPersonal').events.click();
    else if(action==='query')p.node('search').events.input();
    else p.node('demoMode').events.click();
    assert.equal(p.text('mapSelection').trim(),'');
    assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  }
});

test('distance needs an explicit matching-mode origin; budget and radius do not invent unknown positions',()=>{
  assert.equal(distanceKm(null,TRUSTED_POSITION),null);
  assert.equal(distanceKm({lat:0,lon:0},{lat:0,lon:1}).toFixed(3),'111.195');
  assert.equal(originFor('real','demo'),null);assert.equal(originFor('demo','nature'),null);
  const rows=demoOffers({...q,location:'Cascais',duration:'any'}),origin=originFor('demo','demo');
  assert.ok(displayRows(rows,{mode:'demo',origin,budget:'30'}).every(r=>r.o.priceMinor<=3000));
  const near=displayRows(rows,{mode:'demo',origin,radius:'2'});
  assert.ok(near.length>0&&near.length<rows.length);assert.ok(near.every(r=>r.distance<=2));
  const nearest=displayRows(rows,{mode:'demo',origin,sort:'distance'});
  assert.ok(nearest.every((r,i)=>i===0||r.distance>=nearest[i-1].distance));
  const unknown={o:{...rows[0].o,sourceId:'racket_id',sourceUrl:source2},expires:new Date(Date.now()+30000).toISOString()};
  assert.equal(displayRows([unknown],{origin:originFor('real','nature'),radius:'25'}).length,0);
});

test('fictional examples obey sport, duration, place and time filters with no invented coverage',()=>{
  assert.equal(demoOffers({...q,location:'Unknown city'}).length,0);
  const tennis=demoOffers({...q,location:'Cascais',sport:'tennis',duration:'60'});
  assert.equal(tennis.length,1);assert.equal(tennis[0].o.duration,60);
  assert.equal(demoOffers({...q,location:'Cascais',from:'22:00',to:'23:00'}).length,0);
});

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
  assert.equal(card.children.find(c=>c.href)?.href,observation.sourceUrl);
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
    assert.equal(p.node('offers').children[0].children.find(c=>c.href)?.href,observation.sourceUrl);
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
  assert.match(empty.text('searchStatus'),/Search finished without verified offers/);
});

test('the three-version metadata budget is shared across both groups without hiding that an unsupported reply arrived',()=>{
  const p=pageRig(),nonce=p.find();
  for(const version of ['0.2.3','0.2.4','0.3.0'])
    p.respond(nonce,{version,code:'REQUEST_REJECTED'},'gac:auto-search-response');
  p.respond(nonce,{version:'0.3.1',code:'READ_FAILED'});
  p.expire();
  assert.match(p.text('personalStatus'),/Reader 0\.2\.3.*Reader 0\.2\.4.*Reader 0\.3\.0/);
  assert.match(p.text('sourceStatus'),/only unsupported replies received.*metadata limit reached/);
  assert.doesNotMatch(p.text('sourceStatus'),/0\.3\.1/);
});

test('the first compatible failure settles its group while another compatible source remains usable',()=>{
  const p=pageRig(),nonce=p.find(),observation=pageObservation('racket_id');
  p.respond(nonce,{status:'unavailable',code:'READ_FAILED',version:'0.4.2'},'gac:auto-search-response');
  const primary=p.text('personalStatus');
  p.respond(nonce,{status:'observed',observation:pageObservation('playtomic'),version:'0.4.2'},'gac:auto-search-response');
  assert.equal(p.text('personalStatus'),primary);
  p.respond(nonce,{status:'partial',sources:[{provider:'racket_id',status:'observed',observation}],version:'0.4.2'});
  assert.match(p.text('offers'),/FICTIONAL compatible court/);
  assert.equal(p.node('offers').children[0].children.find(c=>c.href)?.href,source2);
});
