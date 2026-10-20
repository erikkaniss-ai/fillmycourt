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
