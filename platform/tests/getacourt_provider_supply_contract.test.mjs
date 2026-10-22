// GetACourt Issue #11: player account != club supply. Pure fixture-only contracts.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const contract=require("../../getacourt/assets/provider-supply-contract.js");
const source=readFileSync("getacourt/assets/provider-supply-contract.js","utf8");

const player=()=>contract.planExternalAccount({
  provider:"playtomic",user_ref:"player-fixture-01",consent_ref:"consent-fixture-01",
  consented_at:"2026-10-21T10:00:00Z"
});
const club=()=>contract.planProviderSupply({
  provider:"tiesports",organization_ref:"org-fixture-a",club_ref:"club-fixture-a",
  research_ref:"provider-research-01",created_at:"2026-10-21T10:01:00Z"
});
const windowFor=()=>({
  requester_ref:"player-fixture-01",request_ref:"search-fixture-01",
  starts_at:"2026-10-25T00:30:00Z",ends_at:"2026-10-25T02:30:00Z",
  now:"2026-10-21T10:05:00Z"
});

test("player-linked identity and club-sponsored supply are different, branded frozen records",()=>{
  const p=player(),s=club();
  assert.equal(p.kind,"external_player_account");
  assert.equal(p.owner_type,"player");
  assert.equal(p.status,"not_connected");
  assert.equal(p.provider_authorized,false);
  assert.equal(p.token_vault_ref,null);
  assert.equal(p.provider_account_identifier,null);
  assert.equal(s.kind,"provider_supply_connection");
  assert.equal(s.owner_type,"club");
  assert.equal(s.status,"rights_unverified");
  assert.equal(s.provider_authorized,false);
  assert.equal(s.verified_inventory_scope,false);
  assert.equal(s.can_make_provider_requests,false);
  assert.equal(s.token_vault_ref,null);
  assert.ok(Object.isFrozen(p)&&Object.isFrozen(s));
  assert.notDeepEqual(p,s);
});

test("provider matrix includes MATCHi without granting availability or OAuth scope",()=>{
  const list=contract.registry();
  assert.deepEqual(list.map(x=>x.id),["playtomic","tiesports","matchi","racket_id","smashpro"]);
  for(const p of list){
    assert.equal(p.player_delegation,"unverified");
    assert.equal(p.available_inventory_license,"unverified");
    assert.equal(p.provider_booking_write,"not_authorized");
  }
  assert.equal(contract.slotFields().includes("starts_at"),true);
  for(const field of ["source","club","court","starts_at","timezone","price",
                       "booking_mode","last_verified_at","data_freshness","deeplink","entitlement"]){
    assert.ok(contract.slotFields().includes(field),field);
  }
});

test("searchAvailableSlots fails closed for every unapproved provider and both connection kinds",()=>{
  for(const p of contract.registry()){
    const conn=contract.planExternalAccount({
      provider:p.id,user_ref:"player-fixture-01",consent_ref:"consent-fixture-01",
      consented_at:"2026-10-21T10:00:00Z"
    });
    const result=contract.searchAvailableSlots(conn,windowFor());
    assert.equal(result.status,"unknown");
    assert.equal(result.reason,"PROVIDER_AVAILABILITY_RIGHTS_UNVERIFIED");
    assert.equal(result.authoritative,false);
    assert.equal(result.provider_requests,0);
    assert.equal(result.can_display_available_slots,false);
    assert.equal(result.booking_mode,"none");
    assert.equal(result.deeplink,null);
    assert.equal(result.last_verified_at,null);
    assert.equal(result.data_freshness,"unverified");
    assert.equal(result.entitlement,"unverified");
    assert.equal(result.price,null);
    assert.equal(result.timezone,null);
    assert.deepEqual(result.slots,[]);
    assert.equal(result.scope_type,"player");
    assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.slots));
  }
  const c=club();
  const q={...windowFor(),requester_ref:"operator-fixture-01",
    organization_ref:"org-fixture-a",club_ref:"club-fixture-a"};
  const result=contract.searchAvailableSlots(c,q);
  assert.equal(result.scope_type,"club");
  assert.equal(result.status,"unknown");
  assert.deepEqual(result.slots,[]);
  assert.equal(result.authoritative,false);
});

