import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMMANDS, FIXTURE_CONFIG, FIXTURE_PLAN, FIXTURE_GATE, SENTINEL, MAX_BYTES, HelperContractReadout,
  readiness, fixtureReply, fixtureCommandName, FROZEN_HELPER_SHA256 } from '../scripts/fill_uat_helper_contract.mjs';
import { createSyntheticHelper, syntheticInputAccepted, SCENARIOS, WATCHDOG_MS } from '../scripts/fill_uat_synthetic_helper.mjs';

const control = route => ({ label: '', route, status: 0, request_id: '', verified: !['closed', 'deadline'].includes(route), denied: false });
const line = value => JSON.stringify(value) + '\n';
const chunk = output => ({ output });
const ready = line(control('ready'));
function fake(chunks, extra = {}) {
  const writes = []; let stopped = 0, closed = false;
  return { writes, get stopped() { return stopped; }, transport: {
    read: async () => chunks.shift() ?? { output: '', eof: true },
    write: async value => { writes.push(value); }, end() {},
    stop: async () => { stopped++; closed = true; return true; }, get closed() { return closed; }, ...extra,
  } };
}
async function setup(session) {
  for (const name of ['ready', 'configure']) assert.equal((await session.request(name)).responseComplete, true, name);
}
function assertResponse(result) {
  assert.equal(result.responseComplete, true, result.code);
  assert.equal(result.boundaryVerified, false); assert.equal(result.childCorrelation, false);
  assert.equal(result.authenticatedClosure, false); assert.equal(result.hostedAcceptance, false); assert.equal(result.liveReady, false);
  assert.equal(result.correlation, 'PARENT_SERIAL_ORDER_ONLY');
}

test('one plain JSONL mock spans startup/configuration and serialized canary/operator MODEL responses', async () => {
  const session = createSyntheticHelper('fragmented');
  try {
    await setup(session);
    const pid = session.snapshot.processId, deadline = session.snapshot.deadline;
    const first = ['canary_login', 'canary_get_me', 'canary_get_own_today', 'canary_get_foreign_today'];
    for (const name of first) { const r = await session.request(name); assertResponse(r); assert.equal(r.processId, pid); }
    assert.equal(session.advanceFixtureAge(130), true);
    for (const name of ['canary_denied_get_me', 'canary_denied_login']) assertResponse(await session.request(name));
    assert.equal(session.advanceFixtureAge(190), true);
    for (const name of ['operator_gate', 'a_login', 'a_get_me', 'a_get_own_calendar', 'b_login', 'b_get_provider_connections']) assertResponse(await session.request(name));
    assert.equal(session.advanceFixtureAge(1200), true);
    assertResponse(await session.request('a_denied_get_me'));
    assert.equal(session.snapshot.processClosedObserved, false);
    const closed = await session.close();
    assert.equal(closed.code, 'PROCESS_CLOSED_UNAUTHENTICATED'); assert.equal(closed.responseComplete, false);
    assert.equal(closed.stopConfirmed, true); assert.equal(closed.processClosedObserved, true);
    assert.equal(closed.deadline, deadline); assert.equal(closed.processId, pid);
  } finally { await session.abort(); }
});

for (const scenario of ['normal', 'crlf', 'sgr']) test(`native mock ${scenario} startup has no input echo and natural observed close`, async () => {
  const s = createSyntheticHelper(scenario);
  try { await setup(s); assertResponse(await s.request('canary_login')); assert.equal((await s.close()).stopConfirmed, true); }
  finally { await s.abort(); }
});

const faults = { echo: ['INVALID_RESPONSE'], duplicate: ['INVALID_RESPONSE', 'UNSOLICITED_OUTPUT'], late: ['INVALID_RESPONSE'],
  closed: ['HELPER_CLOSED'], deadline: ['HELPER_DEADLINE'], nonzero: ['NONZERO_EXIT'], early_eof: ['INCOMPLETE_RESPONSE'],
  overflow: ['OVERFLOW'], stderr: ['STDERR_PRESENT'], unverified: ['UNVERIFIED_RESPONSE'], wrong_tuple: ['INVALID_RESPONSE'],
  stall: ['RESPONSE_DEADLINE'], wrong_schema: ['INVALID_RESPONSE'] };
