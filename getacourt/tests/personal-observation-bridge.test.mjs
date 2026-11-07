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


function mixedDurationObservation() {
  const value = structuredClone(observed);
  value.offers = [
    {court:'Court 60',startLabel:'2:00 PM',endLabel:'3:00 PM',durationMinutes:60,priceEur:24},
    {court:'Court 90',startLabel:'3:30 PM',endLabel:'5:00 PM',durationMinutes:90,priceEur:36.5},
    {court:'Court 120',startLabel:'5:30 PM',endLabel:'7:30 PM',durationMinutes:120,priceEur:48}
  ];
  return value;
}

test('combined 60 or 90 selection excludes a valid 120 minute personal offer without changing retained identity',()=>{
  const value = mixedDurationObservation();
  const result = normalize(value,{...query,duration:'any'});
  assert.deepEqual(result.offers.map(offer=>offer.duration),[60,90]);
  assert.deepEqual(result.offers,[
    ...normalize(value,{...query,duration:'60'}).offers,
    ...normalize(value,{...query,duration:'90'}).offers
  ]);
  assert.deepEqual(result.offers.map(offer=>({court:offer.courtName,price:offer.priceMinor,currency:offer.currency,
    source:offer.sourceUrl,evidence:offer.evidence})),[
    {court:'Court 60',price:2400,currency:'EUR',source:observed.sourceUrl,evidence:'user_ui_observation'},
    {court:'Court 90',price:3650,currency:'EUR',source:observed.sourceUrl,evidence:'user_ui_observation'}
  ]);
  assert.deepEqual(value,mixedDurationObservation());
});

test('explicit 60 selection retains only the matching personal court and exact price',()=>{
  const result = normalize(mixedDurationObservation(),{...query,duration:'60'});
  assert.deepEqual(result.offers.map(offer=>[offer.courtName,offer.duration,offer.priceMinor]),[['Court 60',60,2400]]);
});

test('explicit 90 selection retains only the matching personal court and decimal price',()=>{
  const result = normalize(mixedDurationObservation(),{...query,duration:'90'});
  assert.deepEqual(result.offers.map(offer=>[offer.courtName,offer.duration,offer.priceMinor]),[['Court 90',90,3650]]);
});

test('combined selection rejects an otherwise matching 120 minute only observation as no matching observed offers',()=>{
  const value = mixedDurationObservation();
  value.offers = [value.offers[2]];
  assert.throws(()=>normalize(value,{...query,duration:'any'}),/NO_MATCHING_OBSERVED_OFFERS/);
});


function priceObservation(prices) {
  const value = structuredClone(observed);
  value.offers = prices.map((priceEur,index)=>({...value.offers[0],court:'Price court '+index,priceEur}));
  return value;
}

for(const amount of [36.005,39.999,1.001]) {
  test('positive non-cent EUR amount '+amount+' is excluded instead of rounded into a price',()=>{
    assert.throws(()=>normalize(priceObservation([amount])),/NO_MATCHING_OBSERVED_OFFERS/);
  });
}

test('exact EUR cents preserve binary-floating values and the existing upper bound',()=>{
  const prices = [0.01,1.10,2.30,19.99,39.50,36.50,0.29,2000];
  const expectedCents = [1,110,230,1999,3950,3650,29,200000];
  const value = priceObservation(prices),before = structuredClone(value);
  const result = normalize(value);
  assert.deepEqual(result.offers.map(offer=>offer.priceMinor),expectedCents);
  assert.deepEqual(result.offers.map(offer=>offer.priceMinor/100),prices);
  assert.deepEqual(value,before);
});

test('mixed exact and non-cent EUR offers retain original identity, provenance and frozen private output',()=>{
  const value = priceObservation([36.005,39.50,39.999,19.99,1.001,0.01,2.30]);
  const before = structuredClone(value);
  const allRepresentable = structuredClone(value);
  for(const index of [0,2,4]) allRepresentable.offers[index].priceEur = 13.37;
  const reference = normalize(allRepresentable);
  const result = normalize(value);
  assert.deepEqual(result.offers,[1,3,5,6].map(index=>reference.offers[index]));
  assert.deepEqual(result.offers.map(offer=>offer.courtName),['Price court 1','Price court 3','Price court 5','Price court 6']);
  assert.deepEqual(result.offers.map(offer=>offer.priceMinor),[3950,1999,1,230]);
  assert.equal(result.sourceId,reference.sourceId);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.offers));
  for(const offer of result.offers) {
    assert.ok(Object.isFrozen(offer));
    assert.equal(offer.sourceUrl,observed.sourceUrl);
    assert.equal(offer.evidence,'user_ui_observation');
    assert.equal(offer.currency,'EUR');
    assert.equal(offer.timezone,null);
    assert.equal(offer.providerFreshness,'unknown');
    assert.equal(offer.bookingEnabled,false);
  }
  assert.deepEqual(value,before);
});
