import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const factory=require("../../getacourt/assets/commercial-signals.js");
const src=readFileSync("getacourt/assets/commercial-signals.js","utf8");
const app=readFileSync("getacourt/assets/app.js","utf8");
const html=readFileSync("getacourt/index.html","utf8");

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
 const raw=JSON.stringify(records);
 for(const forbidden of ["38.6","-9.4","private","authToken","full_name","home_country","SK","price"]){
  assert.equal(raw.includes(forbidden),false,forbidden);
 }
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
