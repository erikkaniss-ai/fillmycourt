import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceEvidence, CANDIDATE, HELPER_HASH, copyDto, validateBinding, HISTORICAL_COUNT, MAX_KNOWN_COUNT } from '../scripts/fill_uat_evidence_verdict.mjs';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2030-01-01T00:00:00Z'), at = seconds => new Date(T0 + seconds * 1000).toISOString();
function fixture() {
  const b = { run_id: id(9000), authorization_id: id(9001), candidate_sha: CANDIDATE, helper_sha256: HELPER_HASH,
    t0: at(0), identities: { canary: id(9010), a: id(9011), b: id(9012) }, historical_ids: Array.from({ length: 17 }, (_, i) => id(9100 + i)),
    pins: { operations_service_id: 'c0c6e5e2-0040-48e0-a0af-abfb1ec81b61', operations_sha: CANDIDATE,
      core_service_id: 'fc97f78f-d39e-4598-a615-b2413b9b3f76', core_sha: '0134f603445ea7f282ef0cb866d0f3591518cbb9',
      preview_site_id: 'd763b7a1-dccd-4638-8876-ac1670171698', preview_sha: CANDIDATE, supabase_project_ref: 'yclqnbcrchwieyzkyumx' } };
  const obs = (label, route, status, denied, age) => ({ label, user_id: b.identities[label], route, status, verified: true, denied, at: at(age) });
  const authority = { binding: b, owner_go_verified: true, consumed: false, max_new_accounts: 3, issued_at: at(-1), expires_at: at(1800), public_go: false };
  const evidence = { binding: b, authority,
    budget: { binding: b, source: 'guard_readback', independent: true, known_created_ids: Object.values(b.identities), unknown_create_count: 0,
      active_count: 0, pending_activation_count: 0, unresolved_nonce_count: 0, at: at(140) },
    canary: { binding: b, positive: [obs('canary', 'login', 200, false, 60), obs('canary', 'own_today', 200, false, 61), obs('canary', 'foreign_today', 403, true, 62)],
      ban: { source: 'guard_readback', independent: true, user_id: b.identities.canary, banned: true, at: at(125), readback_at: at(126) },
      retained_denial: obs('canary', 'me', 401, true, 130), auth_denial: obs('canary', 'denied_login', 400, true, 131), auth_user_banned_verified: true },
    independent: { binding: b, source: 'cto_checkpoint', decision: 'pass', lease_digest: 'f'.repeat(64), evidence_ref: 'https://github.com/erikkaniss-ai/fillmycourt/pull/8#issuecomment-1', at: at(190), expires_at: at(600) },
    operators: Object.fromEntries(['a', 'b'].map((label, i) => [label, { binding: b, observations: [
      ['login', 200, false], ['me', 200, false], ['organizations', 200, false], ['own_today', 200, false], ['foreign_today', 403, true],
      ['own_calendar', 200, false], ['foreign_calendar', 403, true], ['provider_connections', label === 'b' ? 403 : 200, label === 'b'],
    ].map(([route, status, denied], j) => obs(label, route, status, denied, 200 + i * 20 + j)) }])),
    cleanup: { binding: b, source: 'guard_readback', independent: true, known_banned_ids: Object.values(b.identities), historical_banned_ids: b.historical_ids,
      unknown_create_count: 0, active_count: 0, pending_activation_count: 0, unresolved_nonce_count: 0, at: at(1300) } };
  return { b: structuredClone(b), e: JSON.parse(JSON.stringify(evidence)) };
}
const evaluate = (f, seconds = 1400, trustedInput = true) => reduceEvidence(f.b, f.e, { at: at(seconds), trustedInput });

