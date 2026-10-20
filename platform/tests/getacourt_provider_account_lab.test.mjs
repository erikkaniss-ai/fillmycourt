// Player-account test lab: synthetic only; never calls provider or stores credentials.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const lab=require("../../getacourt/assets/provider-account-test-lab.js");
const source=readFileSync("getacourt/assets/provider-account-test-lab.js","utf8");
const plan={
  provider:"playtomic",participant_ref:"internal-player-1",consent_ref:"owner-consent-1",
  test_ref:"owner-qa-001",consented_at:"2026-10-20T14:50:00Z",
  owner_permitted_personal_testing:true
};
test("Playtomic and TiePlayer personal-account lab is explicitly authorization-pending",()=>{
  assert.deepEqual(lab.supportedProviders().map(p=>p.id),["playtomic","tiesports"]);
  for(const provider of lab.supportedProviders()){
    assert.equal(provider.player_delegated_oauth,"unverified");
    assert.equal(provider.availability_read,"unverified");
    assert.equal(provider.clubs_api_is_player_auth,false);
    const testPlan=lab.createPersonalTestPlan({...plan,provider:provider.id});
    assert.equal(testPlan.status,"awaiting_official_provider_authorization");
    assert.equal(testPlan.user_consented,true);
    assert.equal(testPlan.provider_authorized,false);
    assert.equal(testPlan.can_start_oauth,false);
    assert.equal(testPlan.can_retrieve_account_data,false);
    assert.equal(testPlan.can_show_live_slots,false);
    assert.equal(testPlan.external_calls,0);
    assert.equal(testPlan.credentials_collected,false);
    assert.deepEqual(testPlan.allowed_activity,["owner_sign_in_directly_in_official_app"]);
    assert.equal(Object.isFrozen(testPlan),true);
  }
});

test("personal account consent is distinct from official provider API authority",()=>{
  const p=lab.createPersonalTestPlan(plan);
  const check=lab.evaluateReadiness(p);
  assert.equal(check.state,"blocked");
  assert.equal(check.reason,"PROVIDER_PLAYER_DELEGATION_UNVERIFIED");
  assert.equal(check.requires_provider_contract,true);
  assert.equal(check.owner_consented,true);
  assert.equal(check.may_open_provider_oauth_redirect,false);
  assert.equal(check.may_observe_private_session,false);
  assert.equal(check.may_call_undocumented_api,false);
});

test("cannot submit identity, credentials, cookies, arbitrary consent or external redirect",()=>{
  for(const extra of [
    {password:"secret"},{refresh_token:"secret"},{authorization:"Bearer abc"},
    {cookie:"session=xyz"},{email:"test@example.test"},{phone:"+123"},
    {account_id:"user"},
    {headers:{"x-api-key":"secret"}},
    {redirect_uri:"https://example.test/steal"},
    {api_authorized:true},{provider_oauth_verified:true}
  ])assert.throws(()=>lab.createPersonalTestPlan({...plan,...extra}),/Unsupported or sensitive/);
  assert.throws(()=>lab.createPersonalTestPlan({...plan,participant_ref:"test@example.test"}),/opaque/i);
  assert.throws(()=>lab.createPersonalTestPlan({...plan,owner_permitted_personal_testing:false}),/owner consent/);
  assert.throws(()=>lab.createPersonalTestPlan({...plan,provider:"unknown"}),/Unknown provider/);
});

test("user consent can be withdrawn without claiming provider-side revocation",()=>{
  const p=lab.createPersonalTestPlan(plan);
  const closed=lab.withdrawPersonalTestConsent(p,"2026-10-20T15:00:00Z");
  assert.equal(closed.status,"user_consent_withdrawn");
  assert.equal(closed.provider_authorized,false);
  assert.equal(closed.external_revoke_performed,false);
  assert.equal(closed.can_retrieve_account_data,false);
  assert.equal(lab.evaluateReadiness(closed).state,"blocked");
  assert.throws(()=>lab.withdrawPersonalTestConsent({...p},"2026-10-20T15:00:00Z"),/Issued test plan/);
  assert.throws(()=>lab.withdrawPersonalTestConsent(p,"2026-10-20T14:00:00Z"),/chronology/);
});

test("transport-free lab includes no live provider endpoint, credential store or auth route",()=>{
  assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|client_secret|\/oauth\/token|authorization_code|POST /i);
  assert.match(source,/PROVIDER_PLAYER_DELEGATION_UNVERIFIED/);
  assert.match(source,/owner_sign_in_directly_in_official_app/);
});
