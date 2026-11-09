// Two independent player-signed-in UI sources from ONE Get Find action.
// FICTIONAL HTML/observations only. No network, provider API or credentials.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {normalizePersonalObservation} from "../assets/personal-observation-bridge.mjs";
import {demoOffers,displayRows,distanceKm,originFor,TRUSTED_POSITION} from '../assets/player-search-view.mjs';
import {projectEvents,projectEventSources,filterEvents,groupEventVenues,eventPriceLabel,kindLabel} from '../assets/event-discovery.mjs';
import {eventDemoFixtures} from '../assets/event-demo-fixtures.mjs';
import {renderEventCards,eventTimeLabel} from '../assets/event-discovery-view.mjs';
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
function pageRig(queryPatch={},clock=null){
  const pageQuery={...q,location:'Cascais',...queryPatch},handlers={},posted=[],nodes=new Map(),timers=new Map();
  const pageDocument={};
  const PageDate=clock?class extends Date {
    constructor(...args){super(...(args.length?args:[clock.now]));}
    static now(){return clock.now;}
  }:Date;
  let nextTimer=0,nonceByte=0;
  const element=()=>({children:[],options:[],events:{},dataset:{},attributes:{},value:'',textContent:'',ownerDocument:pageDocument,
    classList:{toggle(){},add(){}},focus(){},scrollIntoView(){},
    setAttribute(name,value){this.attributes[name]=value;},
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=items;this.options=[...items];},
    add(item){this.options.push(item);this.children.push(item);},
    querySelector:selector=>node('query:'+selector),
    addEventListener(name,fn){this.events[name]=fn;}});
  const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  Object.assign(pageDocument,{getElementById:node,createElement:element,
    createTextNode:text=>({...element(),textContent:text}),documentElement:{dataset:{}},
    querySelector:selector=>node('document:'+selector),addEventListener(){}});
  node('search').elements={namedItem:()=>node('date')};
  node('search').requestSubmit=()=>node('search').events.submit({preventDefault(){}});
  node('budgetFilter').value=node('radiusFilter').value='any';node('offerSort').value='time';
  const context=vm.createContext({Date:PageDate,URL,Intl,TextEncoder,Uint8Array,JSON,
    normalizePersonalObservation,validateQuery:value=>value,localDay:()=>date,
    projectEvents,projectEventSources,filterEvents,groupEventVenues,eventPriceLabel,kindLabel,eventDemoFixtures,renderEventCards,eventTimeLabel,
    FormData:class extends Map {constructor(){super(Object.entries(pageQuery));}},
    crypto:{getRandomValues:array=>array.fill(++nonceByte)},
    setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},
    clearTimeout:id=>timers.delete(id),
    document:pageDocument,
    Option:class{constructor(text,value){Object.assign(this,element(),{textContent:text,value});}},
    window:{addEventListener:(name,fn)=>handlers[name]=fn,dispatchEvent:event=>posted.push(event)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    GetACourtPersonalSourceObservation:{validateObservation:validate}
  });
  const page=readFileSync(new URL('../assets/court-search-page.mjs',import.meta.url),'utf8');
  const view=readFileSync(new URL('../assets/player-search-view.mjs',import.meta.url),'utf8');
  vm.runInContext(view.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,''),context);
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
  assert.equal(p.posted.length,before+1);
  assert.equal(p.posted.at(-1).type,'gac:auto-search-cancel');
  assert.equal(p.posted.at(-1).detail.nonce,nonce);
  assert.match(p.text('offers'),/DEMO.*FICTIONAL AVAILABILITY/);
  assert.doesNotMatch(p.text('offers'),/Continue on Playtomic/);
  p.respond(nonce,{status:'observed',version:'0.4.3',observation:pageObservation('playtomic')},'gac:auto-search-response');
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  assert.match(p.text('sourceStatus'),/DEMO.*No provider search/);
  p.node('realMode').events.click();
  assert.doesNotMatch(p.text('offers'),/Solis|Dune|Azul/);
  assert.equal(p.posted.length,before+1);
  p.respond(nonce,{status:'observed',version:'0.4.3',observation:pageObservation('playtomic')},'gac:auto-search-response');
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  assert.equal(p.node('requestPersonalBridge').disabled,true);
});