test('exact17 historical +3 new binding: reject old13/16/18, duplicates and reused old identity', () => {
  assert.equal(HISTORICAL_COUNT,17); assert.equal(MAX_KNOWN_COUNT,20);
  const f=fixture(); assert.equal(validateBinding(f.b).historical_ids.length,17);
  for(const count of [13,16,18]) {const b=structuredClone(f.b);b.historical_ids=Array.from({length:count},(_,i)=>id(9100+i));assert.throws(()=>validateBinding(b));}
  for(const mutate of [b=>{b.historical_ids[16]=b.historical_ids[0];},b=>{b.identities.a=b.historical_ids[16];},b=>{b.identities.b=b.identities.a;}]) {const b=structuredClone(f.b);mutate(b);assert.throws(()=>validateBinding(b));}
  f.e.cleanup.historical_banned_ids.pop();assert.equal(evaluate(f).cleanup,'FAIL');
});
test('failed4c and B11 c84 run/actual human authority are permanently consumed independently', () => {
  for(const [kind,value] of [['run','4c0cdb3b-c138-479b-9b69-fef96420642b'],['authority','01a1958f-5bc5-7382-822d-27d4db023a3e'],['run','c84ce71e-da5d-4d35-80b8-03df361e90a4'],['authority','01a195d0-a2d3-7492-ada1-13093bfac556']]) {const f=fixture();
    const encoded=JSON.stringify(f).replaceAll(kind==='run'?id(9000):id(9001),value),r=evaluate(JSON.parse(encoded));assert.equal(r.functionality,'FAIL');assert.ok(r.reasons.includes('CONSUMED_AUTHORITY'));assert.equal(r.operatorEligible,false);}
});

