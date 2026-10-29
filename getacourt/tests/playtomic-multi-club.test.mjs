// Bounded multi-club player UI search with ONE Playtomic Chrome site grant.
// Fictional source UI only. No provider contact, account harvesting, booking,
// hidden APIs, background poll, or invented availability.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {CLUBS,safeSourceUrl,directoryMatches} from '../assets/source-catalog.mjs';
import {normalizePersonalObservation} from '../assets/personal-observation-bridge.mjs';
const require=createRequire(import.meta.url);
const validate=require('../assets/personal-source-observation.js').validateObservation;
const folder=new URL('../browser-companion/',import.meta.url);
const catalog=readFileSync(new URL('playtomic-club-catalog.js',folder),'utf8');
const background=readFileSync(new URL('background.js',folder),'utf8');
const observations=readFileSync(new URL('observation.js',folder),'utf8');
const viewer='https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html';
const known=new Map([
 ['https://playtomic.com/clubs/cascais-padel-club','Cascais Padel & Nature'],
 ['https://playtomic.com/clubs/sports-club-cascais','Sports Club Cascais'],
 ['https://playtomic.com/clubs/padel-set-club-parede','Padel Set Club Parede'],
 ['https://playtomic.com/clubs/quinta-dos-lombos-padel','Quinta dos Lombos Padel']
]);
const tomorrow=()=>new Date(Date.now()+86400000).toISOString().slice(0,10);
const query=(location='Cascais',sport='Padel')=>({
 date:tomorrow(),sport,location,from:'08:00',to:'23:00',durationMinutes:90
});
const page={id:'gac',frameId:0,url:viewer,tab:{id:7,url:viewer}};
function driver({grant=true,failSet=new Set(),forgedSource=null}={}){
 const local={approvedSource:'https://playtomic.com/clubs/cascais-padel-club'},session={};
 const calls=[],tabs=new Map(),created=[],removed=[],handlers={};
 let nextTabId=10,nextWindowId=100,approved=true,captures=0;
 const storage=data=>({
   get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),
   set:async o=>Object.assign(data,o),
   remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}
 });
 const chrome={
  runtime:{id:'gac',getURL:p=>'chrome-extension://gac/'+p,
   onMessage:{addListener:fn=>{handlers.message=fn;}}},
  storage:{local:storage(local),session:storage(session)},
  permissions:{contains:async()=>approved&&grant},
  tabs:{
   query:async()=>[],onUpdated:{addListener(){},removeListener(){}},
   create:async options=>{
     const tab={id:nextTabId++,windowId:options.windowId||1,
       url:options.url,status:'complete'};
     tabs.set(tab.id,tab);created.push({...options});return tab;
   },
   get:async id=>tabs.get(id)||Promise.reject(Error('not found')),
   sendMessage:async()=>({status:'cancelled'}),
   remove:async id=>{tabs.delete(id);},
   update:async()=>{}
  },
  windows:{
   get:async()=>({width:480}),
   create:async options=>{
     const tab=tabs.get(options.tabId);if(tab)tab.windowId=nextWindowId;
     return {id:nextWindowId++};
   },
   remove:async id=>{removed.push(id);for(const [k,v] of tabs)if(v.windowId===id)tabs.delete(k);},
   update:async()=>{}
  },
  scripting:{executeScript:async options=>{
    const tab=tabs.get(options.target.tabId);
    if(!tab)throw Error('unexpected source tab');
    if(options.files){calls.push({source:tab.url,kind:'inject',files:options.files});return [];}
    captures++;calls.push({source:tab.url,kind:'capture'});
    const q=options.args[0];
    if(failSet.has(tab.url))
      return [{frameId:0,result:{readerError:'NO_EXPANDED_OFFERS'}}];
    const url=forgedSource&&tab.url.includes('sports-club')?forgedSource:tab.url;
    return [{frameId:0,result:{
      provider:'playtomic',source:'user_ui_observation',sourceUrl:url,
      venue:known.get(tab.url),date:q.date,sport:q.sport,
      capturedAt:new Date().toISOString(),timezone:null,
      sourceFreshness:'unknown',coverage:'expanded_offers_only',
      offers:[{court:'Court 1',startLabel:'6:00 PM',endLabel:'7:30 PM',
        durationMinutes:90,priceEur:36}]
    }}];
  }}
 };
 const ctx=vm.createContext({chrome,URL,Date,setTimeout,clearTimeout,importScripts(){}});
 vm.runInContext(catalog,ctx);
 vm.runInContext(observations,ctx);
 vm.runInContext(background,ctx);
 const send=message=>new Promise(resolve=>handlers.message(message,page,resolve));
 return{send,local,session,created,removed,calls,captures,
  catalog:ctx.GetACourtPlaytomicClubCatalog,setGranted:v=>approved=v};
}
test('four official club pages have a canonical matching map, never offer inventory',()=>{
 const d=driver();
 const caps=Array.from(d.catalog.matching(query()));
 assert.equal(caps.length,4);
 assert.deepEqual(caps.map(c=>c.sourceUrl),[...known.keys()]);
 for(const c of caps){
   assert.equal(known.get(c.sourceUrl),c.name);
   assert.equal(safeSourceUrl('playtomic',c.sourceUrl),c.sourceUrl);
   assert.equal(Object.hasOwn(c,'offers'),false);
   assert.equal(Object.hasOwn(c,'price'),false);
   const normalized=CLUBS.find(club=>club.sources.some(s=>s.url===c.sourceUrl));
   assert.equal(normalized?.name,c.name);
   assert.ok(directoryMatches({location:'Cascais',sport:'padel'}).some(x=>x.id===normalized.id));
 }
 assert.equal(d.catalog.matching(query('Parede')).length,1);
 assert.equal(d.catalog.matching(query('Carcavelos')).length,1);
 assert.equal(d.catalog.matching(query('Alcabideche')).length,2);
 assert.equal(d.catalog.matching(query('Lisboa')).length,0);
 assert.equal(d.catalog.matching(query('Cascais','Tennis')).length,0);
});
test('ONE approved provider site/search checks a bounded four-club list and cleans temporary window',async()=>{
 const d=driver({failSet:new Set(['https://playtomic.com/clubs/quinta-dos-lombos-padel'])});
 const result=await d.send({action:'autoSearchPlaytomicClubsFromGet',query:query()});
 assert.equal(result.status,'partial');
 assert.equal(result.coverage,'bounded_reviewed_club_pages_only');
 assert.equal(result.sources.length,4);
 assert.equal(result.sources.filter(s=>s.status==='observed').length,3);
 assert.equal(result.sources[3].status,'unavailable');
 assert.equal(result.sources[3].code,'NO_EXPANDED_OFFERS');
 assert.equal(d.created.length,4);
 assert.equal(d.removed.length,1);
 assert.deepEqual(d.created.map(t=>t.url),[...known.keys()]);
 assert.equal(d.captures,4);
 assert.equal(d.calls.filter(c=>c.kind==='inject').length,4);
 for(const row of result.sources.filter(s=>s.status==='observed')){
   assert.equal(row.provider,'playtomic');
   const normalized=normalizePersonalObservation(JSON.stringify(row.observation),
     {location:'Cascais',sport:'padel',date:tomorrow(),from:'08:00',to:'23:00',duration:'90'},
     {now:Date.now(),validator:validate});
   assert.equal(normalized.offers.length,1);
   assert.equal(normalized.offers[0].sourceUrl,row.sourceUrl);
   assert.equal(normalized.offers[0].priceMinor,3600);
   assert.equal(normalized.offers[0].bookingEnabled,false);
 }
 assert.deepEqual(Object.keys(d.local),['approvedSource']);
 assert.equal(Object.hasOwn(d.local,'cookie'),false);
});
test('user-selected Parede area only checks its one official club; no provider browsing in an unknown area',async()=>{
 const d=driver();
 const pare=(await d.send({action:'autoSearchPlaytomicClubsFromGet',query:query('Parede')}));
 assert.equal(pare.sources.length,1);
 assert.equal(pare.sources[0].sourceUrl,'https://playtomic.com/clubs/padel-set-club-parede');
 const other=driver();
 const result=await other.send({action:'autoSearchPlaytomicClubsFromGet',query:query('Lisboa')});
 assert.equal(result.sources.length,0);
 assert.equal(result.coverage,'no_reviewed_club_in_area');
 assert.equal(other.created.length,0);
});
test('forged provider origin, revoked grant and time budget all fail closed without fabricating a second result',async()=>{
 const d=driver({forgedSource:'https://evil.example.invalid/clubs/x'});
 const first=await d.send({action:'autoSearchPlaytomicClubsFromGet',query:query()});
 assert.equal(first.sources.length,4);
 assert.equal(first.sources[1].status,'unavailable');
 assert.equal(first.sources[1].code,'SCHEDULE_NOT_READY');
 assert.equal(first.sources.filter(s=>s.status==='observed').length,3);
 const count=d.created.length;
 const second=await d.send({action:'autoSearchPlaytomicClubsFromGet',query:query()});
 assert.equal(second.code,'RATE_LIMITED');
 assert.equal(d.created.length,count);
 const denied=driver({grant:false});
 assert.equal((await denied.send({action:'autoSearchPlaytomicClubsFromGet',query:query()})).code,'SITE_ACCESS_REQUIRED');
 assert.equal(denied.created.length,0);
 const revoked=driver();await revoked.send({action:'revoke'});
 assert.equal((await revoked.send({action:'autoSearchPlaytomicClubsFromGet',query:query()})).code,'CONNECT_REQUIRED');
});
test('malformed query cannot cause browser tab creation or other account access',async()=>{
 const d=driver();
 for(const patch of [
   {location:'https://evil.example.invalid'},
   {location:''},{durationMinutes:999},{date:'2026-02-30'},
   {accountToken:'EXFIL'}, {sport:'Football'}
 ]){
   const result=await d.send({action:'autoSearchPlaytomicClubsFromGet',query:{...query(),...patch}});
   assert.equal(result.status==='partial'&&result.sources.length===0 ||
     result.code==='QUERY_INVALID',true);
 }
 assert.equal(d.created.length,0);
});
