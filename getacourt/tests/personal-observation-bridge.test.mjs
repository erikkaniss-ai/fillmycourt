import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {normalizePersonalObservation,exportPersonalObservation} from "../assets/personal-observation-bridge.mjs";
const require=createRequire(import.meta.url);
const {validateObservation}=require("../assets/personal-source-observation.js");
const now=Date.parse("2026-10-25T12:00:25.000Z");
const query={location:"Cascais",sport:"padel",date:"2026-10-25",from:"14:00",to:"20:00",duration:"90"};
const observed={
  provider:"playtomic",source:"user_ui_observation",
  sourceUrl:"https://playtomic.com/clubs/cascais-padel-club",
  venue:"Cascais Padel & Nature",date:"2026-10-25",sport:"Padel",
  capturedAt:"2026-10-25T12:00:00.000Z",timezone:null,sourceFreshness:"unknown",
  coverage:"expanded_offers_only",offers:[
    {court:"Court 1",startLabel:"2:00 PM",endLabel:"3:30 PM",durationMinutes:90,priceEur:36},
    {court:"Court 2",startLabel:"6:30 PM",endLabel:"8:00 PM",durationMinutes:90,priceEur:39.5}
  ]
};
const normalize=(v,q=query,t=now)=>normalizePersonalObservation(JSON.stringify(v),q,{now:t,validator:validateObservation});
test("player copy yields real observed-only personal offers beside Core, no native booking or inferred timezone",()=>{
  const result=normalize(observed);
  assert.equal(result.sourceId,"playtomic");
  assert.equal(result.status,"personal_observed");
  assert.equal(result.clubId,"pt-cascais-padel-nature");
  assert.equal(result.offers.length,2);
  assert.deepEqual(result.offers.map(o=>o.priceMinor),[3600,3950]);
  for(const o of result.offers){
    assert.equal(o.evidence,"user_ui_observation");
    assert.equal(o.bookingEnabled,false);
    assert.equal(o.timezone,null);
    assert.equal(o.startsAt,null);
    assert.equal(o.sourceId,"playtomic");
    assert.ok(Object.isFrozen(o));
  }
  assert.equal(result.expiresAt,"2026-10-25T12:01:00.000Z");
  assert.ok(Object.isFrozen(result.offers));
  assert.deepEqual(normalize(JSON.parse(exportPersonalObservation(observed,{validator:validateObservation,now}))).offers,result.offers);
});
test("time/day and duration filtering never fabricate availability outside observed subset",()=>{
  assert.equal(normalize(observed,{...query,from:"17:00"}).offers.length,1);
  assert.throws(()=>normalize(observed,{...query,from:"21:00"}),/NO_MATCHING_OBSERVED_OFFERS/);
  assert.throws(()=>normalize(observed,{...query,duration:"60"}),/NO_MATCHING_OBSERVED_OFFERS/);
  assert.throws(()=>normalize(observed,{...query,date:"2026-10-26"}),/OBSERVATION_QUERY_MISMATCH/);
  assert.throws(()=>normalize(observed,{...query,sport:"tennis"}),/OBSERVATION_QUERY_MISMATCH/);
});
test("capturedAt 60-second expiry, future claims and malformed sensitive data fail closed",()=>{
  assert.throws(()=>normalize(observed,query,now+60000),/OBSERVATION_EXPIRED/);
  assert.throws(()=>normalize(observed,query,now-31000),/OBSERVATION_EXPIRED/);
  for(const patch of [
    {access_token:"secret"}, {accountEmail:"hidden@example.invalid"},
    {bookingEnabled:true},{timezone:"Europe/Lisbon"},
    {sourceFreshness:"live"},{coverage:"all_courts"},
    {sourceUrl:"https://playtomic.com/clubs/cascais-padel-club?sid=private"},
    {sourceUrl:"https://playtomic.com.evil.invalid/clubs/x"},
    {offers:observed.offers.map(o=>({...o,account:"secret"}))},
    {offers:[{...observed.offers[0],startLabel:"bad"}]},
    {offers:[{...observed.offers[0],durationMinutes:60}]},
    {offers:[{...observed.offers[0],endLabel:"2:00 PM"}]},
    {offers:[{...observed.offers[0],priceEur:0}]},
  ])assert.throws(()=>normalize({...observed,...patch}),undefined,JSON.stringify(patch));
  assert.throws(()=>normalizePersonalObservation("x".repeat(16385),query,{now,validator:validateObservation}),/INVALID_OBSERVATION/);
  assert.throws(()=>normalizePersonalObservation("not json",query,{now,validator:validateObservation}));
});
test("unmapped valid Playtomic clubs stay personal, not falsely merged to other club",()=>{
  const v={...observed,sourceUrl:"https://playtomic.com/clubs/another-club",venue:"Other court center"};
  const result=normalize(v,{...query,location:"Other court center"});
  assert.equal(result.clubId,null);
  assert.equal(result.offers[0].clubName,"Other court center");
});
test("import cannot claim an offer in another club or unrelated location",()=>{
  assert.throws(()=>normalize(observed,{...query,location:"Oeiras"}),/OBSERVATION_LOCATION_MISMATCH/);
  const other={...observed,sourceUrl:"https://playtomic.com/clubs/unmapped-club",venue:"Unmapped Club"};
  assert.throws(()=>normalize(other,query),/OBSERVATION_LOCATION_MISMATCH/);
  assert.equal(normalize(other,{...query,location:"Unmapped Club"}).clubId,null);
});
test("verified new TieSports directory Padel Factory is listed without inventing free courts or price",async()=>{
  const {directoryMatches}=await import("../assets/source-catalog.mjs");
  const clubs=directoryMatches({...query,location:"Lisboa"});
  const factory=clubs.find(c=>c.id==="pt-padel-factory-lisboa");
  assert.ok(factory);
  assert.equal(factory.sources[0].id,"tiesports");
  assert.equal(factory.sources[0].url,"https://clubs.tiesports.com/en/lisboa/PadelFactory");
  assert.equal(factory.sources[0].kind,"club_page");
  assert.equal(Object.hasOwn(factory,"availableSlots"),false);
});
test("unknown DST timezone is never inferred from user-provided wall-clock labels",()=>{
  const result=normalize(observed);
  assert.equal(result.offers[0].startsAt,null);
  assert.equal(result.offers[0].timezone,null);
  assert.match(result.notice,/time zone unknown/);
});
test("browser transfer is explicit, never network/server-side, and never includes provider account",()=>{
  const source=readFileSync("getacourt/assets/personal-observation-bridge.mjs","utf8");
  const html=readFileSync("getacourt/search-all.html","utf8");
  const js=readFileSync("getacourt/assets/federated-search-page.mjs","utf8");
  const reader=readFileSync("getacourt/browser-companion/reader.js","utf8");
  const extPage=readFileSync("getacourt/browser-companion/reader.html","utf8");
  for(const p of [/\bfetch\s*\(/,/localStorage/,/sessionStorage/,/\bchrome\./,/document\.cookie/,/postMessage\s*\(/])
    assert.doesNotMatch(source,p);
  assert.match(html,/id="personalPayload"/);
  assert.match(html,/id="personalCards"/);
  assert.match(js,/normalizePersonalObservation/);
  assert.match(js,/personalExpiry/);
  assert.match(js,/pagehide/);
  assert.match(reader,/navigator\.clipboard\.writeText\(sanitized\)/);
  assert.match(reader,/JSON\.stringify\(validate\(current\)\)/);
  assert.match(extPage,/id="copyObservation"/);
  assert.doesNotMatch(source,/api\/gac\/search-all|provider token|customer_email/i);
});