test('complete explicitly trusted synthetic DTO yields separate PASS results, never owner GO', () => {
  const r = evaluate(fixture());
  assert.equal(r.canary, 'PASS'); assert.equal(r.functionality, 'PASS'); assert.equal(r.cleanup, 'PASS'); assert.equal(r.f1, 'PASS');
  assert.equal(r.operatorEligible, false); assert.equal(r.grantsOwnerGo, false); assert.equal(r.trustedInputRequired, true);
  assert.equal(r.cleanupLate, false); assert.ok(Object.isFrozen(r.reasons));
});
test('untrusted/missing independent data cannot self-authorize operators', () => {
  const f = fixture(); f.e.operators = null; f.e.cleanup = null;
  assert.equal(evaluate(f, 190, false).operatorEligible, false);
  assert.equal(evaluate(f, 190, false).canary, 'UNKNOWN');
  assert.equal(evaluate(f, 190).operatorEligible, true);
  f.e.independent = null; const r = evaluate(f, 190);
  assert.equal(r.canary, 'PASS'); assert.equal(r.operatorEligible, false); assert.equal(r.f1, 'UNKNOWN');
});
test('only a current independent lease after original canary window enables operator eligibility', () => {
  const f = fixture(); f.e.operators = null; f.e.cleanup = null;
  assert.equal(evaluate(f, 189).operatorEligible, false);
  assert.equal(evaluate(f, 190).operatorEligible, true);
  assert.equal(evaluate(f, 599).operatorEligible, true);
  assert.equal(evaluate(f, 600).operatorEligible, false);
  for (const mutate of [f => { f.e.independent.decision = 'fail'; }, f => { f.e.independent.source = 'helper'; },
    f => { f.e.independent.at = at(179); }, f => { f.e.independent.evidence_ref = 'https://synthetic.invalid'; },
    f => { f.e.independent.lease_digest = 'wrong'; }, f => { f.e.independent.binding.run_id = id(999); }]) {
    const x = structuredClone(f); mutate(x); assert.equal(evaluate(x, 190).operatorEligible, false);
  }
});
test('binding mismatches cannot pass functionality; independently scoped cleanup can remain PASS', () => {
  for (const mutate of [e => { e.binding.run_id = id(99); }, e => { e.binding.authorization_id = id(98); },
    e => { e.binding.candidate_sha = '0'.repeat(40); }, e => { e.binding.helper_sha256 = '0'.repeat(64); },
    e => { e.binding.pins.operations_sha = '0'.repeat(40); }, e => { e.binding.t0 = at(1); },
    e => { e.binding.identities.a = id(97); }]) {
    const f = fixture(); mutate(f.e); const r = evaluate(f);
    assert.equal(r.functionality, 'FAIL'); assert.equal(r.operatorEligible, false); assert.equal(r.cleanup, 'PASS');
  }
});
test('wrong observation identities, status or verification never enable operators', () => {
  for (const mutate of [e => { e.canary.positive[0].user_id = id(3); }, e => { e.canary.positive[1].status = 401; },
    e => { e.canary.positive[2].denied = false; }, e => { e.canary.positive[0].verified = false; },
    e => { e.canary.retained_denial.user_id = id(4); }, e => { e.canary.auth_denial.user_id = id(5); }]) {
    const f = fixture(); mutate(f.e); const r = evaluate(f);
    assert.equal(r.canary, 'FAIL'); assert.equal(r.operatorEligible, false); assert.equal(r.cleanup, 'PASS');
  }
});
test('HTTP400/401 alone is insufficient: independently verified user_banned semantics required', () => {
  for (const status of [400, 401, 403]) {
    const f = fixture(); f.e.canary.auth_denial.status = status; assert.equal(evaluate(f).canary, 'PASS');
    f.e.canary.auth_user_banned_verified = false; assert.equal(evaluate(f).canary, 'FAIL');
  }
  for (const status of [200, 429, 503]) { const f = fixture(); f.e.canary.auth_denial.status = status; assert.equal(evaluate(f).canary, 'FAIL'); }
});
test('canary ban/readback and negative observations must meet original3min; no renewed T0', () => {
  for (const mutate of [e => { e.canary.ban.at = at(180); e.canary.ban.readback_at = at(181); },
    e => { e.canary.ban.readback_at = at(180); }, e => { e.canary.auth_denial.at = at(180); },
    e => { e.canary.retained_denial.at = at(119); }, e => { e.canary.ban.independent = false; }, e => { e.canary.ban.banned = false; }]) {
    const f = fixture(); mutate(f.e); const r = evaluate(f); assert.equal(r.canary, 'FAIL'); assert.equal(r.operatorEligible, false);
  }
});
test('missing canary/budget proof keeps cleanup independent and functionality UNKNOWN', () => {
  for (const key of ['canary', 'budget']) {
    for (const remove of [true, false]) {
      const f = fixture(); if (remove) delete f.e[key]; else f.e[key] = null;
      const r = evaluate(f); assert.equal(r.functionality, 'UNKNOWN'); assert.equal(r.cleanup, 'PASS'); assert.equal(r.f1, 'UNKNOWN'); assert.equal(r.operatorEligible, false);
    }
  }
  const f = fixture(); f.e.canary.positive = []; const r = evaluate(f);
  assert.equal(r.functionality, 'UNKNOWN'); assert.equal(r.cleanup, 'PASS');
});
test('consumed/rejected authority never suppresses canonical cleanup confirmation', () => {
  for (const mutate of [e => { e.authority.consumed = true; }, e => { e.authority.owner_go_verified = false; },
    e => { e.authority.max_new_accounts = 4; }, e => { e.authority.expires_at = at(1900); }]) {
    const f = fixture(); mutate(f.e); const r = evaluate(f);
    assert.equal(r.functionality, 'FAIL'); assert.equal(r.f1, 'FAIL'); assert.equal(r.operatorEligible, false); assert.equal(r.cleanup, 'PASS');
  }
});
test('all exact account budget/nonce/activation evidence must be settled before operators', () => {
  for (const key of ['unknown_create_count', 'active_count', 'pending_activation_count', 'unresolved_nonce_count']) {
    const f = fixture(); f.e.budget[key] = 1; assert.equal(evaluate(f).operatorEligible, false); assert.equal(evaluate(f).canary, 'FAIL');
  }
  const f = fixture(); f.e.budget.known_created_ids.push(id(999)); assert.equal(evaluate(f).canary, 'FAIL');
});
test('both operators require login/own Today+Calendar/foreign denies/provenance', () => {
  for (const label of ['a', 'b']) {
    for (const index of [0, 3, 4, 5, 6, 7]) {
      const f = fixture(); f.e.operators[label].observations[index].verified = false;
      const r = evaluate(f); assert.equal(r.functionality, 'FAIL'); assert.equal(r.cleanup, 'PASS'); assert.equal(r.f1, 'FAIL');
    }
    const f = fixture(); f.e.operators[label].observations.pop(); assert.equal(evaluate(f).functionality, 'UNKNOWN');
  }
});
test('operator identity/lease/window errors fail functionality without changing verified cleanup', () => {
  for (const mutate of [e => { e.operators.a.observations[0].user_id = id(22); },
    e => { e.operators.a.observations.forEach(o => { o.at = at(600); }); },
    e => { e.operators.b.observations.at(-1).at = at(1200); }, e => { e.operators.a.binding.helper_sha256 = '0'.repeat(64); }]) {
    const f = fixture(); mutate(f.e); const r = evaluate(f); assert.equal(r.functionality, 'FAIL'); assert.equal(r.cleanup, 'PASS'); assert.equal(r.operatorEligible, false);
  }
});
test('cleanup requires all known and historical17 banned, unknown0/current activation0', () => {
  for (const mutate of [e => { e.cleanup.known_banned_ids.pop(); }, e => { e.cleanup.historical_banned_ids.pop(); },
    e => { e.cleanup.historical_banned_ids[0] = id(999); }, e => { e.cleanup.unknown_create_count = 1; },
    e => { e.cleanup.active_count = 1; }, e => { e.cleanup.pending_activation_count = 1; }, e => { e.cleanup.unresolved_nonce_count = 1; },
    e => { e.cleanup.independent = false; }, e => { e.cleanup.binding.run_id = id(1); }]) {
    const f = fixture(); mutate(f.e); const r = evaluate(f); assert.equal(r.functionality, 'PASS'); assert.equal(r.cleanup, 'FAIL'); assert.equal(r.f1, 'FAIL');
  }
});
test('late eventual cleanup PASS is distinct from immutable deadline FAIL and never renews eligibility', () => {
  for (const seconds of [1800, 1900, 3600]) {
    const f = fixture(); f.e.cleanup.at = at(seconds);
    const r = evaluate(f, seconds + 1);
    assert.equal(r.functionality, 'PASS'); assert.equal(r.cleanup, 'PASS'); assert.equal(r.cleanupLate, true);
    assert.equal(r.deadlineBreached, true); assert.equal(r.f1, 'FAIL'); assert.equal(r.operatorEligible, false);
    assert.ok(r.reasons.includes('CLEANUP_AFTER_ORIGINAL_DEADLINE')); assert.equal(r.grantsOwnerGo, false);
  }
  const f = fixture(); f.e.canary = null; f.e.authority.consumed = true; f.e.cleanup.at = at(1900);
  const r = evaluate(f, 2000); assert.equal(r.cleanup, 'PASS'); assert.equal(r.cleanupLate, true); assert.equal(r.functionality, 'FAIL');
});
test('review after expiry does not itself make an on-time cleanup late; future readback is rejected', () => {
  const f = fixture(); const r = evaluate(f, 4000); assert.equal(r.cleanup, 'PASS'); assert.equal(r.cleanupLate, false); assert.equal(r.f1, 'PASS');
  f.e.cleanup.at = at(4001); assert.equal(evaluate(f, 4000).cleanup, 'FAIL');
});
test('earlier authority expiry still permits eventual independent cleanup, with deadline violation retained', () => {
  const f = fixture(); f.e.authority.expires_at = at(1000);
  const r = evaluate(f, 1400); assert.equal(r.cleanup, 'PASS'); assert.equal(r.cleanupLate, true); assert.equal(r.f1, 'FAIL'); assert.equal(r.operatorEligible, false);
});
test('DTOs reject accessors/toJSON/prototypes/raw duplicate JSON and never reflect unknown fields', () => {
  let executed = false; const x = {}; Object.defineProperty(x, 'password', { enumerable: true, get() { executed = true; return 'SYNTHETIC_NEGATIVE'; } });
  assert.throws(() => copyDto(x)); assert.equal(executed, false);
  assert.throws(() => copyDto({ toJSON() { executed = true; } })); assert.equal(executed, false);
  const f = fixture(); f.e.password = 'SYNTHETIC_NEGATIVE_SECRET'; const r = evaluate(f);
  assert.equal(r.functionality, 'FAIL'); assert.equal(JSON.stringify(r).includes('SYNTHETIC_NEGATIVE'), false);
  assert.notEqual(reduceEvidence(f.b, '{"binding":1,"binding":2}', { at: at(190), trustedInput: true }).f1, 'PASS');
});