test('event intention cancels court protocol state and remains source-free in REAL and DEMO',()=>{
  const p=pageRig(),nonce=p.find(),before=p.posted.length;
  p.node('intentGames').events.click();
  assert.equal(p.posted.at(-1).type,'gac:auto-search-cancel');
  assert.equal(p.posted.at(-1).detail.nonce,nonce);
  assert.match(p.text('offers'),/Games are not connected yet/);
  p.respond(nonce,{status:'observed',version:'0.4.3',observation:pageObservation('playtomic')},'gac:auto-search-response');
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  p.node('demoMode').events.click();
  assert.match(p.text('offers'),/FICTIONAL DEMO/);
  assert.match(p.text('offers'),/Start an open game/);
  assert.equal(p.posted.length,before+1);
  p.node('realMode').events.click();
  assert.match(p.text('offers'),/Games are not connected yet/);
  assert.doesNotMatch(p.text('offers'),/After-work|FICTIONAL compatible court/);
  assert.equal(p.posted.length,before+1);
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
    p.respond(nonce,{status:'observed',version:'0.4.3',observation:pageObservation('playtomic')},'gac:auto-search-response');
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
    {status:'unavailable',code:'REQUEST_REJECTED',version:'0.4.3',error:'PRIVATE EXCEPTION'},
    {status:'unavailable',code:'PRIVATE CODE',version:'0.4.3',error:'PRIVATE EXCEPTION'}
  ]){
    const p=pageRig();p.respond(p.find(),result);
    const coverage=p.text('sourceStatus');
    assert.match(coverage,/Racket ID Additional provider search failed/);
    assert.match(coverage,/connection and availability unverified/);
    assert.match(coverage,result.code==='REQUEST_REJECTED'?/REQUEST_REJECTED.*Reader 0\.4\.3/:/UNKNOWN.*Reader 0\.4\.3/);
    assert.doesNotMatch(coverage,/PRIVATE|Not connected/);
  }
});