test("never upgrade club booking observations to player OAuth or free inventory",()=>{
  const c=club();
  const result=contract.searchAvailableSlots(c,{
    ...windowFor(),requester_ref:"operator-fixture-01",
    organization_ref:"org-fixture-a",club_ref:"club-fixture-a"
  });
  assert.equal(result.provider,"tiesports");
  assert.equal(result.provider_requests,0);
  assert.equal(result.can_display_available_slots,false);
  for(const override of [
    {booking_events:[{free:true}]},{slots:[{available:true}]},
    {availability_authorized:true},{licensed_supply:true},{owner_approved:true},
    {booking_mode:"native"},{deeplink:"https://example.test/booking"},
    {token_vault_ref:"vault-ref"}, {cookie:"secret"}, {access_token:"secret"},
    {headers:{authorization:"Bearer secret"}},{refreshToken:"secret"}
  ]){
    assert.throws(()=>contract.searchAvailableSlots(c,{
      ...windowFor(),requester_ref:"operator-fixture-01",
      organization_ref:"org-fixture-a",club_ref:"club-fixture-a",...override
    }),/Unsupported or sensitive/);
  }
});

test("forged or cross-tenant account and club inputs cannot be evaluated",()=>{
  const p=player(),c=club();
  assert.throws(()=>contract.searchAvailableSlots({...p},windowFor()),/Issued/);
  assert.throws(()=>contract.searchAvailableSlots({...c},{
    ...windowFor(),requester_ref:"operator-fixture-01",
    organization_ref:"org-fixture-a",club_ref:"club-fixture-a"
  }),/Issued/);
  assert.throws(()=>contract.searchAvailableSlots(p,{
    ...windowFor(),requester_ref:"different-player"
  }),/Scope mismatch/);
  for(const organization_ref of ["org-fixture-b",null]){
    assert.throws(()=>contract.searchAvailableSlots(c,{
      ...windowFor(),requester_ref:"operator-fixture-01",
      organization_ref,club_ref:"club-fixture-a"
    }),/Scope mismatch/);
  }
  assert.throws(()=>contract.searchAvailableSlots(c,{
    ...windowFor(),requester_ref:"operator-fixture-01",
    organization_ref:"org-fixture-a",club_ref:"club-fixture-b"
  }),/Scope mismatch/);
});

test("invalid timestamps, local-clock ambiguity, inverted dates and long windows deny",()=>{
  const p=player();
  for(const dates of [
    {starts_at:"2026-10-25T01:30:00",ends_at:"2026-10-25T02:00:00Z"},
    {starts_at:"2026-10-25T01:30:00+01:00"},
    {starts_at:"2026-10-25T02:30:00Z",ends_at:"2026-10-25T00:30:00Z"},
    {starts_at:"2026-10-25T00:30:00Z",ends_at:"2026-11-25T00:30:00Z"},
    {now:"2026-10-26T00:30:00Z"},
  ])assert.throws(()=>contract.searchAvailableSlots(p,{...windowFor(),...dates}));
  // Lisbon's repeated local 01:30 falls at distinct UTC instants.
  const first=contract.searchAvailableSlots(p,{...windowFor(),
    starts_at:"2026-10-25T00:30:00Z",ends_at:"2026-10-25T01:00:00Z"});
  const second=contract.searchAvailableSlots(p,{...windowFor(),
    starts_at:"2026-10-25T01:30:00Z",ends_at:"2026-10-25T02:00:00Z"});
  assert.notEqual(first.requested_window.starts_at,second.requested_window.starts_at);
  assert.deepEqual(first.slots,[]);
  assert.deepEqual(second.slots,[]);
});

test("connection inputs forbid impersonated rights, external identifiers, passwords and vault values",()=>{
  for(const invalid of [
    {authorized:true},{provider_scopes:["availability.read"]},
    {account_id:"external-user"},{email:"u@example.test"},
    {password:"fake"},{access_token:"fake"},{refresh_token:"fake"},
    {token_vault_ref:"fake"},{booking_handoff:"https://example.test"}
  ]){
    assert.throws(()=>contract.planExternalAccount({
      provider:"playtomic",user_ref:"player-fixture-01",consent_ref:"consent-fixture-01",
      consented_at:"2026-10-21T10:00:00Z",...invalid
    }),/Unsupported or sensitive/);
    assert.throws(()=>contract.planProviderSupply({
      provider:"playtomic",organization_ref:"org-fixture-a",club_ref:"club-fixture-a",
      research_ref:"provider-research-01",created_at:"2026-10-21T10:00:00Z",...invalid
    }),/Unsupported or sensitive/);
  }
});

test("pure candidate has no egress, bearer handling, persistent store or booking writes",()=>{
  assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|localStorage|sessionStorage/);
  assert.doesNotMatch(source,/\/oauth\/|\/api\/v1\/bookings|client_secret|refresh_token|booking\.write/i);
  assert.match(source,/PROVIDER_AVAILABILITY_RIGHTS_UNVERIFIED/);
});
