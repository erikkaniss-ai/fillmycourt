// Synthetic-only foundation contract. No provider OAuth, HTTP, credential,
// storage, availability, booking, payment or external account activity.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const foundation=require("../../getacourt/assets/provider-connection-foundation.js");
const source=readFileSync("getacourt/assets/provider-connection-foundation.js","utf8");
const input={
  provider:"playtomic",connection_ref:"synthetic-connection-1",
  consent:{subject_ref:"player-123",proof_ref:"consent-456",scope:"availability.read",
    granted_at:"2026-10-20T08:00:00Z",jurisdiction:"PT"},
  created_at:"2026-10-20T08:01:00Z"
};

test("Portugal P0 registry is explicit and cannot infer account linking or native writes",()=>{
  assert.equal(foundation.validateRegistry(),true);
  assert.deepEqual(foundation.registry().map(x=>x.id),[
    "playtomic","tiesports","racket_id","smashpro","native_manual"
  ]);
  for(const provider of foundation.registry()){
    assert.notEqual(provider.capabilities["availability.read"],"verified",provider.id);
    assert.equal(provider.capabilities.native_booking_authorized,"not_applicable",provider.id);
    assert.equal(foundation.canBeginDelegatedAuthorization(provider.id),false,provider.id);
  }
  const playtomic=foundation.registry().find(x=>x.id==="playtomic");
  assert.equal(playtomic.official_route,"club_or_certified_partner");
  assert.equal(playtomic.capabilities.account_link_supported,"unverified");
});

test("synthetic consent records provenance but never establishes provider authority",()=>{
  const connection=foundation.createSyntheticConnection(input);
  assert.equal(connection.mode,"synthetic_read_only");
  assert.equal(connection.status,"not_authorized");
  assert.equal(connection.token_state,"not_collected");
  assert.equal(connection.consent.scope,"availability.read");
  assert.equal(connection.audit.length,1);
  const plan=foundation.authorizationPlan(connection);
  assert.deepEqual(plan,{
    status:"blocked",reason:"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED",provider:"playtomic",
    required_capability:"availability.read",account_link_supported:"unverified",
    external_request:false,token_collection:false,scheduled_sync:false,provider_write:false
  });
});

test("foundation rejects credentials, non-proven consent, and any scope beyond read availability",()=>{
  assert.throws(()=>foundation.createSyntheticConnection({...input,accessToken:"never-accept"}),/credentials/);
  assert.throws(()=>foundation.createSyntheticConnection({...input,consent:{...input.consent,refreshToken:"never-accept"}}),/credentials/);
  assert.throws(()=>foundation.createSyntheticConnection({...input,consent:{...input.consent,scope:"booking.write"}}),/availability.read/);
  assert.throws(()=>foundation.createSyntheticConnection({...input,consent:{...input.consent,subject_ref:"player@example.test"}}),/opaque/);
});

test("disconnect leaves a local audit record without claiming external revocation",()=>{
  const disconnected=foundation.disconnect(foundation.createSyntheticConnection(input),"2026-10-20T08:02:00Z");
  assert.equal(disconnected.status,"disconnected");
  assert.equal(disconnected.external_revoke,false);
  assert.equal(disconnected.token_state,"not_collected");
  assert.deepEqual(disconnected.audit.map(x=>x.event),[
    "provider_connection.synthetic_created","provider_connection.synthetic_disconnected"
  ]);
});

test("foundation source contains no live transport, storage, OAuth, or provider write surface",()=>{
  assert.doesNotMatch(source,/(?:\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|localStorage|sessionStorage|\/oauth\/|client_secret|refresh_token|booking\.write)/i);
  assert.match(source,/OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED/);
  assert.match(source,/synthetic_read_only/);
});

