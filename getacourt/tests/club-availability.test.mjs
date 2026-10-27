import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readClubFeeds,normalizeClubFeed,clubSource} from '../../netlify/lib/club-availability.mjs';
import {mergeResults,validateQuery} from '../assets/federated-search.mjs';
import handler from '../../netlify/functions/getacourt-search-all.mts';
const now=new Date('2026-10-27T12:00:00Z');
const query=validateQuery({location:'Cascais',sport:'padel',date:'2026-10-27',from:'17:00',to:'22:00',duration:'any'},now);
const grant={id:'fixture-direct',clubId:'fixture-owned-club',clubName:'FICTIONAL CONTRACT TEST CLUB',areas:['Cascais'],timezone:'Europe/Lisbon',feedUrl:'https://fixture-club.example.org/getacourt/availability',bookingUrl:'https://fixture-club.example.org/book',courts:[{id:'court-1',name:'FICTIONAL COURT',sport:'padel'}],approvalRef:'FICTIONAL-CI-ONLY',validUntil:'2026-10-28T12:00:00Z',maxAgeSeconds:60,authority:'club_canonical'};
const row={id:'offer-1',courtId:'court-1',startsAt:'2026-10-27T18:00:00Z',endsAt:'2026-10-27T19:30:00Z',priceMinor:3600,currency:'EUR'};
const payload={version:'gac-club-availability/v1',clubId:grant.clubId,date:query.date,sport:'padel',observedAt:'2026-10-27T11:59:50Z',expiresAt:'2026-10-27T12:00:30Z',offers:[row]};
const raw=JSON.stringify([grant]), clock=()=>now;
const reply=(body=payload,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('no configured or matching club makes zero outbound requests',async()=>{
  let calls=0;const fetcher=()=>{calls++;throw Error('unexpected');};
  assert.equal((await clubSource(query,null,{fetcher})).status,'not_configured');
  assert.equal((await clubSource({...query,location:'Oeiras'},null,{raw,clock,fetcher})).status,'not_configured');
  assert.equal(calls,0);
});
test('config is server-reviewed, bounded, exact-club scoped, HTTPS only and cannot target provider sessions',()=>{
  assert.equal(readClubFeeds(raw,now).length,1);
  for(const patch of [{authority:'playtomic'},{validUntil:now.toISOString()},{approvalRef:''},{timezone:undefined},{maxAgeSeconds:0},{maxAgeSeconds:301},{feedUrl:'http://club.example.org/feed'},{feedUrl:'https://127.0.0.1/feed'},{feedUrl:'https://localhost/feed'},{feedUrl:'https://user:secret@fixture-club.example.org/feed'},{feedUrl:grant.feedUrl+'?token=x'},{feedUrl:grant.feedUrl+'#x'},{feedUrl:'https://other.example.org/feed'},{feedUrl:'https://playtomic.com/feed',bookingUrl:'https://playtomic.com/book'},{customer_email:'PRIVATE'}])assert.throws(()=>readClubFeeds(JSON.stringify([{...grant,...patch}]),now));
  assert.throws(()=>readClubFeeds(JSON.stringify([grant,grant]),now));
  assert.throws(()=>readClubFeeds(JSON.stringify([{...grant,clubId:123}]),now));
  assert.throws(()=>readClubFeeds(JSON.stringify([{...grant,validUntil:'2027-02-30T12:00:00Z'}]),now));
});
test('a club-owned feed can hand off to an explicitly reviewed official Playtomic club page',()=>{
  const official='https://playtomic.com/clubs/fixture-consenting-club';
  const permitted={...grant,bookingProvider:'playtomic',bookingApprovalRef:'FICTIONAL-BOOKING-MAPPING-REVIEW',bookingUrl:official};
  assert.equal(readClubFeeds(JSON.stringify([permitted]),now).length,1);
  const [o]=normalizeClubFeed(payload,permitted,query,now).offers;
  assert.equal(o.handoffUrl,official);
  assert.equal(o.handoffKind,'provider_club_page');
  assert.equal(o.evidence,'club_feed');
  assert.equal(o.bookingEnabled,false);
  // The booking destination grants no right to access the provider's slots.
  const rejected=[
    {...grant,bookingUrl:official},
    {...permitted,bookingApprovalRef:''},
    {...permitted,bookingApprovalRef:undefined},
    {...permitted,bookingProvider:'tiesports'},
    {...permitted,bookingProvider:'club'},
    {...permitted,bookingUrl:'https://playtomic.com/clubs/fixture-consenting-club?token=wrong'},
    {...permitted,bookingUrl:'https://playtomic.com/checkout'},
    {...permitted,bookingUrl:'https://playtomic.com.evil.example.org/clubs/fixture'},
    {...permitted,bookingUrl:'https://racket.id/booking'},
    {...permitted,feedUrl:'https://playtomic.com/clubs/fixture-consenting-club'},
    {...grant,bookingApprovalRef:'FICTIONAL-NOT-NEEDED'}
  ];
  for(const candidate of rejected)assert.throws(()=>readClubFeeds(JSON.stringify([candidate]),now));
});
test('strict feed preserves exact money, court, date, UTC, local offset, expiry and official club handoff',()=>{
  const {offers}=normalizeClubFeed(payload,grant,query,now);assert.equal(offers.length,1);
  const o=offers[0];assert.equal(o.priceMinor,3600);assert.equal(o.duration,90);assert.equal(o.courtName,'FICTIONAL COURT');assert.equal(o.sourceId,'club_internal');assert.equal(o.evidence,'club_feed');assert.equal(o.handoffUrl,grant.bookingUrl);assert.equal(o.expiresAt,'2026-10-27T12:00:30.000Z');assert.equal(o.bookingEnabled,false);
  const merged=mergeResults(query,[{id:'club_internal',status:'ok',offers}],now);
  assert.equal(merged.offers.length,1);assert.equal(merged.sources.find(s=>s.id==='club_internal').offerCount,1);
  assert.equal(merged.sources.find(s=>s.id==='core').offerCount,0);assert.equal(merged.complete,false);
});
test('stale, future, foreign, undated and private-data feeds are refused',()=>{
  for(const patch of [{observedAt:'2026-10-27T12:00:01Z'},{expiresAt:now.toISOString()},{observedAt:'2026-10-27T11:58:00Z'},{expiresAt:'2026-10-27T12:05:00Z'},{clubId:'other'},{date:'2026-10-28'},{sport:'tennis'},{observedAt:undefined},{customer:'PRIVATE'}])assert.throws(()=>normalizeClubFeed({...payload,...patch},grant,query,now));
  assert.throws(()=>normalizeClubFeed({...payload,offers:[{...row,token:'PRIVATE'}]},grant,query,now));
});
test('missing price, unknown court, unsupported duration, wrong range/day and contradictory quotes do not become availability',()=>{
  for(const patch of [{priceMinor:null},{priceMinor:'3600'},{priceMinor:-1},{currency:'GBP'},{courtId:'foreign-court'},{endsAt:'2026-10-27T20:00:00Z'},{startsAt:'2026-10-27T16:00:00Z',endsAt:'2026-10-27T17:30:00Z'},{startsAt:'2026-10-28T18:00:00Z',endsAt:'2026-10-28T19:30:00Z'}])assert.equal(normalizeClubFeed({...payload,offers:[{...row,...patch}]},grant,query,now).offers.length,0);
  assert.equal(normalizeClubFeed({...payload,offers:[row,row]},grant,query,now).offers.length,1);
  assert.equal(normalizeClubFeed({...payload,offers:[row,{...row,priceMinor:3500},row]},grant,query,now).offers.length,0);
});
test('transport is one explicit GET per matching club, with no caller credentials, cookies or redirects',async()=>{
  const calls=[];const signal=new AbortController().signal;
  const result=await clubSource(query,signal,{raw,clock,fetcher:async(url,init)=>{calls.push({url,init});return reply();}});
  assert.equal(result.offers.length,1);assert.equal(calls.length,1);
  assert.equal(calls[0].url.origin,'https://fixture-club.example.org');assert.equal(calls[0].url.searchParams.get('date'),query.date);assert.equal(calls[0].url.searchParams.has('location'),false);
  assert.deepEqual(calls[0].init,{method:'GET',signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',headers:{accept:'application/json'}});
});
test('grant expiry in flight, non-JSON and oversized responses fail closed',async()=>{
  let tick=0;await assert.rejects(clubSource(query,null,{raw,clock:()=>tick++===0?now:new Date(grant.validUntil),fetcher:async()=>reply()}));
  await assert.rejects(clubSource(query,null,{raw,clock,fetcher:async()=>new Response('<html>private</html>')}));
  await assert.rejects(clubSource(query,null,{raw,clock,fetcher:async()=>new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}})}));
});
test('fresh normalized snapshots are reused only until their source expiry, and native duplicate authority is blocked',async()=>{
  let calls=0,t=now;const fetcher=async()=>{calls++;return reply();};
  const options={raw,clock:()=>t,fetcher};
  await clubSource(query,null,options);await clubSource(query,null,options);assert.equal(calls,1);
  t=new Date(payload.expiresAt);await assert.rejects(clubSource(query,null,options));assert.equal(calls,2);
  await assert.rejects(clubSource(query,null,{...options,clock,excludedClubIds:new Set([grant.clubId])}));assert.equal(calls,2);
  assert.equal(normalizeClubFeed({...payload,sport:'tennis'},grant,{...query,sport:'tennis'},now).offers.length,0);
});
test('failure of one authorised club preserves the independent successful club without error leakage',async()=>{
  const second={...grant,id:'fixture-second',clubId:'fixture-second-club',feedUrl:'https://second-club.example.org/feed',bookingUrl:'https://second-club.example.org/book'};
  const result=await clubSource(query,null,{raw:JSON.stringify([grant,second]),clock,fetcher:async url=>url.hostname==='second-club.example.org'?reply({},403):reply()});
  assert.equal(result.offers.length,1);assert.equal(result.failedFeeds,1);assert.equal(result.status,'ok');
});
test('actual HTTP handler reads a configured club feed without a Core dependency or extension',async()=>{
  const oldFetch=globalThis.fetch,oldNetlify=globalThis.Netlify;
  const realNow=new Date(),day=new Date(realNow.getTime()+86400000).toISOString().slice(0,10);
  const g={...grant,validUntil:new Date(realNow.getTime()+86400000).toISOString()};
  globalThis.Netlify={env:{get:k=>k==='GETACOURT_CLUB_FEEDS'?JSON.stringify([g]):''}};
  const calls=[];globalThis.fetch=async(url,init)=>{calls.push([url,init]);return reply({...payload,date:day,observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),offers:[{...row,startsAt:day+'T18:00:00Z',endsAt:day+'T19:30:00Z'}]});};
  try{const r=await handler(new Request('https://app.example.org/api/gac/search-all?'+new URLSearchParams({...query,date:day}),{headers:{authorization:'Bearer DO_NOT_FORWARD'}}));
    assert.equal(r.status,200);const data=await r.json();assert.equal(data.offers.length,1);assert.equal(data.offers[0].sourceId,'club_internal');assert.equal(calls.length,1);assert.ok(!JSON.stringify(calls).includes('DO_NOT_FORWARD'));assert.equal(r.headers.get('cache-control'),'no-store');
  }finally{globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;}
});
test('release entry has no extension, personal-payload, clipboard or directory requirement',()=>{
  const html=fs.readFileSync(new URL('../find.html',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../assets/court-search-page.mjs',import.meta.url),'utf8');
  assert.match(html,/Find courts/);assert.match(js,/\/api\/gac\/search-all\?/);
  for(const pattern of [/chrome\./,/clipboard/i,/personalPayload/,/Reader/,/localStorage/,/sessionStorage/,/innerHTML/,/setInterval/]){assert.doesNotMatch(html,pattern);assert.doesNotMatch(js,pattern);}
});
