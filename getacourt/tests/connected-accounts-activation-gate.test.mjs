// Issue #11: high-risk provider rights declarations are NEVER authorization.
// Read-only fixture test: no secrets, provider calls, DB or deployment.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  inspectReadiness,listRequiredEvidence,planVaultAdapter,GATES,MODES
} from "../qa/connected-accounts-activation-gate.mjs";
const SHA="a".repeat(40),NOW="2026-10-22T10:15:00Z";
function manifest(lane="external_club_supply",provider="playtomic",evidence={}){
  const club=lane!=="external_player_account";
  return {
    schema_version:1,lane,provider,
    owner_ref:club?"org-fixture-01":"player-fixture-01",
    ...(club?{organization_ref:"org-fixture-01",club_ref:"club-fixture-01"}:{}),
    candidate_sha:SHA,observed_at:"2026-10-22T08:00:00Z",
    expires_at:"2026-10-23T08:00:00Z",evidence
  };
}
function allRefs(lane){return Object.fromEntries(listRequiredEvidence(lane).map((x,i)=>[x,"fixture-evidence-"+i]));}
function untrusted(m) {return inspectReadiness(m,{now:NOW});}
function assertNoRights(r){
  assert.equal(r.evidence_reviewed,false);
  assert.equal(r.authority_verified,false);
  assert.equal(r.licensed_inventory_verified,false);
  assert.equal(r.consent_verified,false);
  for(const k of [
    "may_create_account","may_authenticate_provider","may_access_token_vault",
    "may_fetch_provider","may_publish_slots","may_redistribute_price",
    "may_confirm_booking","execution_enabled"
  ]) assert.equal(r[k],false,k);
  assert.match(r.reason,/DECLARATIONS_ARE_NOT_VERIFIED_PROVIDER_RIGHTS/);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.missing_evidence));
}