for (const [scenario, codes] of Object.entries(faults)) test(`native fixed fault ${scenario} cannot grant closure/authority and owned child closes`, async () => {
  const s = createSyntheticHelper(scenario, { responseMs: 700 });
  try {
    await setup(s); const result = await s.request('canary_login');
    if (scenario === 'duplicate' && result.responseComplete) {
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(s.snapshot.fatal, 'UNSOLICITED_OUTPUT'); assert.equal(s.snapshot.stopConfirmed, true);
    } else { assert.equal(result.responseComplete, false); assert.ok(codes.includes(result.code), result.code); assert.deepEqual(result.events, []); }
    assert.equal(s.snapshot.processClosedObserved, true); assert.equal(s.snapshot.stopConfirmed, true);
    assert.equal((await s.request('canary_get_me')).responseComplete, false);
  } finally { await s.abort(); }
});

test('repeated startup ready is rejected atomically or as unsolicited idle output', async () => {
  const s = createSyntheticHelper('ready_twice');
  try {
    const result = await s.request('ready');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(['INVALID_RESPONSE', 'UNSOLICITED_OUTPUT'].includes(s.snapshot.fatal));
    if (!result.responseComplete) assert.deepEqual(result.events, []);
    assert.equal(s.snapshot.stopConfirmed, true);
  } finally { await s.abort(); }
});

test('canonical finite DTOs reject synthetic-sensitive substitutions and any URL/key/JWT-shaped input', () => {
  for (const [name, command] of Object.entries(COMMANDS)) assert.equal(syntheticInputAccepted(JSON.stringify(command)), name);
  const mutations = [
    config => { config.plan.principals.a.password = 'SYNTHETIC_NEGATIVE_PASSWORD'; },
    config => { config.plan.publishable_key = 'eyJ.SYNTHETIC_NEGATIVE.token'; },
    config => { config.plan.publishable_key = 'sb_secret_SYNTHETIC_NEGATIVE'; },
    config => { config.plan.principals.a.id = 'SYNTHETIC_NEGATIVE_USER'; },
    config => { config.plan.run_id = 'SYNTHETIC_NEGATIVE_RUN'; },
    config => { config.plan.authorization_id = 'SYNTHETIC_NEGATIVE_AUTHORITY'; },
    config => { config.plan.t0 = '2030-01-01T00:00:01Z'; },
    config => { config.plan.url = 'https://synthetic.invalid'; },
    config => { config.plan.extra = {}; },
    config => { config.approved_helper_sha256 = FROZEN_HELPER_SHA256; },
  ];
  for (const mutate of mutations) { const config = structuredClone(FIXTURE_CONFIG); mutate(config); assert.equal(syntheticInputAccepted(JSON.stringify(config)), null); }
  assert.equal(syntheticInputAccepted(JSON.stringify({ ...FIXTURE_GATE, evidence_ref: 'https://synthetic.invalid' })), null);
  for (const value of ['{}', '{"op":"close"}', 'SYNTHETIC_SENTINEL', '\x1b[2K', 'x'.repeat(4097), 'é', JSON.stringify({ op: 'get', label: 'canary', route: 'https://synthetic.invalid' })]) assert.equal(syntheticInputAccepted(value), null);
  assert.equal(fixtureCommandName({ password: 'SYNTHETIC_NEGATIVE' }), null);
  assert.ok(Object.isFrozen(FIXTURE_PLAN.principals.a));
  assert.ok(Object.values(FIXTURE_PLAN.principals).every(p => p.password.startsWith(SENTINEL)));
});

