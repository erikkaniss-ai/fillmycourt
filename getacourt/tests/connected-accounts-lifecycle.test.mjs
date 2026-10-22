// Issue #11 fixture-only consent lifecycle. No external account authorization is granted.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const lifecycle=require("../qa/connected-accounts-lifecycle.js");
const source=readFileSync("getacourt/qa/connected-accounts-lifecycle.js","utf8");
const at=(minute)=>"2026-10-22T00:"+String(minute).padStart(2,"0")+":00Z";
const initial=()=>lifecycle.create({
  provider:"playtomic",owner_type:"player",owner_ref:"fixture-player-01",
  connection_ref:"fixture-connection-01",at:at(0)
});
const action=(name,minute,additional={})=>({action:name,at:at(minute),...additional});
function alwaysBlocked(s){
  const r=lifecycle.inspect(s);
  assert.equal(r.status,"not_connected");
  assert.equal(r.provider_authorized,false);
  assert.equal(r.can_start_oauth,false);
  assert.equal(r.may_contact_provider,false);
  assert.equal(r.can_display_available_slots,false);
  assert.equal(r.token_vault_ref,null);
  assert.equal(r.external_revoke_performed,false);
  assert.equal(r.can_make_booking,false);
  assert.equal(r.provider_calls,0);
  return r;
}

test("local fixture consent expiry withdrawal and reconnect never create provider rights",()=>{
  let s=initial();
  assert.equal(s.consent_state,"not_requested");
  assert.equal(s.epoch,0);alwaysBlocked(s);
  s=lifecycle.transition(s,action("note_demo_consent",1));
  assert.equal(s.consent_state,"noted");assert.equal(s.epoch,1);alwaysBlocked(s);
  s=lifecycle.transition(s,action("expire",2));
  assert.equal(s.consent_state,"expired");alwaysBlocked(s);
  s=lifecycle.transition(s,action("request_reconnect",3));
  assert.equal(s.consent_state,"reconnect_requested");alwaysBlocked(s);
  s=lifecycle.transition(s,action("withdraw",4));
  assert.equal(s.consent_state,"withdrawn");alwaysBlocked(s);
  // Explicit fresh demo consent is local only; it does not re-enable a provider.
  s=lifecycle.transition(s,action("note_demo_consent",5));
  assert.equal(s.consent_state,"noted");alwaysBlocked(s);
  assert.equal(s.epoch,5);
  assert.deepEqual(s.audit.map(x=>x.event),[
    "created","note_demo_consent","expire","request_reconnect",
    "withdraw","note_demo_consent"
  ]);
  assert.equal(Object.isFrozen(s.audit),true);
  assert.ok(s.audit.every(x=>Object.isFrozen(x)));
});

test("club supply cannot borrow player consent, expiration or reconnect semantics",()=>{
  const base=lifecycle.create({
    provider:"tiesports",owner_type:"club",owner_ref:"fixture-org-01",
    connection_ref:"fixture-club-conn-01",at:at(0)
  });
  for(const operation of ["note_demo_consent","expire","request_reconnect","withdraw"])
    assert.throws(()=>lifecycle.transition(base,action(operation,1)),/Player-only/);
  assert.equal(base.consent_state,"not_applicable");alwaysBlocked(base);
});

test("switching provider or owner invalidates preceding scope and resets all demo consent",()=>{
  const before=lifecycle.transition(initial(),action("note_demo_consent",1));
  const changed=lifecycle.transition(before,action("switch_scope",2,{
    provider:"matchi",owner_type:"club",owner_ref:"fixture-org-02"
  }));
  assert.equal(changed.epoch,2);
  assert.equal(changed.provider,"matchi");assert.equal(changed.owner_type,"club");
  assert.equal(changed.owner_ref,"fixture-org-02");
  assert.equal(changed.consent_state,"not_applicable");
  alwaysBlocked(changed);
  const back=lifecycle.transition(changed,action("switch_scope",3,{
    provider:"playtomic",owner_type:"player",owner_ref:"fixture-player-01"
  }));
  assert.equal(back.consent_state,"not_requested");
  assert.equal(back.epoch,3);alwaysBlocked(back);
});

test("late/fake provider replies are rejected even if they declare success",()=>{
  const original=initial();
  const advanced=lifecycle.transition(original,action("switch_scope",1,{
    provider:"tiesports",owner_type:"player",owner_ref:"fixture-player-01"
  }));
  const snapshot=lifecycle.capture(original,"fixture-request-01");
  assert.deepEqual(lifecycle.inspectLateReply(advanced,snapshot,{
    provider:"playtomic",request_ref:"fixture-request-01",epoch:0,
    outcome:"provider_connected"
  }),{accepted:false,reason:"STALE_SCOPE_OR_EPOCH",provider_authorized:false});
  assert.deepEqual(lifecycle.inspectLateReply(original,snapshot,{
    provider:"playtomic",request_ref:"fixture-request-01",epoch:0,
    outcome:"provider_connected"
  }),{accepted:false,reason:"PROVIDER_AUTHORIZATION_UNVERIFIED",provider_authorized:false});
  assert.deepEqual(lifecycle.inspectLateReply(original,snapshot,{
    provider:"playtomic",request_ref:"fixture-request-01",epoch:0,
    outcome:"available_slots"
  }),{accepted:false,reason:"PROVIDER_AUTHORIZATION_UNVERIFIED",provider_authorized:false});
  assert.throws(()=>lifecycle.inspectLateReply(original,snapshot,{
    provider:"playtomic",request_ref:"fixture-request-01",epoch:0,
    token:"secret"
  }),/Unsupported or sensitive/);
});

test("invalid transitions, chronology, fake issued sessions and injected scopes fail closed",()=>{
  const s=initial();
  assert.throws(()=>lifecycle.transition({...s},action("note_demo_consent",1)),/Issued/);
  for(const input of [
    action("expire",1),action("request_reconnect",1),
    action("withdraw",1),action("connected",1),
    action("note_demo_consent",1,{provider_authorized:true}),
    action("note_demo_consent",1,{access_token:"fixture"}),
    action("note_demo_consent",1,{token_vault_ref:"fake"}),
    action("note_demo_consent",1,{booking_mode:"native"}),
    action("note_demo_consent",1,{at:at(0).replace("Z","")}),
    action("note_demo_consent",1,{at:"2026-10-21T23:59:00Z"})
  ])assert.throws(()=>lifecycle.transition(s,input));
  assert.throws(()=>lifecycle.create({
    provider:"playtomic",owner_type:"player",owner_ref:"fixture-player-01",
    connection_ref:"fixture-connection-01",at:at(0),provider_authorized:true
  }),/Unsupported or sensitive/);
  assert.throws(()=>lifecycle.create({
    provider:"playtomic",owner_type:"player",owner_ref:"fixture-player-01",
    connection_ref:"fixture-connection-01",at:"2026-10-25T01:30:00"
  }),/UTC/);
});

test("no live transport, oauth, network, storage, third-party sessions or token parsing",()=>{
  for(const forbidden of [
    /\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/\bsendBeacon\s*\(/,
    /\blocalStorage\b/,/\bsessionStorage\b/,/\bindexedDB\b/,
    /\bdocument\.cookie\b/,/\bpostMessage\s*\(/,
    /\/auth\/v1\//,/\/api\//,/https?:\/\//
  ])assert.doesNotMatch(source,forbidden);
  assert.match(source,/PROVIDER_AUTHORIZATION_UNVERIFIED/);
  assert.match(source,/STALE_SCOPE_OR_EPOCH/);
});