test("all evidence declared is still manual original-evidence review, never GO",()=>{
  for(const lane of Object.keys(GATES)){
    const provider=lane==="club_native"?"native":"playtomic";
    const r=untrusted(manifest(lane,provider,allRefs(lane)));
    assert.equal(r.status,"DECLARED_READY_FOR_ORIGINAL_EVIDENCE_REVIEW");
    assert.equal(r.missing_evidence.length,0);
    assert.equal(r.declared_items,r.required_items);
    assert.equal(r.next_stage,"INDEPENDENT_ORIGINAL_EVIDENCE_AND_LEGAL_REVIEW");
    assertNoRights(r);
  }
});
test("every single missing field in each lane blocks, including native supply",()=>{
  for(const lane of Object.keys(GATES)){
    const full=allRefs(lane),provider=lane==="club_native"?"native":"tiesports";
    for(const field of listRequiredEvidence(lane)){
      const evidence={...full};delete evidence[field];
      const r=untrusted(manifest(lane,provider,evidence));
      assert.equal(r.status,"BLOCKED",field);
      assert.deepEqual(r.missing_evidence,[field]);
      assertNoRights(r);
    }
  }
});
test("club-owned Core path avoids external provider dependency but does not self-approve native slots",()=>{
  const r=untrusted(manifest("club_native","native",allRefs("club_native")));
  assert.equal(r.lane,"club_native");
  assert.ok(MODES.club_native.includes("Core"));
  assertNoRights(r);
  assert.deepEqual(listRequiredEvidence("club_native").includes("provider_contract"),false);
});
test("provider's bookings.read alone cannot pass licensed supply requirements",()=>{
  const r=untrusted(manifest("external_club_supply","playtomic",{
    signed_club_distribution_right:"fixture-club-contract",
    provider_contract:"fixture-bookings-only-contract"
  }));
  for(const key of ["provider_availability_scope","provider_price_scope",
                    "provider_redistribution_license","named_court_coverage",
                    "server_vault_design","provider_revocation_procedure"])
    assert.ok(r.missing_evidence.includes(key),key);
  assertNoRights(r);
});
test("player OAuth consent cannot substitute club supply or price/distribution license",()=>{
  const p=untrusted(manifest("external_player_account","matchi",{
    exact_user_consent:"fixture-consent"
  }));
  assert.equal(p.lane,"external_player_account");
  assert.equal(p.status,"BLOCKED");
  assert.ok(p.missing_evidence.includes("documented_player_delegation"));
  assert.ok(p.missing_evidence.includes("provider_redistribution_license"));
  assertNoRights(p);
  assert.throws(()=>untrusted(manifest("external_club_supply","native",{})),/INVALID_PROVIDER_LANE/);
  assert.throws(()=>untrusted(manifest("club_native","playtomic",{})),/INVALID_PROVIDER_LANE/);
});
test("reject cross-tenant, personal account in club lane, unaudited extra fields",()=>{
  const c=manifest();
  for(const modify of [
    x=>x.owner_ref="player-fixture-01",
    x=>x.organization_ref="org-foreign",
    x=>x.club_ref="",
    x=>x.owner_ref="player@example.test",
    x=>x.access_token="never-accepted",
    x=>x.service_role="forbidden",
    x=>x.provider_scopes=["availability.read"],
    x=>x.declared_scope_verified=true,
    x=>x.evidence={provider_contract:"fixture-contract",client_secret:"secret"},
    x=>x.evidence={provider_contract:"https://evil.invalid"},
    x=>x.evidence={provider_contract:{ref:"fixture"}},
  ]){const x=structuredClone(c);modify(x);assert.throws(()=>untrusted(x));}
  const player=manifest("external_player_account");
  assert.throws(()=>untrusted({...player,club_ref:"club-foreign"}),/CROSS_OWNER_SCOPE/);
  assert.throws(()=>untrusted({...player,organization_ref:"org-foreign"}),/CROSS_OWNER_SCOPE/);
});
test("fail-closed for missing/stale/future/ambiguous data and extended approvals",()=>{
  const b=manifest();
  for(const mutate of [
    x=>x.schema_version=2,
    x=>x.provider="unknown",
    x=>x.lane="provider_write",
    x=>x.candidate_sha="short",
    x=>x.observed_at="2026-10-22T11:00:00Z",
    x=>x.observed_at="2026-10-25T01:30:00", // Lisbon DST ambiguous
    x=>x.expires_at="2026-10-22T09:00:00Z",
    x=>x.expires_at="2026-12-01T09:00:00Z",
    x=>x.expires_at="2026-10-22T07:00:00Z",
    x=>x.evidence=null
  ]){const x=structuredClone(b);mutate(x);assert.throws(()=>untrusted(x));}
  for(const fake of ["2026-10-25T01:30:00","2030-02-30T00:00:00Z","2026-10-22T10:00:00+01:00"])
    assert.throws(()=>inspectReadiness(b,{now:fake}));
  assert.throws(()=>inspectReadiness(b),/INVALID_UTC_INSTANT/);
});
test("listRequiredEvidence is fixed, read-only and rejects unknown lanes",()=>{
  assert.deepEqual(Object.keys(GATES),["club_native","external_club_supply","external_player_account"]);
  assert.notDeepEqual([...GATES.club_native],[...GATES.external_club_supply]);
  for(const lane of Object.keys(GATES)){
    const a=listRequiredEvidence(lane);
    assert.ok(Object.isFrozen(a));
    assert.throws(()=>a.push("bogus"),TypeError);
  }
  assert.throws(()=>listRequiredEvidence("__proto__"),/INVALID_LANE/);
});
test("vault architecture returns no tokens, clients, secrets or active workers",()=>{
  for(const mode of ["club_credentials","delegated_refresh_token"]){
    const result=planVaultAdapter({mode});
    assert.equal(result.mode,mode);
    assert.equal(result.storage,"UNCONFIGURED");
    assert.equal(result.key_management,"UNCONFIGURED");
    assert.equal(result.encrypted_material_present,false);
    assert.equal(result.vault_handle,null);
    assert.equal(result.client_side_access,false);
    assert.equal(result.transport_enabled,false);
    assert.equal(result.rotation_enabled,false);
    assert.equal(result.require_independent_admin_review,true);
    assert.ok(Object.isFrozen(result.candidate_backends));
  }
  for(const input of [{mode:"club_credentials",token:"sensitive"},
                      {mode:"club_credentials",decrypt:true},
                      {mode:"fake"},{mode:null},null]){
    assert.throws(()=>planVaultAdapter(input));
  }
});
test("source contains no transport, live provider API, auth or storage operation",()=>{
  const s=readFileSync("getacourt/qa/connected-accounts-activation-gate.mjs","utf8");
  for(const pattern of [
    /\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/\bsendBeacon\s*\(/,
    /\blocalStorage\b/,/\bsessionStorage\b/,/\bindexedDB\b/,
    /\bfs\.writeFile\b/,/\bprocess\.env\b/,/\/auth\/v1\//,
    /\bnetlify deploy\b/,/client_secret\s*=/,/authorization\s*:/i
  ])assert.doesNotMatch(s,pattern);
});