test('actual fixed mock rejects a modified DTO and closes; no live helper is invoked', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/fill_uat_synthetic_helper.mjs', import.meta.url)), 'normal'], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    env: process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
  });
  let raw = '', code;
  const closed = new Promise(resolve => child.once('close', value => { code = value; resolve(); }));
  child.stdin.on('error', () => {});
  child.stdout.on('data', data => { if (raw.length < 2048) raw += data.toString(); });
  // Public negative fixture only; not an actual password/key.
  child.stdin.end(JSON.stringify({ ...FIXTURE_CONFIG, plan: { ...FIXTURE_PLAN, publishable_key: 'SYNTHETIC_NEGATIVE' } }) + '\n');
  const timer = setTimeout(() => child.kill(), 2000);
  await closed; clearTimeout(timer);
  assert.equal(code, 0);
  assert.deepEqual(raw.trim().split('\n').map(l => JSON.parse(l).route), ['ready', 'closed']);
  assert.equal(raw.includes('SYNTHETIC_NEGATIVE'), false); raw = '';
});

test('every byte split of CRLF/SGR startup and fatal terminal records uses the frozen parser', async () => {
  for (const route of ['ready', 'closed', 'deadline']) {
    const raw = '\x1b[31m' + line(control(route)).trimEnd() + '\x1b[0m\r\n';
    for (let split = 0; split <= raw.length; split++) {
      const f = fake([chunk(raw.slice(0, split)), chunk(raw.slice(split))]); const s = new HelperContractReadout(f.transport);
      const r = await s.request('ready');
      assert.equal(r.code, route === 'ready' ? 'RESPONSE_COMPLETE_UNFENCED' : route === 'closed' ? 'HELPER_CLOSED' : 'HELPER_DEADLINE');
      if (route !== 'ready') assert.deepEqual(r.events, []);
      await s.abort();
    }
  }
});

test('one config per process; startup/configuration order is mandatory', async () => {
  for (const names of [['configure'], ['ready', 'canary_login'], ['ready', 'ready'], ['ready', 'configure', 'configure']]) {
    const f = fake([chunk(ready), chunk(line(fixtureReply('configure')))]); const s = new HelperContractReadout(f.transport);
    let result;
    for (const name of names) result = await s.request(name);
    assert.equal(result.responseComplete, false); assert.equal(result.stopConfirmed, true);
    assert.ok(['READY_REQUIRED', 'CONFIGURATION_REQUIRED', 'DUPLICATE_READY', 'ONE_CONFIGURATION'].includes(result.code));
  }
});

test('operator/denial/login windows are MODEL constraints, never inferred CTO authority', async () => {
  for (const [age, name, code] of [[60, 'a_login', 'OPERATOR_GATE_REQUIRED'], [130, 'canary_login', 'POSITIVE_WINDOW_EXPIRED'],
    [60, 'canary_denied_login', 'DENIAL_TOO_EARLY'], [60, 'operator_gate', 'OPERATOR_GATE_REJECTED'],
    [1200, 'operator_gate', 'OPERATOR_GATE_REJECTED'], [60, 'canary_get_me', 'LOGIN_REQUIRED']]) {
    const f = fake([chunk(ready), chunk(line(fixtureReply('configure')))]);
    const s = new HelperContractReadout(f.transport, { fixtureAge: age }); await setup(s);
    const result = await s.request(name); assert.equal(result.code, code); assert.equal(f.writes.length, 1);
    assert.equal(readiness().liveReady, false); assert.equal(readiness().authorityConsumed, true);
  }
});

test('consumed operation cannot retry and overlapping plain-wire responses are refused BEFORE write', async () => {
  const s = createSyntheticHelper();
  try {
    await setup(s); await s.request('canary_login'); await s.request('canary_get_foreign_today');
    assert.equal(s.advanceFixtureAge(130), true);
    const result = await s.request('canary_denied_get_foreign_today');
    assert.equal(result.code, 'AMBIGUOUS_RESPONSE_SLOT'); assert.deepEqual(result.events, []);
  } finally { await s.abort(); }
  const s2 = createSyntheticHelper();
  try { await setup(s2); await s2.request('canary_login'); assert.equal((await s2.request('canary_login')).code, 'CONSUMED_SLOT'); }
  finally { await s2.abort(); }
});

