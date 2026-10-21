// Parallel security lane: synthetic fixtures only. This file never starts a
// provider request, token flow, booking, payment or persistent data action.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const foundation=require("../../getacourt/assets/provider-connection-foundation.js");
const source=readFileSync("getacourt/assets/provider-connection-foundation.js","utf8");

function connection(provider="playtomic"){
  return foundation.createSyntheticConnection({
    provider,connection_ref:"parallel-lane-connection",
    consent:{subject_ref:"parallel-lane-player",proof_ref:"parallel-lane-consent",
      scope:"availability.read",granted_at:"2026-10-20T20:40:00Z",jurisdiction:"PT"},
    created_at:"2026-10-20T20:42:00Z"
  });
}

test("unofficial provenance and partial booking observations never create visible free slots",()=>{
  for(const provider of foundation.registry().map(item=>item.id)){
    const issued=connection(provider);
    const plan=foundation.authorizationPlan(issued);
    const status=foundation.availabilityStatus(issued);
    assert.equal(plan.external_request,false,provider);
    assert.equal(plan.scheduled_sync,false,provider);
    assert.equal(status.provider_authorized,false,provider);
    assert.equal(status.can_display_slots,false,provider);
    assert.deepEqual(status.slots,[],provider);

    // 00:30Z and 01:30Z are the two Europe/Lisbon 01:30 instants at fall DST.
    for(const observed_at of ["2026-10-25T00:30:00Z","2026-10-25T01:30:00Z"]){
      const receipt=foundation.inspectSyntheticObservation(issued,{
        kind:"booking_events",source_ref:"parallel-lane-booking-fixture",
        observed_at,fixture_records_count:1,
        records:[{court_ref:"partial-fixture-court",starts_at:observed_at}]
      });
      assert.equal(receipt.booking_events_are_availability,false,provider);
      assert.equal(receipt.can_display_availability,false,provider);
      assert.deepEqual(receipt.slots,[],provider);
      assert.equal(receipt.provider_read_occurred,false,provider);
    }
  }
});

test("fresh fixture TTL and rate cooldown remain simulation-only at both Lisbon DST boundaries",()=>{
  for(const [name,now,last] of [
    ["spring","2026-03-29T01:31:00Z","2026-03-29T01:30:30Z"],
    ["fall-first","2026-10-25T00:31:00Z","2026-10-25T00:30:30Z"],
    ["fall-second","2026-10-25T01:31:00Z","2026-10-25T01:30:30Z"]
  ]){
    const result=foundation.syntheticReadPreflight(connection(),{
      now,last_fixture_observed_at:last,fixture_ttl_ms:60000,
      last_attempt_at:new Date(Date.parse(now)-30000).toISOString(),min_interval_ms:60000
    });
    assert.equal(result.mode,"simulation_only",name);
    assert.equal(result.fixture_freshness,"fresh_fixture_only",name);
    assert.equal(result.rate_state,"cooldown",name);
    assert.equal(result.request_allowed,false,name);
    assert.equal(result.can_display_slots,false,name);
    assert.deepEqual(result.slots,[],name);
  }
});

test("the synthetic availability lane has no network or provider-write escape hatch",()=>{
  assert.doesNotMatch(source,/(?:\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|\/oauth\/|booking\.write)/i);
  assert.match(source,/OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED/);
  assert.match(source,/synthetic_read_only/);
});
