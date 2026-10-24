import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import observationApi from "../assets/personal-source-observation.js";
const {validateObservation}=observationApi;

const observation = Object.freeze({
  provider:"playtomic", source:"user_ui_observation",
  sourceUrl:"https://playtomic.com/clubs/fictional-club",
  venue:"Fictional venue", date:"2026-10-24", sport:"Padel",
  capturedAt:"2026-10-24T10:00:00.000Z", timezone:null,
  sourceFreshness:"unknown", coverage:"expanded_offers_only",
  offers:[{court:"Court 1",startLabel:"9:00 AM",endLabel:"10:30 AM",durationMinutes:90,priceEur:36}]
});

test("only the narrow, explicit Playtomic UI-observation schema reaches the local view",()=>{
  const result=validateObservation(observation);
  assert.deepEqual(result,observation);
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.offers));assert.ok(Object.isFrozen(result.offers[0]));
});

test("other P0 providers, links, freshness claims and malformed offers fail closed",()=>{
  for(const mutate of [
    x=>x.provider="tiesports",x=>x.provider="racket_id",x=>x.provider="smashpro",
    x=>x.sourceUrl+="?account=never",x=>x.sourceFreshness="current",x=>x.timezone="Europe/Lisbon",
    x=>x.coverage="all_courts",x=>x.venue="  Fictional venue",x=>x.date="2026-13-40",
    x=>x.sport="Pickleball",x=>x.capturedAt="2026-10-24T10:00:00Z",
    x=>x.offers=[],x=>x.offers=[{...observation.offers[0],priceEur:0}],
    x=>x.offers=[{...observation.offers[0],court:"Court 1 ",startLabel:"25:00 PM"}],
    x=>x.offers=Array.from({length:21},()=>observation.offers[0])
  ]){const candidate=structuredClone(observation);mutate(candidate);assert.throws(()=>validateObservation(candidate));}
});

test("validator is pure local code with no provider transport or persistent storage",()=>{
  const source=readFileSync("getacourt/assets/personal-source-observation.js","utf8");
  for(const pattern of [
    /\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/\bnavigator\.sendBeacon\b/,
    /\blocalStorage\b/,/\bsessionStorage\b/,/\bindexedDB\b/,/document\.cookie/,
    /chrome\./,/https?:\/\/(?!playtomic\.com\/clubs\/)/
  ])assert.doesNotMatch(source,pattern);
});

test("the packaged reader shares the strict validator and the legacy page is inactive guidance",()=>{
  const page=readFileSync("getacourt/personal-sources.html","utf8");
  const reader=readFileSync("getacourt/browser-companion/reader.html","utf8");
  assert.match(reader,/observation\.js[\s\S]*reader\.js/);
  assert.equal(readFileSync("getacourt/browser-companion/observation.js","utf8").trim(),readFileSync("getacourt/assets/personal-source-observation.js","utf8").trim());
  assert.doesNotMatch(page,/<script|id="pairing"|id="extension"/);
  assert.match(page,/TiePlayer, Racket ID and Smashpro are not connected here/);
});
