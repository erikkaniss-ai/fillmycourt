import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HelperCollector } from '../scripts/fill_uat_helper_collector.mjs';
import { HELPER_HASH, CANDIDATE, ContractError } from '../scripts/fill_uat_evidence_verdict.mjs';

const T0 = Date.parse('2030-01-01T00:00:00Z'), at = seconds => new Date(T0 + seconds * 1000).toISOString();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const wire = e => JSON.stringify(e) + '\n';
const event = (label, route, status = 0, denied = false, verified = true) => ({ label, route, status, request_id: '', verified, denied });
function fixture({ age = 60, transportOverrides = {}, responseMs = 100, stopMs = 20, capture = false } = {}) {
  const b = { run_id: id(9000), authorization_id: id(9001), candidate_sha: CANDIDATE, helper_sha256: HELPER_HASH, t0: at(0),
    identities: { canary: id(9010), a: id(9011), b: id(9012) }, historical_ids: Array.from({ length: 13 }, (_, i) => id(9100 + i)),
    pins: { operations_service_id: 'c0c6e5e2-0040-48e0-a0af-abfb1ec81b61', operations_sha: CANDIDATE,
      core_service_id: 'fc97f78f-d39e-4598-a615-b2413b9b3f76', core_sha: '0134f603445ea7f282ef0cb866d0f3591518cbb9',
      preview_site_id: 'd763b7a1-dccd-4638-8876-ac1670171698', preview_sha: CANDIDATE, supabase_project_ref: 'yclqnbcrchwieyzkyumx' } };
  const authority = { binding: structuredClone(b), owner_go_verified: true, consumed: false, max_new_accounts: 3, issued_at: at(-1), expires_at: at(1800), public_go: false };
  const config = { op: 'configure', approved_helper_sha256: HELPER_HASH, plan: { candidate_sha: CANDIDATE, run_id: b.run_id,
    authorization_id: b.authorization_id, t0: b.t0, date: '2030-01-01', calendar_start: at(0), calendar_end: at(86400),
    publishable_key: 'sb_publishable_SYNTHETIC_SENTINEL_PUBLIC_KEY', principals: Object.fromEntries(['canary', 'a', 'b'].map(label =>
      [label, { id: b.identities[label], password: `SYNTHETIC_SENTINEL:${label}:` + 'X'.repeat(45) }])) } };
  const clock = { wall: T0 + age * 1000, mono: 0, age(seconds) { this.wall = T0 + seconds * 1000; this.mono = (seconds - age) * 1000; } };
  const queue = [{ output: wire(event('', 'ready')) }], writes = [];
  let closed = false, stopCount = 0, callbacks, captured = '';
  const transport = { get closed() { return closed; },
    read: async () => queue.shift() ?? { output: '', eof: true },
    write: async line => {
      const c = JSON.parse(line); writes.push({ op: c.op, label: c.label ?? '', route: c.route ?? '' });
      if (c.op === 'configure' && capture) captured = line;
      let e;
      if (['configure', 'operator_gate'].includes(c.op)) e = event('', c.op);
      else if (c.op === 'login') e = event(c.label, 'login', 200);
      else if (c.op === 'denied_login') e = event(c.label, 'denied_login', 400, true);
      else { const deny = c.op === 'denied_get' || c.route.startsWith('foreign_') || c.route === 'provider_connections' && c.label === 'b'; e = event(c.label, c.route, deny ? c.op === 'denied_get' ? 401 : 403 : 200, deny); }
      queue.push({ output: wire(e) });
    },
    end() { queue.push({ output: '', exit_code: 0, eof: true }); },
    async stop() { stopCount++; closed = true; return true; },
    observe(...args) { callbacks = args; }, ...transportOverrides };
  return { b, authority, config, clock, transport, queue, writes, get captured() { return captured; },
    get stopCount() { return stopCount; }, get callbacks() { return callbacks; },
    create() { return new HelperCollector({ config: this.config, binding: this.b, authority: this.authority, transport: this.transport, wall: () => clock.wall, monotonic: () => clock.mono, responseMs, stopMs }); } };
}
async function setup(c) { assert.equal((await c.ready()).responseComplete, true); assert.equal((await c.configure()).responseComplete, true); }
async function canary(f, c) {
  await setup(c);
  const positive = [];
  for (const [age, command] of [[60, { op: 'login', label: 'canary' }], [61, { op: 'get', label: 'canary', route: 'own_today' }], [62, { op: 'get', label: 'canary', route: 'foreign_today' }]]) {
    f.clock.age(age); const r = await c.command(command); assert.equal(r.responseComplete, true, r.code); positive.push(r.observations[0]);
  }
  f.clock.age(130); const retained = await c.command({ op: 'denied_get', label: 'canary', route: 'me' });
  f.clock.age(131); const auth = await c.command({ op: 'denied_login', label: 'canary' });
  const proof = { binding: f.b, authority: f.authority,
    budget: { binding: f.b, source: 'guard_readback', independent: true, known_created_ids: Object.values(f.b.identities), unknown_create_count: 0,
      active_count: 0, pending_activation_count: 0, unresolved_nonce_count: 0, at: at(140) },
    canary: { binding: f.b, positive, ban: { source: 'guard_readback', independent: true, user_id: f.b.identities.canary, banned: true, at: at(125), readback_at: at(126) },
      retained_denial: retained.observations[0], auth_denial: auth.observations[0], auth_user_banned_verified: true },
    independent: { binding: f.b, source: 'cto_checkpoint', decision: 'pass', lease_digest: 'f'.repeat(64), evidence_ref: 'https://github.com/erikkaniss-ai/fillmycourt/pull/8#issuecomment-1', at: at(190), expires_at: at(600) },
    operators: null, cleanup: null };
  f.clock.age(190); return JSON.parse(JSON.stringify(proof));
}