test('full record is RESPONSE completion only, not a phase fence, authenticated close or permission', async () => {
  const f = fake([chunk(ready)]); const s = new HelperContractReadout(f.transport);
  const result = await s.request('ready'); assertResponse(result);
  assert.equal(result.processClosedObserved, false); assert.equal(result.stopConfirmed, false);
  assert.deepEqual(result.events, [control('ready')]);
  assert.equal(readiness().newAccountQuota, 0); assert.equal(readiness().helperCompatibilityAccepted, false);
  assert.ok(readiness().gaps.includes('NO_CHILD_CORRELATION_OR_PHASE_FENCE'));
  await s.abort();
});

test('reordered/late/extra/nested/echo/control/wrong-schema bytes reject atomically without partial events', async () => {
  const wires = [ready + ready, ready + 'tail', line(fixtureReply('configure')), 'echo ' + ready,
    '{"nested":' + ready.trim() + '}\n', ready.replace('"status":0', '"status":200'), '\x1b[2K' + ready,
    ready.replace('"denied":false', '"denied":false,"extra":1'), ready + '\x1b[', 'é\n'];
  for (const raw of wires) {
    const f = fake([chunk(raw), { output: '', eof: true }]); const s = new HelperContractReadout(f.transport);
    const result = await s.request('ready'); assert.equal(result.responseComplete, false); assert.deepEqual(result.events, []);
    assert.equal(result.stopConfirmed, true); assert.equal(result.liveReady, false);
  }
});

test('response semantic failure cannot leak a prior successful response', async () => {
  const f = fake([chunk(ready), chunk(line(fixtureReply('configure'))), chunk(line({ ...fixtureReply('canary_login'), verified: false }))]);
  const s = new HelperContractReadout(f.transport); await setup(s);
  const r = await s.request('canary_login'); assert.equal(r.code, 'UNVERIFIED_RESPONSE'); assert.deepEqual(r.events, []);
  assert.deepEqual((await s.request('canary_get_me')).events, []);
});

test('a valid safe denial is not a successful expected positive GET', async () => {
  const values = [control('ready'), fixtureReply('configure'), fixtureReply('canary_login'),
    { ...fixtureReply('canary_get_own_today'), status: 401, denied: true }];
  const s = new HelperContractReadout(fake(values.map(v => chunk(line(v)))).transport);
  await setup(s); assertResponse(await s.request('canary_login'));
  const r = await s.request('canary_get_own_today');
  assert.equal(r.code, 'RESPONSE_SEMANTICS'); assert.deepEqual(r.events, []); assert.equal(r.stopConfirmed, true);
});

test('original MODEL lease expiry is absolute; fixture age/clock never renews T0 or source authority', async () => {
  let time = 100;
  const f = fake([chunk(ready), chunk(line(fixtureReply('configure')))]); const s = new HelperContractReadout(f.transport, {}, () => time);
  await setup(s); const deadline = s.snapshot.deadline;
  assert.equal(s.advanceFixtureAge(1800), true);
  assert.equal((await s.request('canary_login')).code, 'ORIGINAL_LEASE_EXPIRED');
  assert.equal(s.snapshot.deadline, deadline); assert.equal(FIXTURE_PLAN.t0, '2030-01-01T00:00:00Z'); assert.equal(readiness().liveReady, false);
  const s2 = new HelperContractReadout(fake([]).transport, { fixtureAge: 1800 });
  assert.equal((await s2.request('ready')).code, 'ORIGINAL_LEASE_EXPIRED');
  const s3 = new HelperContractReadout(fake([]).transport);
  assert.equal(s3.advanceFixtureAge(0), false); await s3.abort(); assert.equal(s3.snapshot.fatal, 'FIXTURE_CLOCK_REJECTED');
});