test("synthetic foundation rejects credential aliases at every exposed entry point",()=>{
  assert.throws(()=>foundation.consent({...input.consent,api_key:"never-accept"}),/credentials/);
  assert.throws(()=>foundation.consent({...input.consent,Authorization:"Bearer never-accept"}),/credentials/);
  assert.throws(()=>foundation.createSyntheticConnection({...input,metadata:{headers:{"x-api-key":"never-accept"}}}),/credentials/);
  assert.throws(()=>foundation.createSyntheticConnection({...input,metadata:{refresh_token:"never-accept"}}),/credentials/);
});

test("issued connection guard rejects forged objects and invalid event chronology",()=>{
  const created=foundation.createSyntheticConnection(input);
  const forged={...created,provider:{...created.provider,capabilities:{account_link_supported:"verified"}}};
  assert.throws(()=>foundation.authorizationPlan(forged),/Issued synthetic connection/);
  assert.throws(()=>foundation.availabilityStatus(forged),/Issued synthetic connection/);
  assert.throws(()=>foundation.disconnect(forged,"2026-10-20T08:02:00Z"),/Issued synthetic connection/);
  assert.throws(()=>foundation.createSyntheticConnection({...input,created_at:"2026-10-20T07:59:00Z"}),/must not postdate/);
  assert.throws(()=>foundation.disconnect(created,"2026-10-20T08:00:59Z"),/must not predate/);
});

test("unverified provider availability always fails closed with zero visible slots",()=>{
  for(const provider of foundation.registry().map(x=>x.id)){
    const created=foundation.createSyntheticConnection({...input,provider});
    const result=foundation.availabilityStatus(created);
    assert.equal(result.status,"unknown",provider);
    assert.equal(result.freshness,"not_observed",provider);
    assert.equal(result.provider_authorized,false,provider);
    assert.equal(result.can_display_slots,false,provider);
    assert.deepEqual(result.slots,[],provider);
    assert.equal(result.reason,"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED",provider);
    assert.equal(Object.isFrozen(result.slots),true);
  }
});

test("issued synthetic connection freezes provider capabilities against mutation",()=>{
  const connection=foundation.createSyntheticConnection(input);
  assert.equal(Object.isFrozen(connection.provider),true);
  assert.equal(Object.isFrozen(connection.provider.capabilities),true);
  assert.throws(()=>{connection.provider.capabilities.account_link_supported="verified";},TypeError);
  assert.equal(foundation.authorizationPlan(connection).account_link_supported,"unverified");
});


test("synthetic provider read preflight models cooldown and freshness without a network route",()=>{
  const connection=foundation.createSyntheticConnection(input);
  const result=foundation.syntheticReadPreflight(connection,{
    now:"2026-10-20T08:03:00Z",last_attempt_at:"2026-10-20T08:02:30Z",
    min_interval_ms:60000,last_fixture_observed_at:"2026-10-20T08:00:00Z",
    fixture_ttl_ms:60000
  });
  assert.equal(result.mode,"simulation_only");
  assert.equal(result.status,"blocked");
  assert.equal(result.authorized,false);
  assert.equal(result.request_allowed,false);
  assert.equal(result.can_display_slots,false);
  assert.deepEqual(result.slots,[]);
  assert.equal(result.rate_state,"cooldown");
  assert.equal(result.next_eligible_simulation_at,"2026-10-20T08:03:30.000Z");
  assert.equal(result.fixture_freshness,"stale");
  assert.equal(result.reason,"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED");
});

test("synthetic read never upgrades a provider when rate simulation permits it",()=>{
  for(const provider of foundation.registry().map(x=>x.id)){
    const c=foundation.createSyntheticConnection({...input,provider});
    const result=foundation.syntheticReadPreflight(c,{
      now:"2026-10-20T09:01:00Z",last_attempt_at:"2026-10-20T08:00:00Z",
      last_fixture_observed_at:"2026-10-20T09:00:30Z",
      fixture_ttl_ms:60000
    });
    assert.equal(result.rate_state,"eligible_in_simulation",provider);
    assert.equal(result.fixture_freshness,"fresh_fixture_only",provider);
    assert.equal(result.request_allowed,false,provider);
    assert.equal(result.can_display_slots,false,provider);
  }
});