test('actual-compatible DTO serializes once; secret copies never appear in receipts/state/errors', async () => {
  const f = fixture({ capture: true }); const c = f.create();
  try {
    assert.equal(c.snapshot.secretReferencesRetained, true); await setup(c);
    assert.equal(c.snapshot.secretReferencesRetained, false);
    const serialized = JSON.parse(f.captured); assert.equal(serialized.approved_helper_sha256, HELPER_HASH);
    assert.equal(serialized.plan.principals.a.password, f.config.plan.principals.a.password);
    assert.equal(f.captured.endsWith('\n'), true);
    const r = await c.command({ op: 'login', label: 'canary' }); assert.equal(r.responseComplete, true);
    for (const secret of [f.config.plan.principals.canary.password, f.config.plan.publishable_key]) {
      assert.equal(JSON.stringify([c.snapshot, r, c]).includes(secret), false);
    }
    assert.equal(r.boundaryVerified, false); assert.equal(r.grantsOwnerGo, false); assert.ok(Object.isFrozen(r.observations));
  } finally { await c.abort(); }
});
test('JSON quotes/backslashes round trip; caller mutation cannot alter a validated private configuration', async () => {
  const f = fixture({ capture: true }); f.config.plan.principals.a.password = 'SYNTHETIC_SENTINEL:"\\' + 'A'.repeat(45);
  const original = f.config.plan.principals.a.password, c = f.create();
  try { f.config.plan.principals.a.password = 'SYNTHETIC_MUTATED'; await setup(c); assert.equal(JSON.parse(f.captured).plan.principals.a.password, original); }
  finally { await c.abort(); }
});
test('raw JSON/duplicates, getters, toJSON, prototypes and invalid actual helper values reject before I/O', () => {
  const mutations = [f => { f.config = '{"op":"configure","op":"configure"}'; },
    f => { f.config.plan.publishable_key = 'sb_secret_SYNTHETIC'; }, f => { f.config.plan.publishable_key = 'eyJ.SYNTHETIC.token'; },
    f => { f.config.plan.principals.a.password = 'short'; }, f => { f.config.plan.principals.a.password = f.config.plan.principals.b.password; },
    f => { f.config.plan.principals.a.id = f.b.identities.b; }, f => { f.config.plan.url = 'https://synthetic.invalid'; },
    f => { f.config.approved_helper_sha256 = '0'.repeat(64); }, f => { f.config.plan.t0 = at(1); },
    f => { f.config.plan.date = '2030-02-30'; }, f => { f.config.plan.calendar_end = at(27 * 3600); }];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => f.create(), /Helper contract rejected/); assert.equal(f.writes.length, 0); }
  let called = false; const f = fixture(); Object.defineProperty(f.config.plan, 'publishable_key', { enumerable: true, get() { called = true; return 'SYNTHETIC'; } });
  assert.throws(() => f.create()); assert.equal(called, false);
  const f2 = fixture(); f2.config.toJSON = () => { called = true; }; assert.throws(() => f2.create()); assert.equal(called, false);
});
test('expired, consumed, old closed run, budget mismatch and exact service pins reject construction', () => {
  for (const mutate of [f => { f.clock.age(1800); }, f => { f.authority.consumed = true; }, f => { f.authority.max_new_accounts = 4; },
    f => { f.authority.expires_at = at(1801); }, f => { f.b.pins.operations_sha = '0'.repeat(40); },
    f => { f.b.run_id = f.config.plan.run_id = '0e3a5a5a-fa68-4b3f-9a96-bdca500b1ab4'; f.authority.binding = structuredClone(f.b); },
    f => { f.b.historical_ids[0] = f.b.identities.a; }]) {
    const f = fixture(); mutate(f); assert.throws(() => f.create()); assert.equal(f.writes.length, 0);
  }
});
test('canary evidence + CURRENT independent verdict opens a legitimate helper-shaped operator_gate', async () => {
  const f = fixture(), c = f.create();
  try {
    const proof = await canary(f, c); const expires = c.snapshot.originalExpiresAt;
    assert.equal((await c.authorizeOperators(proof, { trustedInput: true })).responseComplete, true);
    assert.equal(f.writes.at(-1).op, 'operator_gate');
    const login = await c.command({ op: 'login', label: 'a' }); assert.equal(login.responseComplete, true);
    assert.equal((await c.command({ op: 'get', label: 'a', route: 'foreign_today' })).events[0].status, 403);
    f.clock.age(1200); assert.equal((await c.command({ op: 'denied_get', label: 'a', route: 'foreign_today' })).responseComplete, true);
    assert.equal(c.snapshot.originalExpiresAt, expires); // Same tuple is accepted under explicit owned serialized convention.
    const close = await c.close(); assert.equal(close.code, 'PROCESS_CLOSED_UNAUTHENTICATED'); assert.equal(close.stopConfirmed, true);
    assert.equal(close.cleanupIntentRequired, true); // Helper EOF is NOT account cleanup.
  } finally { await c.abort(); }
});
test('synthetic helper gate success alone, wrong/absent/consumed/mismatched proof never enables operators', async () => {
  for (const variant of ['untrusted', 'missing', 'wrongid', 'oldproof', 'alteredreceipt', 'noauthcode']) {
    const f = fixture(), c = f.create();
    try {
      const proof = await canary(f, c);
      if (variant === 'missing') proof.independent = null;
      if (variant === 'wrongid') proof.canary.auth_denial.user_id = id(999);
      if (variant === 'oldproof') proof.authority.consumed = true;
      if (variant === 'alteredreceipt') proof.canary.positive[0].at = at(59); // valid independent DTO, not THIS collector's observed receipt.
      if (variant === 'noauthcode') proof.canary.auth_user_banned_verified = false;
      const before = f.writes.length, r = await c.authorizeOperators(proof, { trustedInput: variant !== 'untrusted' });
      assert.equal(r.responseComplete, false); assert.equal(f.writes.length, before); assert.equal(r.stopConfirmed, true);
    } finally { await c.abort(); }
  }
});
test('operator command cannot bypass gate; only exact allowlisted ops/labels/routes exist', async () => {
  for (const command of [{ op: 'login', label: 'a' }, { op: 'operator_gate' }, { op: 'refresh', label: 'canary' },
    { op: 'get', label: 'canary', route: 'https://synthetic.invalid' }, { op: 'get', label: 'canary', route: '' },
    { op: 'login', label: 'canary', password: 'SYNTHETIC_NEGATIVE' }]) {
    const f = fixture(), c = f.create(); await setup(c); const before = f.writes.length;
    const r = await c.command(command); assert.equal(r.responseComplete, false); assert.equal(f.writes.length, before); assert.equal(r.cleanupIntentRequired, true);
  }
});
test('one configuration, ready order and explicit early clear fail closed without replay', async () => {
  for (const variant of ['twice', 'before_ready', 'cleared']) {
    const f = fixture(), c = f.create();
    if (variant !== 'before_ready') await c.ready();
    if (variant === 'twice') await c.configure();
    if (variant === 'cleared') c.clearSecrets();
    const before = f.writes.length, r = await c.configure(); assert.equal(r.responseComplete, false); assert.equal(f.writes.length, before); assert.equal(c.snapshot.secretReferencesRetained, false);
  }
});
test('configuration wait never renews original DB T0 and stops at the300s input limit', async () => {
  const f = fixture(), c = f.create(); await c.ready(); const expiry = c.snapshot.originalExpiresAt;
  f.clock.age(361); const r = await c.configure(); assert.equal(r.code, 'CONFIGURATION_DEADLINE'); assert.equal(f.writes.length, 0); assert.equal(r.originalExpiresAt, expiry);
  const f2 = fixture(), c2 = f2.create(); await setup(c2); f2.clock.age(1800);
  assert.equal((await c2.command({ op: 'denied_login', label: 'canary' })).code, 'ORIGINAL_DEADLINE');
});
test('clock reversal/skew/nonfinite and slow positive window crossings abort with no partial proof', async () => {
  for (const mutate of [f => { f.clock.wall -= 1; }, f => { f.clock.mono -= 1; }, f => { f.clock.wall += 2001; }, f => { f.clock.mono = NaN; }]) {
    const f = fixture(), c = f.create(); await setup(c); mutate(f); const r = await c.command({ op: 'login', label: 'canary' }); assert.equal(r.responseComplete, false); assert.equal(r.stopConfirmed, true);
  }
  const f = fixture({ responseMs: 5000 }), c = f.create(); await setup(c); f.clock.age(119);
  const original = f.transport.read; f.transport.read = async (...args) => { f.clock.age(120); return original(...args); };
  const r = await c.command({ op: 'login', label: 'canary' }); assert.equal(r.code, 'POSITIVE_WINDOW_EXPIRED'); assert.deepEqual(r.events, []);
});
test('all splits of strict startup/SGR/CRLF and closed/deadline records preserve atomicity', async () => {
  for (const route of ['ready', 'closed', 'deadline']) {
    const raw = '\x1b[31m' + wire(event('', route, 0, false, route === 'ready')).trimEnd() + '\x1b[0m\r\n';
    for (let i = 0; i <= raw.length; i++) {
      const f = fixture(); f.queue.splice(0, 1, { output: raw.slice(0, i) }, { output: raw.slice(i) }); const c = f.create();
      const r = await c.ready(); assert.equal(r.responseComplete, route === 'ready');
      if (route !== 'ready') { assert.equal(r.code, route === 'closed' ? 'HELPER_CLOSED' : 'HELPER_DEADLINE'); assert.deepEqual(r.events, []); }
      await c.abort();
    }
  }
});
test('echo/duplicates/wrong schema/nested JSON/unsupported CSI/EOF and nonzero never release staged output', async () => {
  const good = wire(event('', 'ready'));
  for (const raw of [good + good, 'echo ' + good, '{"nested":' + good.trim() + '}\n', '\x1b[2K' + good, good + 'tail', good.replace('"verified":true', '"verified":false')]) {
    const f = fixture(); f.queue.splice(0, 1, { output: raw }); const c = f.create(); const r = await c.ready(); assert.equal(r.responseComplete, false); assert.deepEqual(r.events, []);
  }
  for (const value of [{ output: '', eof: true }, { output: good, exit_code: 7, eof: true }, { output: good, exit_code: 0, eof: true }, { output: good.slice(0, -1), exit_code: 0, eof: true }]) {
    const f = fixture(); f.queue.splice(0, 1, value); const c = f.create(); assert.equal((await c.ready()).responseComplete, false);
  }
});
test('ambiguous write/read failures consume the process; forged upstream errors do not leak strings', async () => {
  const forged = Object.create(ContractError.prototype); forged.code = 'SYNTHETIC_NEGATIVE_SECRET';
  for (const thrown of [Error('SYNTHETIC_NEGATIVE_SECRET'), new ContractError('SYNTHETIC_NEGATIVE_SECRET'), forged]) {
    const f = fixture(), c = f.create(); await c.ready();
    f.transport.write = async () => { throw thrown; };
    const r = await c.configure(); assert.equal(r.responseComplete, false); assert.equal(r.secretReferencesRetained, false);
    assert.equal(JSON.stringify(r).includes('SYNTHETIC_NEGATIVE'), false);
    if (thrown instanceof ContractError && thrown !== forged) assert.equal(thrown.message.includes('SYNTHETIC_NEGATIVE'), false);
    const before = f.writes.length; await c.configure(); assert.equal(f.writes.length, before);
  }
});
test('blocked reads/writes/empty loops and cumulative ingress are bounded, cleanup intent persists', async () => {
  for (const override of [{ read: () => new Promise(() => {}) }, { read: async () => ({ output: '' }) }, { read: async () => ({ output: 'x'.repeat(65537) }) }]) {
    const f = fixture({ transportOverrides: override, responseMs: 20 }), c = f.create(); const r = await c.ready();
    assert.equal(r.responseComplete, false); assert.equal(r.cleanupIntentRequired, true); assert.equal(r.stopConfirmed, true);
  }
  const f = fixture({ responseMs: 20 }), c = f.create(); await c.ready(); f.transport.write = () => new Promise(() => {});
  assert.equal((await c.configure()).code, 'RESPONSE_DEADLINE'); assert.equal(c.snapshot.secretReferencesRetained, false);
});
test('independent original-deadline timer fires while injected caller is blocked', async () => {
  const f = fixture({ age: 1799.98, transportOverrides: { read: () => new Promise(() => {}) }, responseMs: 100 }), c = f.create();
  const r = await c.ready(); assert.equal(r.responseComplete, false); assert.equal(r.fatal, 'ORIGINAL_DEADLINE'); assert.equal(r.stopConfirmed, true); assert.equal(r.cleanupIntentRequired, true);
});
test('later idle output/exit/stderr and concurrent calls are terminal, never cleanup verification', async () => {
  for (let i = 0; i < 3; i++) {
    const f = fixture(), c = f.create(); await c.ready(); f.callbacks[i](i === 0 ? 'STDERR_PRESENT' : undefined); await c.abort();
    assert.equal(c.snapshot.stopConfirmed, true); assert.equal(c.snapshot.cleanupIntentRequired, true); assert.equal((await c.configure()).responseComplete, false);
  }
  const f = fixture({ transportOverrides: { read: () => new Promise(() => {}) }, responseMs: 20 }), c = f.create();
  const first = c.ready(); assert.equal((await c.ready()).code, 'CONCURRENT_REQUEST'); assert.equal((await first).responseComplete, false);
});
test('EOF/zero exit/observed teardown are separate from functionality and account cleanup', async () => {
  const f = fixture(), c = f.create(); await setup(c); const r = await c.close();
  assert.equal(r.code, 'PROCESS_CLOSED_UNAUTHENTICATED'); assert.equal(r.responseComplete, false); assert.equal(r.processClosedObserved, true); assert.equal(r.cleanupIntentRequired, true);
  for (const stop of [async () => false, () => new Promise(() => {}), async () => { throw Error('SYNTHETIC_NEGATIVE'); }]) {
    const f2 = fixture({ transportOverrides: { stop }, stopMs: 10 }), c2 = f2.create(); await setup(c2);
    const closed = await c2.close(); assert.equal(closed.code, 'TEARDOWN_UNCONFIRMED'); assert.deepEqual(closed.events, []);
  }
});
test('source boundary stays pure/uninvoked and both tests are mandatory in both exact-head CI jobs', async () => {
  for (const file of ['fill_uat_helper_collector.mjs', 'fill_uat_evidence_verdict.mjs']) {
    const source = await readFile(new URL('../scripts/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]node:|\bfetch\s*\(|\bprocess\.|\.work\/|f1-readonly-validator|console\.|import\(/);
  }
  const frozen = { 'fill_uat_safe_events.mjs': 'f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a',
    'fill_uat_helper_contract.mjs': 'ad79c4b8d3f9194f2f8cbad4f55838ccfef5421cb2e5b354a00d7032f1f7b8e5',
    'fill_uat_synthetic_helper.mjs': 'fa5041bf8d1df856b4734672f66c8f25dcbf3b89ed91799597cd307dfe39e540' };
  for (const [file, digest] of Object.entries(frozen)) assert.equal(createHash('sha256').update(await readFile(new URL('../scripts/' + file, import.meta.url))).digest('hex'), digest);
  const ci = await readFile(new URL('../../.github/workflows/platform-ci.yml', import.meta.url), 'utf8');
  for (const file of ['fill_uat_helper_collector', 'fill_uat_evidence_verdict']) assert.equal(ci.split(`node --test platform/tests/${file}.test.mjs`).length - 1, 2);
  assert.equal(ci.split('ref: ${{ github.event.pull_request.head.sha || github.sha }}').length - 1, 2);
});