test('empty, missing or oversized source lists never leave a misleading initial connection label',()=>{
  for(const result of [{},{status:'partial',sources:[]},
    {status:'partial',sources:[{provider:'unknown'}]},
    {status:'partial',sources:Array(5).fill({})}]){
    const p=pageRig();p.respond(p.find(),{...result,version:'0.4.3'});
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
  p.respond(nonce,{status:'observed',observation,version:'0.4.3'},'gac:auto-search-response');
  assert.match(p.text('offers'),/FICTIONAL Court 1/);
  const card=p.node('offers').children[0];
  assert.equal(card.children.find(c=>c.href)?.href,observation.sourceUrl);
  p.respond(nonce,{status:'unavailable',code:'READ_FAILED',version:'0.4.3'});
  assert.match(p.text('offers'),/FICTIONAL Court 1/);
  assert.equal(p.node('offers').children[0],card);
  assert.match(p.text('sourceStatus'),/Playtomic Player-visible offer loaded/);
  assert.match(p.text('sourceStatus'),/Racket ID Additional provider search failed/);
});

test('wrong nonce, stale search and duplicate error cannot replace current source outcomes',()=>{
  const p=pageRig(),stale=p.find(),current=p.find();
  const failure={status:'unavailable',code:'READ_FAILED',version:'0.4.3'};
  const initial=p.text('sourceStatus');
  p.respond('f'.repeat(48),failure);p.respond(stale,failure);
  p.respond('f'.repeat(48),{...failure,version:'0.2.3'});
  p.respond(stale,{...failure,version:'0.2.3'});
  assert.equal(p.text('sourceStatus'),initial);
  p.respond(current,{status:'partial',sources:[{provider:'racket_id',status:'unavailable',code:'SITE_ACCESS_REQUIRED'}],version:'0.4.3'});
  const settled=p.text('sourceStatus');
  assert.match(settled,/Racket ID Chrome site permission not granted.*Reader 0\.4\.3/);
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
    p.respond(nonce,{...success,version:'0.4.3'},event);
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
  assert.match(p.text('sourceStatus'),/Waiting for compatible Reader 0\.4\.3/);
  p.expire();
  assert.match(p.text('sourceStatus'),/only unsupported replies received.*Reader 0\.2\.3.*Expected Reader 0\.4\.3 did not respond/);
  assert.match(p.text('personalStatus'),/only unsupported replies received/);
  p.respond(nonce,{status:'observed',observation:pageObservation('playtomic'),version:'0.4.3'},'gac:auto-search-response');
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
  assert.match(p.text('personalStatus'),/Expected Reader 0\.4\.3 did not respond/);
});

test('no acknowledgement does not consume the result window and no-response expiry stays explicit',()=>{
  const p=pageRig(),nonce=p.find();
  [...p.timers.values()].find(t=>t.delay===1500).fn();
  p.respond(nonce,{status:'unavailable',code:'READ_FAILED',version:'0.4.3'},'gac:auto-search-response');
  assert.match(p.text('personalStatus'),/READ_FAILED.*Reader 0\.4\.3/);
  const empty=pageRig();empty.find();empty.expire();
  assert.match(empty.text('sourceStatus'),/timed out without a compatible Reader 0\.4\.3 response/);
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
  p.respond(nonce,{status:'unavailable',code:'READ_FAILED',version:'0.4.3'},'gac:auto-search-response');
  const primary=p.text('personalStatus');
  p.respond(nonce,{status:'observed',observation:pageObservation('playtomic'),version:'0.4.3'},'gac:auto-search-response');
  assert.equal(p.text('personalStatus'),primary);
  p.respond(nonce,{status:'partial',sources:[{provider:'racket_id',status:'observed',observation}],version:'0.4.3'});
  assert.match(p.text('offers'),/FICTIONAL compatible court/);
  assert.equal(p.node('offers').children[0].children.find(c=>c.href)?.href,source2);
});

for(const provider of ['tiesports','racket_id','smashpro','matchi'])test(`page rejects a ${provider} wrapper carrying a valid Playtomic observation`,()=>{
  const p=pageRig(),nonce=p.find(),observation=pageObservation('playtomic');
  assert.equal(normalizePersonalObservation(JSON.stringify(observation),{...q,location:'Cascais'},{validator:validate}).sourceId,'playtomic');
  p.respond(nonce,{status:'partial',sources:[{provider,status:'observed',observation}],version:'0.4.3'});
  assert.deepEqual({card:p.text('offers').includes('FICTIONAL compatible court'),success:/Retrieved 1/.test(p.text('searchStatus')),fresh:/Fresh player-visible/.test(p.text('sourceStatus')),loaded:/Player-visible offer loaded/.test(p.text('sourceStatus'))},
    {card:false,success:false,fresh:false,loaded:false});
  assert.match(p.text('sourceStatus'),/Client observation rejected; availability unverified/);
});

test('single Playtomic channel rejects an otherwise valid Racket observation',()=>{
  const p=pageRig(),nonce=p.find(),observation=pageObservation('racket_id');
  assert.equal(normalizePersonalObservation(JSON.stringify(observation),{...q,location:'Cascais'},{validator:validate}).sourceId,'racket_id');
  p.respond(nonce,{status:'observed',observation,version:'0.4.3'},'gac:auto-search-response');
  assert.deepEqual({card:p.text('offers').includes('FICTIONAL compatible court'),success:/continue with Playtomic/.test(p.text('searchStatus')),loaded:/Player-visible offer loaded/.test(p.text('sourceStatus'))},
    {card:false,success:false,loaded:false});
  assert.match(p.text('personalStatus'),/rejected|does not match/i);
});

test('partial Playtomic channel rejects a matching wrapper with a Racket observation',()=>{
  const p=pageRig(),nonce=p.find();
  p.respond(nonce,{status:'partial',sources:[{provider:'playtomic',status:'observed',observation:pageObservation('racket_id')}],version:'0.4.3'},'gac:auto-search-response');
  assert.deepEqual({card:p.text('offers').includes('FICTIONAL compatible court'),success:/1 supplied fresh/.test(p.text('searchStatus')),loaded:/Player-visible offer loaded/.test(p.text('sourceStatus'))},
    {card:false,success:false,loaded:false});
  assert.match(p.text('searchStatus'),/no complete priced offer was verified/);
});

test('mixed additional rows reject the mismatched source without losing independent valid observations',()=>{
  for(const reverse of [false,true]){
    const p=pageRig(),nonce=p.find(),wrong=pageObservation('playtomic'),good=pageObservation('racket_id');
    wrong.offers[0].court='FICTIONAL wrong-provider court';good.offers[0].court='FICTIONAL independent Racket court';
    const rows=[{provider:'tiesports',status:'observed',observation:wrong},{provider:'racket_id',status:'observed',observation:good}];
    p.respond(nonce,{status:'partial',sources:reverse?rows.reverse():rows,version:'0.4.3'});
    assert.equal(p.node('offers').children.length,1);assert.doesNotMatch(p.text('offers'),/wrong-provider/);
    assert.match(p.text('offers'),/independent Racket/);assert.match(p.text('searchStatus'),/Retrieved 1 additional/);
    assert.match(p.text('sourceStatus'),/TiePlayer \/ TieSports Client observation rejected/);
    assert.match(p.text('sourceStatus'),/Racket ID Player-visible offer loaded/);
    assert.doesNotMatch(p.text('sourceStatus'),/Playtomic Player-visible offer loaded/);
    p.respond(nonce,{status:'observed',observation:pageObservation('playtomic'),version:'0.4.3'},'gac:auto-search-response');
    assert.equal(p.node('offers').children.length,2);assert.match(p.text('sourceStatus'),/Playtomic Player-visible offer loaded/);
  }
});

test('mixed Playtomic rows count only correctly bound observations in either order',()=>{
  for(const reverse of [false,true]){
    const p=pageRig(),nonce=p.find(),good=pageObservation('playtomic'),wrong=pageObservation('racket_id');
    good.offers[0].court='FICTIONAL valid Playtomic court';wrong.offers[0].court='FICTIONAL wrong-provider court';
    const rows=[{provider:'playtomic',status:'observed',observation:wrong},{provider:'playtomic',status:'observed',observation:good}];
    p.respond(nonce,{status:'partial',sources:reverse?rows.reverse():rows,version:'0.4.3'},'gac:auto-search-response');
    assert.equal(p.node('offers').children.length,1);assert.doesNotMatch(p.text('offers'),/wrong-provider/);
    assert.match(p.text('offers'),/valid Playtomic/);assert.match(p.text('searchStatus'),/Compared 2 reviewed Playtomic club\(s\); 1 supplied/);
    assert.match(p.text('personalStatus'),/1 club\(s\) incomplete or unverified/);
    assert.doesNotMatch(p.text('sourceStatus'),/Racket ID Player-visible offer loaded/);
  }
});

test('same-provider channels retain valid handoffs, exact EUR cents and source identities for every supported provider',()=>{
  for(const [provider,reference,location] of [
    ['playtomic',{url:'https://playtomic.com/clubs/cascais-padel-club',venue:'Cascais Padel Club'},'Cascais'],
    ['tiesports',official.tiesports,'Lisboa'],['racket_id',official.racket_id,'Cascais'],
    ['smashpro',official.smashpro,official.smashpro.venue],
    ['matchi',{url:'https://www.matchi.se/facilities/fictional-club',venue:'FICTIONAL MATCHi club'},'FICTIONAL MATCHi club']
  ])for(const partial of provider==='playtomic'?[false,true]:[true]){
    const p=pageRig({location}),nonce=p.find(),observation={...pageObservation(provider),sourceUrl:reference.url,venue:reference.venue};
    observation.offers[0].priceEur=36.5;
    const result=partial?{status:'partial',sources:[{provider,status:'observed',observation}]}:{status:'observed',observation};
    p.respond(nonce,{...result,version:'0.4.3'},provider==='playtomic'?'gac:auto-search-response':'gac:additional-sources-response');
    assert.equal(p.node('offers').children.length,1,provider);assert.match(p.text('offers'),/FICTIONAL compatible court/);
    assert.match(p.text('offers'),/36\.50/);assert.equal(p.node('offers').children[0].children.find(c=>c.href)?.href,reference.url);
    assert.match(p.text('sourceStatus'),/Player-visible offer loaded/);
  }
});

test('manual comparison retains its own validated provider without an automatic-channel restriction',()=>{
  for(const provider of ['playtomic','racket_id']){
    const p=pageRig(),observation=pageObservation(provider);p.find();
    p.node('personalPayload').value=JSON.stringify(observation);p.node('comparePersonal').events.click();
    assert.match(p.text('offers'),/FICTIONAL compatible court/);
    assert.equal(p.node('offers').children[0].children.find(c=>c.href)?.href,observation.sourceUrl);
    assert.match(p.text('sourceStatus'),provider==='playtomic'?/Playtomic Player-visible offer loaded/:/Racket ID Player-visible offer loaded/);
  }
});

test('bound observations still require freshness, schema, allowed URLs, exact cents and requested duration',()=>{
  for(const patch of [
    {capturedAt:new Date(Date.now()-60000).toISOString()},
    {sourceUrl:'https://example.invalid/booking'},
    {unexpected:'PRIVATE FIELD'},
    {offers:[{...pageObservation('playtomic').offers[0],priceEur:36.005}]},
    {offers:[{...pageObservation('playtomic').offers[0],durationMinutes:120}]}
  ])for(const channel of ['single','partial','additional']){
    const p=pageRig(),nonce=p.find(),provider=channel==='additional'?'racket_id':'playtomic',observation={...pageObservation(provider),...patch};
    const result=channel==='single'?{status:'observed',observation}:{status:'partial',sources:[{provider,status:'observed',observation}]};
    p.respond(nonce,{...result,version:'0.4.3'},channel==='additional'?'gac:additional-sources-response':'gac:auto-search-response');
    assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);assert.doesNotMatch(p.text('sourceStatus'),/Player-visible offer loaded|Fresh player-visible/);
    assert.doesNotMatch(p.text('personalStatus'),/PRIVATE FIELD/);
  }
});

