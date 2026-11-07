import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const require=createRequire(import.meta.url);
const factory=require("../../getacourt/assets/commercial-signals.js");
const src=readFileSync("getacourt/assets/commercial-signals.js","utf8");
const app=readFileSync("getacourt/assets/app.js","utf8");
const html=readFileSync("getacourt/index.html","utf8");

const collisionTime="2026-11-07T17:09:38.600Z";
function isolatedFactory(){
 const fixed=Date.parse(collisionTime);
 class FixedDate extends Date {
  constructor(...args){super(...(args.length?args:[fixed]));}
  static now(){return fixed;}
 }
 const context={module:{exports:{}},URLSearchParams,Date:FixedDate};
 vm.runInNewContext(src,context,{filename:"commercial-signals.js"});
 return context.module.exports;
}

function assertMinimized(records,expectedTime){
 const common=["schema_version","stage","sequence","occurred_at","acquisition_source","sport","location_mode"];
 const fields={search_requested:[],availability_result:["venues","available_slots","source_class"],
  slot_selected:["venue_id","slot_id","provider"],booking_preview:["venue_id","slot_id","provider","transaction_state"]};
 for(const record of records){
  assert.ok(Object.hasOwn(fields,record.stage));
  assert.deepEqual(Reflect.ownKeys(record).sort(),[...common,...fields[record.stage]].sort(),record.stage);
  assert.equal(typeof record.occurred_at,"string");
  assert.match(record.occurred_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Number.isFinite(Date.parse(record.occurred_at)));
  assert.equal(new Date(record.occurred_at).toISOString(),record.occurred_at);
  if(expectedTime!==undefined)assert.equal(record.occurred_at,expectedTime);
  // Validate the complete key set and timestamp before scanning only non-time payload values.
  const {occurred_at,...payload}=record,raw=JSON.stringify(payload);
  for(const forbidden of ["38.6","-9.4","private","authToken","full_name","home_country","SK","price",
   "latitude","longitude","email","utm_campaign","secret","Private Tester"]){
   assert.equal(raw.includes(forbidden),false,forbidden);
  }
 }
}

test("Decision 104 only permits first-party ephemeral shadow events, no transport or persistence",()=>{
 assert.doesNotMatch(src,/(?:navigator\.sendBeacon|XMLHttpRequest|localStorage|sessionStorage|fetch\s*\()/);
 assert.match(src,/const STAGES=new Set\(\["search_requested","availability_result","slot_selected","booking_preview"\]\)/);
 assert.ok(html.indexOf("commercial-signals.js")<html.indexOf("assets/app.js"));
 assert.match(app,/shadowSignal\("search_requested"\)/);
 assert.match(app,/shadowSignal\("availability_result"/);
 assert.match(app,/shadowSignal\("slot_selected"/);
 assert.match(app,/shadowSignal\("booking_preview"/);
});
test("No booking, payment, provider handoff, or authoritative conversion inferred from UI preview",()=>{
 const collector=factory.create({search:"?utm_source=municipality"});
 assert.equal(collector.record("booking_started",{serverHoldAccepted:true}),null);
 assert.equal(collector.record("authoritative_confirmation",{status:"confirmed"}),null);
 assert.equal(collector.record("provider_handoff",{verified:true}),null);
 assert.equal(collector.record("payment_received",{amount:123}),null);
 assert.equal(collector.snapshot().length,0);
});
test("Acquisition categories, data minimization, and untrusted source classification",()=>{
 assert.equal(factory.sourceFromSearch("?utm_source=hotel"),"hotel");
 assert.equal(factory.sourceFromSearch("?utm_source=unknown-sales-email"),"other");
 assert.equal(factory.sourceFromSearch(""),"direct");
 const collector=factory.create({search:"?utm_source=federation&utm_campaign=private.person%40example.invalid"});
 collector.record("search_requested",{
  sport:"padel",locationMode:"near_me",latitude:38.6,longitude:-9.4,email:"private@example.invalid"
 });
 collector.record("availability_result",{
  sport:"padel",venueCount:2,slotCount:8,sourceClass:"untrusted",home_country:"SK"
 });
 collector.record("slot_selected",{
  sport:"padel",provider:"playtomic",venueId:"qa-venue-1",slotId:"qa-slot-1",
  full_name:"Private Tester",authToken:"secret",price:42
 });
 collector.record("booking_preview",{sport:"padel",venueId:"qa-venue-1",slotId:"qa-slot-1"});
 const records=collector.snapshot();
 assert.deepEqual(records.map(e=>e.stage),["search_requested","availability_result","slot_selected","booking_preview"]);
 assert.equal(records[0].location_mode,"near_me");
 assert.equal(records[0].acquisition_source,"federation");
 assert.equal(records[1].source_class,"fixture_or_unknown");
 assert.equal(records[1].venues,2);
 assert.equal(records[1].available_slots,8);
 assert.equal(records[2].provider,"playtomic");
 assert.equal(records[3].transaction_state,"preview_only");
 assertMinimized(records);
 collector.clear();
 assert.deepEqual(collector.snapshot(),[]);
});
test("Provider spoofing and unknown venue/slot cannot create a trusted event",()=>{
 const c=factory.create();
 assert.equal(c.record("slot_selected",{venueId:"../../evil",slotId:"x",provider:"playtomic"}),null);
 assert.equal(c.record("booking_preview",{venueId:"venue",slotId:""}),null);
 c.record("slot_selected",{venueId:"venue",slotId:"slot",provider:"invented-provider"});
 assert.equal(c.snapshot()[0].provider,"unknown");
 assert.equal(c.snapshot()[0].sequence,1);
 const coreKey="12345678-1234-1234-1234-123456789abc|2026-10-17T17:00:00.000+01:00|90";
 c.record("slot_selected",{venueId:"venue",slotId:coreKey,provider:"fillmycourt"});
 assert.equal(c.snapshot()[1].slot_id,coreKey);
 assert.equal(c.snapshot()[1].provider,"fillmycourt");
});
test("Ephemeral ring buffer bounded at 64 events, snapshot is defensive copy",()=>{
 const c=factory.create();
 for(let i=0;i<70;i++)c.record("search_requested",{sport:"padel"});
 const records=c.snapshot();
 assert.equal(records.length,64);
 assert.equal(records[0].sequence,7);
 records[0].stage="injected";
 assert.equal(c.snapshot()[0].stage,"search_requested");
});

test("Generated timestamps containing coordinate digits do not hide actual PII or accept a caller timestamp override",()=>{
 for(const override of ["2035-01-02T03:04:05.006Z","private-time@example.invalid"]){
  const collector=isolatedFactory().create({search:"?utm_source=federation&utm_campaign=private.person%40example.invalid"});
  const details={sport:"padel",locationMode:"near_me",venueCount:2,slotCount:8,sourceClass:"untrusted",
   venueId:"qa-venue-1",slotId:"qa-slot-1",provider:"playtomic",latitude:38.6,longitude:-9.4,
   email:"private@example.invalid",full_name:"Private Tester",authToken:"secret",price:42,
   home_country:"SK",utm_campaign:"private-campaign",occurred_at:override};
  for(const stage of ["search_requested","availability_result","slot_selected","booking_preview"])collector.record(stage,details);
  const records=Array.from(collector.snapshot(),record=>({...record}));
  assert.deepEqual(records.map(e=>e.stage),["search_requested","availability_result","slot_selected","booking_preview"]);
  assertMinimized(records,collisionTime);
  assert.equal(JSON.stringify(records).includes(override),false);
 }
});