test('session deadline cannot renew across responses; invalid/reversed clocks fail closed', async () => {
  let time = 0;
  const s = new HelperContractReadout(fake([chunk(ready)]).transport, { lifetimeMs: 100 }, () => time);
  assertResponse(await s.request('ready')); time = 100;
  assert.equal((await s.request('configure')).code, 'SESSION_DEADLINE');
  assert.throws(() => new HelperContractReadout(fake([]).transport, {}, () => NaN), /CLOCK_INVALID/);
  let n = 0; const s2 = new HelperContractReadout(fake([]).transport, {}, () => n++ ? -1 : 0);
  assert.equal((await s2.request('ready')).code, 'CLOCK_REVERSED');
});

test('EOF/nonzero/partial/quiet/zero-exit-without-proof never complete a response', async () => {
  for (const tail of [{ output: '', eof: true }, { output: '', eof: true, exit_code: 0 }, { output: ready, exit_code: 7, eof: true },
    { output: ready.slice(0, -1), exit_code: 0, eof: true }, { output: ready, exit_code: 0, eof: true }]) {
    const s = new HelperContractReadout(fake([tail]).transport); const r = await s.request('ready');
    assert.equal(r.responseComplete, false); assert.deepEqual(r.events, []); assert.equal(r.stopConfirmed, true);
  }
});

test('read/write hangs, empty loops and opaque synthetic-sensitive exceptions are bounded/cleared', async () => {
  for (const extra of [{ read: () => new Promise(() => {}) }, { read: async () => chunk('') },
    { read: async () => { throw Error('SYNTHETIC_NEGATIVE'); } }]) {
    const s = new HelperContractReadout(fake([], extra).transport, { responseMs: 30 });
    const r = await s.request('ready'); assert.equal(r.responseComplete, false); assert.equal(r.stopConfirmed, true);
    assert.equal(JSON.stringify(r).includes('SYNTHETIC_NEGATIVE'), false);
  }
  const s = new HelperContractReadout(fake([chunk(ready)], { write: () => new Promise(() => {}) }).transport, { responseMs: 20 });
  await s.request('ready'); assert.equal((await s.request('configure')).code, 'RESPONSE_DEADLINE');
});

test('cumulative ingress cap includes consumed responses; late idle output/exit/stderr is fatal', async () => {
  const s = new HelperContractReadout(fake([chunk(ready), chunk(' '.repeat(MAX_BYTES - ready.length + 1))]).transport);
  await s.request('ready'); assert.equal((await s.request('configure')).code, 'OVERFLOW');
  for (let index = 0; index < 3; index++) {
    let callbacks;
    const f = fake([chunk(ready)], { observe(...args) { callbacks = args; } }); const session = new HelperContractReadout(f.transport);
    await session.request('ready'); callbacks[index](index === 0 ? 'STDERR_PRESENT' : undefined);
    await session.abort(); assert.equal(session.snapshot.stopConfirmed, true);
    assert.equal((await session.request('configure')).responseComplete, false);
  }
});

test('caller-idle independent watchdog terminates fixed mock', async () => {
  const s = createSyntheticHelper('normal', { lifetimeMs: 300 });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(s.snapshot.fatal, 'SESSION_DEADLINE'); assert.equal(s.snapshot.stopConfirmed, true); assert.equal(s.snapshot.processClosedObserved, true);
});