test('a compatible provider mismatch settles only its group and cannot be overwritten by a duplicate',()=>{
  const p=pageRig(),nonce=p.find();
  p.respond(nonce,{status:'observed',observation:pageObservation('racket_id'),version:'0.4.3'},'gac:auto-search-response');
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  const primary=p.text('personalStatus');
  p.respond(nonce,{status:'observed',observation:pageObservation('playtomic'),version:'0.4.3'},'gac:auto-search-response');
  assert.equal(p.text('personalStatus'),primary);assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  p.respond(nonce,{status:'partial',sources:[{provider:'racket_id',status:'observed',observation:pageObservation('racket_id')}],version:'0.4.3'});
  assert.match(p.text('offers'),/FICTIONAL compatible court/);assert.equal(p.node('offers').children[0].children.find(c=>c.href)?.href,source2);
});

function deadlineReply(page,nonce,kind,observation,version='0.4.3'){
  const provider=kind==='additional'?'racket_id':'playtomic';
  const result=kind==='single'?{status:'observed',observation}:
    {status:'partial',sources:[{provider,status:'observed',observation}]};
  page.respond(nonce,{...result,version},kind==='additional'?'gac:additional-sources-response':'gac:auto-search-response');
}

for(const kind of ['single','partial','additional'])for(const elapsed of [44999,45000,45001])
test(`absolute deadline ${kind} response at ${elapsed}ms with its timer callback still queued`,()=>{
  for(const ackMode of ['absent','early','late','queued']){
    const start=Date.now(),clock={now:start},p=pageRig({},clock),nonce=p.find();
    const provider=kind==='additional'?'racket_id':'playtomic';
    const observation={...pageObservation(provider),capturedAt:new Date(start).toISOString()};
    // The observation itself remains fresh; only the request deadline can reject it.
    assert.equal(normalizePersonalObservation(JSON.stringify(observation),{...q,location:'Cascais'},
      {validator:validate,now:start+elapsed}).sourceId,provider);
    const deadlines=()=>[...p.timers].filter(([,t])=>t.delay===45000).map(([id])=>id);
    const initial=deadlines();assert.equal(initial.length,2);
    const queuedTimeout=[...p.timers.values()].filter(t=>t.delay===45000)[kind==='additional'?0:1].fn;
    if(ackMode==='early')p.ack(nonce);
    clock.now=start+elapsed;
    if(ackMode==='late')p.ack(nonce);
    assert.deepEqual(deadlines(),initial);
    deadlineReply(p,nonce,kind,observation);
    if(ackMode==='queued')p.ack(nonce);
    assert.equal(p.text('offers').includes('FICTIONAL compatible court'),elapsed<45000,ackMode);
    if(elapsed>=45000){
      assert.doesNotMatch(p.text('sourceStatus'),/Player-visible offer loaded|Fresh player-visible/);
      const field=kind==='additional'?'sourceStatus':'personalStatus',settled=p.text(field);
      assert.match(settled,/timed out|only unsupported replies received/);
      queuedTimeout();assert.equal(p.text(field),settled);
    }else assert.match(p.text('sourceStatus'),/Player-visible offer loaded/);
  }
});