test("preflight rejects fake connections, forbidden credentials, clock skew and bypass intervals",()=>{
  const c=foundation.createSyntheticConnection(input);
  assert.throws(()=>foundation.syntheticReadPreflight({...c},{now:"2026-10-20T08:03:00Z"}),/Issued/);
  assert.throws(()=>foundation.syntheticReadPreflight(c,{now:"2026-10-20T08:03:00Z",api_key:"fake"}),/credentials/);
  assert.throws(()=>foundation.syntheticReadPreflight(c,{now:"2026-10-20T08:03:00Z",min_interval_ms:0}),/minimum interval/);
  assert.throws(()=>foundation.syntheticReadPreflight(c,{now:"2026-10-20T08:03:00Z",min_interval_ms:-1}),/minimum interval/);
  assert.throws(()=>foundation.syntheticReadPreflight(c,{now:"2026-10-20T08:03:00Z",last_attempt_at:"2026-10-20T08:04:00Z"}),/future/);
  assert.throws(()=>foundation.syntheticReadPreflight(c,{now:"2026-10-20T08:03:00Z",last_fixture_observed_at:"2026-10-20T08:04:00Z"}),/future/);
  assert.throws(()=>foundation.syntheticReadPreflight(c,{now:"bad"}),/timestamp/);
});


test("club bookings never imply free court inventory or player OAuth authority",()=>{
  for(const provider of foundation.registry().map(x=>x.id)){
    const c=foundation.createSyntheticConnection({...input,provider});
    const receipt=foundation.inspectSyntheticObservation(c,{
      kind:"booking_events",source_ref:"fixture-club-01",
      observed_at:"2026-10-20T08:05:00Z",fixture_records_count:12
    });
    assert.equal(receipt.status,"not_authorized",provider);
    assert.equal(receipt.kind,"booking_events",provider);
    assert.equal(receipt.fixture_records_count,12,provider);
    assert.equal(receipt.can_display_availability,false,provider);
    assert.equal(receipt.can_link_player_account,false,provider);
    assert.equal(receipt.booking_events_are_availability,false,provider);
    assert.equal(receipt.provider_read_occurred,false,provider);
    assert.deepEqual(receipt.slots,[],provider);
    assert.equal(Object.isFrozen(receipt),true);
  }
});

test("even a synthetic availability snapshot cannot activate real venue slots",()=>{
  const c=foundation.createSyntheticConnection(input);
  const receipt=foundation.inspectSyntheticObservation(c,{
    kind:"availability_snapshot",source_ref:"fixture-club-01",
    observed_at:"2026-10-20T08:05:00Z",fixture_records_count:8
  });
  assert.equal(receipt.status,"not_authorized");
  assert.equal(receipt.can_display_availability,false);
  assert.equal(receipt.provider_read_occurred,false);
  assert.deepEqual(receipt.slots,[]);
});

test("observation inspection rejects unissued sources, credentials, non-opaque provenance and missing timestamps",()=>{
  const c=foundation.createSyntheticConnection(input);
  for(const extra of [
    {kind:"booking_events",source_ref:"fixture-club-01",observed_at:"bad"},
    {kind:"booking_events",source_ref:"https://external.test",observed_at:"2026-10-20T08:05:00Z"},
    {kind:"booking_events",source_ref:"fixture-club-01",observed_at:"2026-10-20T08:05:00Z",fixture_records_count:-1},
    {kind:"booking_events",source_ref:"fixture-club-01",observed_at:"2026-10-20T08:05:00Z",api_key:"secret"},
    {kind:"booking_events",source_ref:"fixture-club-01",observed_at:"2026-10-20T08:05:00Z",access_token:"secret"}
  ]) assert.throws(()=>foundation.inspectSyntheticObservation(c,extra));
  assert.throws(()=>foundation.inspectSyntheticObservation({...c},{kind:"booking_events"}),/Issued/);
});