test('concurrent/arbitrary requests and unconfirmed teardown never grant response/authority', async () => {
  const s = new HelperContractReadout(fake([], { read: () => new Promise(() => {}) }).transport, { responseMs: 30 });
  const first = s.request('ready'); const second = await s.request('ready');
  assert.equal(second.code, 'CONCURRENT_REQUEST'); assert.equal((await first).responseComplete, false);
  for (const name of ['SYNTHETIC_NEGATIVE', { password: 'SYNTHETIC_NEGATIVE' }]) {
    const s2 = new HelperContractReadout(fake([]).transport); const r = await s2.request(name);
    assert.equal(r.code, 'UNKNOWN_COMMAND'); assert.equal(JSON.stringify(r).includes('SYNTHETIC_NEGATIVE'), false);
  }
  for (const stop of [async () => false, () => new Promise(() => {}), async () => { throw Error('SYNTHETIC_NEGATIVE'); }]) {
    const s3 = new HelperContractReadout(fake([{ output: '', eof: true }], { stop }).transport, { stopMs: 10 });
    const r = await s3.request('ready'); assert.equal(r.code, 'TEARDOWN_UNCONFIRMED'); assert.deepEqual(r.events, []);
    assert.equal((await s3.abort()).stopConfirmed, false);
  }
});

test('process close requires EOF/zero/observed teardown and is never authenticated closure', async () => {
  for (const tail of [{ output: '', exit_code: 7, eof: true }, { output: '', eof: true }, { output: ready, exit_code: 0, eof: true }]) {
    const s = new HelperContractReadout(fake([chunk(ready), tail]).transport); await s.request('ready');
    const result = await s.close(); assert.notEqual(result.code, 'PROCESS_CLOSED_UNAUTHENTICATED'); assert.equal(result.authenticatedClosure, false);
  }
});

test('factory has no live-use switches and source/CI/frozen-hash boundaries remain intact', async () => {
  for (const options of [{ path: 'SYNTHETIC_NEGATIVE' }, { env: {} }, { executable: 'node' }, { live: true }, { authorityConsumed: false }, { lifetimeMs: 18001 }, { responseMs: 5001 }]) {
    assert.throws(() => createSyntheticHelper('normal', options), /INVALID_OPTIONS/);
  }
  assert.throws(() => createSyntheticHelper('unknown'), /INVALID_SCENARIO/);
  const source = await readFile(new URL('../scripts/fill_uat_helper_contract.mjs', import.meta.url), 'utf8');
  const mock = await readFile(new URL('../scripts/fill_uat_synthetic_helper.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:child_process|node:fs|fetch\s*\(|FMC_SYNTHETIC\/1/);
  for (const text of [source, mock]) assert.doesNotMatch(text, /from ['"](?:node:)?(?:https?|net|tls|dns)|\.work\/|f1-readonly-validator|FILL_UAT_ADMIN_KEY|node:process/);
  assert.match(mock, /typeof process !== 'undefined' \? process\.execPath : 'node'/);
  assert.match(mock, /shell: false, windowsHide: true/); assert.equal(WATCHDOG_MS, 20000); assert.equal(SCENARIOS.length, 18);
  const hashes = { 'fill_uat_safe_events.mjs': 'f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a',
    'fill_uat_transport.mjs': '5f9d17745e17fa5fee4c38a8e631525a93784eceaf184607151b2c4dc464a844',
    'fill_uat_session_transport.mjs': 'b109240103236948afb57e43be2707bd0010b1f126337b178c65fbce4c9e54b0',
    'fill_uat_synthetic_session.mjs': 'bc1da8a5afb2aeda3ecd9bb5b48fa63a364790424cba6c3510a09eee842ada40' };
  for (const [name, digest] of Object.entries(hashes)) assert.equal(createHash('sha256').update(await readFile(new URL('../scripts/' + name, import.meta.url))).digest('hex'), digest);
  const ci = await readFile(new URL('../../.github/workflows/platform-ci.yml', import.meta.url), 'utf8');
  assert.equal(ci.split('node --test platform/tests/fill_uat_helper_contract.test.mjs').length - 1, 2);
  assert.equal(ci.split('ref: ${{ github.event.pull_request.head.sha || github.sha }}').length - 1, 2);
});