test('an ACK queued beyond the absolute deadline cannot revive the settled primary request',()=>{
  const start=Date.now(),clock={now:start},p=pageRig({},clock),nonce=p.find();
  const queuedAck=()=>p.ack(nonce);
  clock.now=start+45001;
  const observation={...pageObservation('playtomic'),capturedAt:new Date(start).toISOString()};
  deadlineReply(p,nonce,'single',observation);
  assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
  const settled=p.text('personalStatus');assert.match(settled,/timed out/);
  queuedAck();deadlineReply(p,nonce,'single',observation);
  assert.equal(p.text('personalStatus'),settled);assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
});

for(const lateKind of ['single','partial','additional'])test(`late ${lateKind} response preserves an earlier independent valid offer`,()=>{
  const start=Date.now(),clock={now:start},p=pageRig({},clock),nonce=p.find();
  const goodKind=lateKind==='additional'?'single':'additional',goodProvider=goodKind==='additional'?'racket_id':'playtomic';
  const good={...pageObservation(goodProvider),capturedAt:new Date(start).toISOString()};
  good.offers[0].court='FICTIONAL earlier independent court';
  clock.now=start+44999;deadlineReply(p,nonce,goodKind,good);
  const card=p.node('offers').children[0],status=p.text('searchStatus');
  assert.match(p.text('offers'),/earlier independent/);
  const late={...pageObservation(lateKind==='additional'?'racket_id':'playtomic'),capturedAt:new Date(start).toISOString()};
  late.offers[0].court='FICTIONAL late court';
  clock.now=start+45001;deadlineReply(p,nonce,lateKind,late);
  assert.equal(p.node('offers').children.length,1);assert.equal(p.node('offers').children[0],card);
  assert.doesNotMatch(p.text('offers'),/FICTIONAL late court/);assert.equal(p.text('searchStatus'),status);
  assert.equal(card.children.find(c=>c.href)?.href,good.sourceUrl);
});

