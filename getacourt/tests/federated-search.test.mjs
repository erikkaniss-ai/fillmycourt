import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SOURCES,CLUBS,directoryMatches,safeSourceUrl} from '../assets/source-catalog.mjs';
import {validateQuery,normalizeCoreSlot,mergeResults,searchFederated,directorySource,localDay} from '../assets/federated-search.mjs';
import handler from '../../netlify/functions/getacourt-search-all.mts';
const now=new Date('2026-10-25T12:00:00Z');
const input={location:'Cascais',sport:'padel',date:'2026-10-25',from:'00:00',to:'23:59',duration:'any'};
const query=validateQuery(input,now),approved=new Set(['real-club']);
const row={venue_id:'real-club',venue_name:'Fictional CI Club',id:'court-1',name:'Court one',sport:'padel',starts_at:'2026-10-25T18:00:00Z',timezone:'Europe/Lisbon',duration_minutes:60,amount_minor:2650,currency:'EUR'};
const adapters=()=>Object.fromEntries(SOURCES.map(s=>[s.id,q=>directorySource(s.id,q)]));

test('directory matches exact area/sport and merges Racket ID + Smashpro by reviewed canonical venue ID',()=>{
  const r=mergeResults(query,[],now);assert.equal(r.directory.length,5);assert.equal(r.offers.length,0);
  const quinta=r.directory.find(c=>c.id==='pt-rackets-pro-quinta-marinha');assert.deepEqual(quinta.sources.map(s=>s.id),['racket_id','smashpro']);
  assert.equal(directoryMatches({...query,location:'Oeiras'}).length,1);
  assert.equal(directoryMatches({...query,location:'London'}).length,0);
  assert.equal(directoryMatches({...query,sport:'squash'}).length,0);
  assert.equal(directoryMatches({...query,location:'cas'}).length,0);
  assert.ok(Object.isFrozen(CLUBS[0].sources));assert.equal(r.complete,false);assert.equal(r.bookingEnabled,false);
});
test('query rejects impossible dates, past/horizon, reversed times, unknown fields and coordinates',()=>{
  for(const patch of [{date:'2026-02-30'},{date:'2026-10-24'},{date:'2027-12-01'},{date:'not-a-date'},{from:'24:00'},{from:'19:00',to:'18:00'},{from:'18:00',to:'18:00'},{duration:'120'},{sport:'football'},{location:''},{location:'a\nb'},{lat:'38.7'},{token:'private'}])assert.throws(()=>validateQuery({...input,...patch},now),/INVALID_SEARCH/);
  assert.equal(localDay(new Date('2026-07-01T23:30:00Z')),'2026-07-02');
});
test('native parser requires explicit price, IDs, offset and venue timezone; zero is accepted only when explicit',()=>{
  assert.equal(normalizeCoreSlot(row,query,approved).priceMinor,2650);
  assert.equal(normalizeCoreSlot({...row,amount_minor:0},query,approved).priceMinor,0);
  for(const patch of [{amount_minor:null},{amount_minor:undefined},{amount_minor:'2650'},{amount_minor:-1},{amount_minor:1.5},{currency:null},{currency:'bad'},{id:undefined},{venue_id:'other'},{timezone:'Not/AZone'},{starts_at:'2026-10-25T18:00:00'},{duration_minutes:120},{sport:'tennis'},{starts_at:'2026-10-26T18:00:00Z'}])assert.equal(normalizeCoreSlot({...row,...patch},query,approved),null);
  assert.equal(normalizeCoreSlot(row,{...query,to:'18:00'},approved),null);
});
test('known staging fixture remains excluded even when allowlisted',()=>{
  const id='d6dbceca-3cca-4053-bcb7-5491a9225cb0';assert.equal(normalizeCoreSlot({...row,venue_id:id},query,new Set([id])),null);
  assert.equal(normalizeCoreSlot({...row,venue_name:'GetACourt Cascais Test Venue'},query,approved),null);
  assert.equal(normalizeCoreSlot({...row,address:{label:'Cascais staging inventory'}},query,approved),null);
});
test('both Lisbon repeated 01:30 instants remain distinct and chronological with visible offsets',()=>{
  const a=normalizeCoreSlot({...row,starts_at:'2026-10-25T01:30:00+01:00'},query,approved);
  const b=normalizeCoreSlot({...row,starts_at:'2026-10-25T01:30:00+00:00'},query,approved);
  assert.equal(a.time,b.time);assert.notEqual(a.id,b.id);assert.notEqual(a.displayTime,b.displayTime);
  const r=mergeResults(query,[{id:'core',status:'ok',offers:[b,a]}],now);assert.deepEqual(r.offers.map(o=>o.id),[a.id,b.id]);
});
test('duplicate offers collapse but contradictory prices are suppressed; no raw private source data',()=>{
  const offer=normalizeCoreSlot({...row,secret:'do-not-echo',customer_email:'do-not-echo'},query,approved);
  const single=mergeResults(query,[{id:'core',status:'ok',offers:[offer,offer]}],now);assert.equal(single.offers.length,1);
  const conflict=mergeResults(query,[{id:'core',status:'ok',offers:[offer,{...offer,priceMinor:100},offer]}],now);
  assert.equal(conflict.offers.length,0);assert.equal(conflict.conflictingOffers,1);assert.equal(conflict.sources[0].offerCount,0);
  assert.ok(!JSON.stringify(single).includes('do-not-echo'));
});
test('external directory adapters cannot masquerade as native inventory',()=>{
  const fake={...normalizeCoreSlot(row,query,approved),sourceId:'playtomic'};
  const r=mergeResults(query,[{id:'playtomic',status:'ok',offers:[fake]}],now);assert.equal(r.offers.length,0);assert.equal(r.directory.length,5);
});
test('source failures and auth denials preserve other sources and avoid leaking error text',async()=>{
  for(const status of [401,403,500]){
    const a=adapters();a.core=()=>{throw Object.assign(new Error('private bearer'),{status});};
    const r=await searchFederated(query,a,{now});assert.equal(r.directory.length,5);assert.equal(r.sources[0].status,status===500?'error':'needs_auth');assert.ok(!JSON.stringify(r).includes('private bearer'));
  }
});
test('timeout aborts only its adapter and late completion cannot mutate returned snapshot',async()=>{
  const a=adapters();let signal,resolve;a.core=(q,s)=>{signal=s;return new Promise(r=>{resolve=r;});};
  const r=await searchFederated(query,a,{now,timeoutMs:5});assert.equal(r.sources[0].status,'timeout');assert.equal(signal.aborted,true);assert.equal(r.directory.length,5);
  resolve({status:'ok',offers:[normalizeCoreSlot(row,query,approved)]});await new Promise(r=>setTimeout(r,1));assert.equal(r.offers.length,0);
});
test('URL policy refuses credentials, queries, fragments, foreign hosts and checkout paths',()=>{
  const good='https://playtomic.com/clubs/cascais-padel-club';assert.equal(safeSourceUrl('playtomic',good),good);
  for(const bad of ['javascript:alert(1)',good+'?token=x',good+'#x','https://user:pw@playtomic.com/clubs/a','https://playtomic.com.evil.test/clubs/a','https://playtomic.com/checkout/a','https://playtomic.com:444/clubs/a'])assert.equal(safeSourceUrl('playtomic',bad),null);
});
test('HTTP route refuses writes, duplicate/unknown parameters and performs no request without approved venues',async()=>{
  const oldFetch=globalThis.fetch,oldNetlify=globalThis.Netlify;let calls=0;
  globalThis.Netlify={env:{get:()=>''}};globalThis.fetch=()=>{calls++;throw new Error('unexpected network');};
  try{
    const q={...input,date:localDay()};const url='https://test.invalid/api/gac/search-all?'+new URLSearchParams(q);
    assert.equal((await handler(new Request(url,{method:'POST'}))).status,405);
    assert.equal((await handler(new Request(url+'&sport=tennis'))).status,422);
    assert.equal((await handler(new Request(url+'&token=secret'))).status,422);
    const response=await handler(new Request(url));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const data=await response.json();assert.equal(data.sources[0].status,'not_configured');assert.equal(data.offers.length,0);assert.equal(data.directory.length,5);assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;}
});
test('HTTP route reads only configured Core GET, preserving exact cents and directory on errors',async()=>{
  const oldFetch=globalThis.fetch,oldNetlify=globalThis.Netlify;const calls=[];
  globalThis.Netlify={env:{get:k=>({GETACOURT_APPROVED_VENUE_IDS:'real-club',GETACOURT_CORE_API_BASE:'https://core.invalid'})[k]}};
  globalThis.fetch=async(url,init)=>{calls.push([String(url),init]);const p=new URL(url).searchParams;return new Response(JSON.stringify({slots:[{...row,starts_at:p.get('date')+'T18:00:00Z',duration_minutes:Number(p.get('duration'))}]}));};
  try{
    const q={...input,date:localDay()},url='https://test.invalid/api/gac/search-all?'+new URLSearchParams(q);
    const result=await(await handler(new Request(url,{headers:{authorization:'Bearer never-forward'}}))).json();assert.equal(result.offers.length,2);assert.equal(result.offers[0].priceMinor,2650);assert.equal(calls.length,2);
    for(const [url,init] of calls){assert.equal(new URL(url).origin,'https://core.invalid');assert.equal(init.method,undefined);assert.equal(init.headers.has('authorization'),false);assert.equal(init.redirect,'error');assert.ok(init.signal);}
    globalThis.fetch=async()=>new Response(JSON.stringify({message:'PRIVATE ERROR'}),{status:403});
    const failed=await(await handler(new Request(url))).json();assert.equal(failed.sources[0].status,'needs_auth');assert.equal(failed.directory.length,5);assert.ok(!JSON.stringify(failed).includes('PRIVATE ERROR'));
  }finally{globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;}
});
test('historical federated page stays testable, but active personal guide routes to client-only search',()=>{
  const html=fs.readFileSync(new URL('../search-all.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../assets/federated-search-page.mjs',import.meta.url),'utf8');
  const guide=fs.readFileSync(new URL('../personal-sources.html',import.meta.url),'utf8');
  assert.doesNotMatch(guide,/<script|id="pairing"|id="extension"/);assert.match(guide,/href="find.html"/);
  assert.match(html,/id="search"/);assert.match(html,/Connect and open GetACourt/);assert.match(html,/federated-search-page.mjs/);assert.match(js,/\/api\/gac\/search-all\?/);
  for(const pattern of [/localStorage/,/sessionStorage/,/chrome\.runtime/,/setInterval/,/innerHTML/])assert.doesNotMatch(js,pattern);
  assert.match(js,/ticket!==generation/);assert.match(js,/pagehide/);assert.match(js,/expires-now/);
});