test('an incompatible reply before the absolute deadline never settles a healthy current group',()=>{
  for(const kind of ['single','partial','additional']){
    const start=Date.now(),clock={now:start},p=pageRig({},clock),nonce=p.find();
    const observation={...pageObservation(kind==='additional'?'racket_id':'playtomic'),capturedAt:new Date(start).toISOString()};
    clock.now=start+44999;deadlineReply(p,nonce,kind,observation,'0.2.3');
    assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
    deadlineReply(p,nonce,kind,observation);
    assert.match(p.text('offers'),/FICTIONAL compatible court/);
  }
});

test('expired stale nonces and queued old timeouts cannot expire a newly started healthy query',()=>{
  for(const kind of ['single','partial','additional']){
    const start=Date.now(),clock={now:start},p=pageRig({},clock),stale=p.find();
    const queued=[...p.timers.values()].filter(t=>t.delay===45000).map(t=>t.fn);
    clock.now=start+45001;const current=p.find();
    const observation={...pageObservation(kind==='additional'?'racket_id':'playtomic'),capturedAt:new Date(clock.now).toISOString()};
    for(const timeout of queued)timeout();
    deadlineReply(p,stale,kind,observation);deadlineReply(p,'f'.repeat(48),kind,observation);
    assert.doesNotMatch(p.text('offers'),/FICTIONAL compatible court/);
    deadlineReply(p,current,kind,observation);
    assert.match(p.text('offers'),/FICTIONAL compatible court/);
  }
});
