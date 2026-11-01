import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SyntheticSessionReadout, createSyntheticSession, MAX_SESSION_BYTES } from '../scripts/fill_uat_session_transport.mjs';
import { EVENTS, PHASES, SCENARIOS, WATCHDOG_MS, frame } from '../scripts/fill_uat_synthetic_session.mjs';

const ID = '0123456789abcdef0123456789abcdef';
const hello = frame(ID, 0, 'hello', 'begin');
function wire(phase, identity = ID) {
  const index = PHASES.indexOf(phase) + 1;
  return frame(identity, index, phase, 'begin') + EVENTS[phase].map(e => JSON.stringify(e) + '\n').join('') + frame(identity, index, phase, 'end');
}
function fake(chunks, extra = {}) {
  const commands = []; let stopped = 0, observed = false;
  const transport = { read: async () => chunks.shift() ?? { output: '', eof: true },
    write: async command => { commands.push(command); },
    stop: async () => { stopped++; observed = true; return true; },
    get closed() { return observed; }, ...extra };
  return { transport, commands, get stopped() { return stopped; } };
}
const chunk = output => ({ output });

test('one native child spans five fenced phases; close is separate from phase completion', async () => {
  const session = createSyntheticSession();
  try {
    let identity, processId;
    for (const [index, phase] of PHASES.entries()) {
      const result = await session.phase(phase);
      assert.equal(result.complete, true, result.code);
      assert.equal(result.ok, phase !== 'close'); // closed control is deliberately verified=false.
      assert.equal(result.code, phase === 'close' ? 'UNVERIFIED_EVENTS' : 'OK');
      assert.equal(result.events.length, EVENTS[phase].length);
      assert.deepEqual(result.events.map(e => e.route), EVENTS[phase].map(e => e.route));
      identity ??= result.identity;
      processId ??= result.processId;
      assert.ok(Number.isInteger(processId) && processId > 0);
      assert.equal(result.processId, processId);
      assert.match(identity, /^[0-9a-f]{32}$/);
      assert.equal(result.identity, identity);
      assert.equal(result.completedPhases, index + 1);
      assert.equal(result.processClosedObserved, phase === 'close');
      assert.equal(result.stopConfirmed, phase === 'close');
      assert.equal(result.hostedAcceptance, false);
    }
  } finally { await session.abort(); }
});

const nativeFaults = { echo: ['MISSING_BEGIN'], stderr: ['STDERR_PRESENT'], wrong_session: ['CORRELATION'],
  wrong_phase: ['PHASE_FENCE'], duplicate: ['UNEXPECTED_EVENT'], early_eof: ['INCOMPLETE_PHASE'], nonzero: ['NONZERO_EXIT'],
  missing_end: ['PHASE_DEADLINE'], overflow: ['OVERFLOW'], late_phase: ['PHASE_FENCE'], unverified: ['UNVERIFIED_EVENTS'],
  invalid_control: ['MISSING_BEGIN'], extra_after_end: ['TRAILING_OUTPUT', 'UNEXPECTED_OUTPUT'],
  zero_without_end: ['INCOMPLETE_PHASE'], stall: ['PHASE_DEADLINE'] };
for (const [scenario, expectedCodes] of Object.entries(nativeFaults)) {
  test(`fixed native synthetic fault ${scenario} fails closed with observed teardown`, async () => {
    const session = createSyntheticSession(scenario, { phaseMs: 700 });
    try {
      assert.equal((await session.phase('configure')).ok, true);
      const result = await session.phase('positive');
      if (scenario === 'extra_after_end' && result.ok) {
        // A later OS chunk may arrive after a valid explicit end was returned.
        // The idle observer must then fence the SESSION, not rewrite history.
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(session.snapshot.fatal, 'UNEXPECTED_OUTPUT');
        assert.equal(session.snapshot.stopConfirmed, true);
        assert.equal(session.snapshot.processClosedObserved, true);
        assert.deepEqual((await session.phase('negative')).events, []);
        return;
      }
      assert.equal(result.ok, false);
      assert.ok(expectedCodes.includes(result.code), result.code);
      assert.equal(result.stopConfirmed, true);
      assert.equal(result.processClosedObserved, true);
      if (scenario !== 'unverified') assert.deepEqual(result.events, []);
      else { assert.equal(result.complete, true); assert.equal(result.events[0].verified, false); }
      assert.deepEqual((await session.phase('negative')).events, []);
    } finally { await session.abort(); }
  });
}

test('every split of hello, boundary, CRLF, SGR and event JSON preserves one ordered phase', async () => {
  const raw = (hello + wire('configure').replace('{', '\x1b[32m{').replace(/\nFMC_SYNTHETIC\/1 ([^\n]+) end\n$/, '\x1b[0m\nFMC_SYNTHETIC/1 $1 end\n')).replace(/\n/g, '\r\n');
  for (let split = 0; split <= raw.length; split++) {
    const f = fake([chunk(raw.slice(0, split)), chunk(raw.slice(split))]);
    const session = new SyntheticSessionReadout(f.transport);
    try {
      const result = await session.phase('configure');
      assert.equal(result.ok, true, `split ${split}: ${result.code}`);
      assert.equal(result.processClosedObserved, false);
      assert.deepEqual(f.commands, ['SYNTHETIC_SENTINEL:configure\n']);
    } finally { await session.abort(); }
  }
});

test('explicit boundary required: full event count plus EOF/quiet is insufficient', async () => {
  for (const last of [{ output: '', eof: true }, { output: '', exit_code: 0, eof: true }]) {
    const raw = hello + wire('configure').slice(0, wire('configure').lastIndexOf('FMC_SYNTHETIC/1'));
    const f = fake([chunk(raw), last]); const session = new SyntheticSessionReadout(f.transport);
    const result = await session.phase('configure');
    assert.equal(result.complete, false); assert.equal(result.code, 'INCOMPLETE_PHASE'); assert.deepEqual(result.events, []);
    assert.equal(f.stopped, 1);
  }
  const f = fake([chunk(hello + wire('configure'))], { read: () => new Promise(() => {}) });
  const session = new SyntheticSessionReadout(f.transport, { phaseMs: 20 });
  assert.equal((await session.phase('configure')).code, 'PHASE_DEADLINE');
});

test('correlation, boundaries, record order and arbitrary nested echo cannot cross phases', async () => {
  const cases = [
    [hello + wire('configure', 'f'.repeat(32)), 'CORRELATION'],
    [hello + wire('configure').replace('1 configure begin', '2 configure begin'), 'PHASE_FENCE'],
    [hello + frame(ID, 1, 'configure', 'begin') + wire('configure'), 'DUPLICATE_BOUNDARY'],
    [wire('configure'), 'MISSING_HELLO'],
    [hello + wire('configure').replace('1 configure begin', '01 configure begin'), 'INVALID_BOUNDARY'],
    [hello + wire('configure') + '{}\n', 'TRAILING_OUTPUT'],
    [hello + wire('configure') + '{', 'TRAILING_OUTPUT'],
    [hello + wire('configure').replace('"ready"', '"configure"'), 'UNEXPECTED_EVENT'],
    [hello + wire('configure').replace('{"label"', 'echo {"label"'), 'INVALID_RECORD'],
    [hello + wire('configure').replace('{"label"', '{"nested":{"label"'), 'INVALID_RECORD'],
    [hello + wire('configure').replace('{"label"', '\x1b[2K{"label"'), 'UNSUPPORTED_ANSI'],
    [hello + wire('configure').replace('{"label"', '\u0080{"label"'), 'UNSUPPORTED_CHARACTER'],
  ];
  for (const [raw, code] of cases) {
    const f = fake([chunk(raw)]); const session = new SyntheticSessionReadout(f.transport);
    const result = await session.phase('configure');
    assert.equal(result.code, code); assert.deepEqual(result.events, []); assert.equal(result.stopConfirmed, true);
    assert.equal((await session.phase('positive')).complete, false);
  }
});

test('completed phase results do not leak into failure or the next phase', async () => {
  const f = fake([chunk(hello + wire('configure')), chunk(frame(ID, 1, 'configure', 'end'))]);
  const session = new SyntheticSessionReadout(f.transport);
  const first = await session.phase('configure');
  assert.equal(first.events.length, 2); assert.ok(Object.isFrozen(first.events));
  const second = await session.phase('positive');
  assert.equal(second.code, 'PHASE_FENCE'); assert.deepEqual(second.events, []);
  assert.equal(first.events.length, 2);
});

test('absolute session lifetime never renews between phases', async () => {
  let time = 100;
  const f = fake([chunk(hello + wire('configure'))]);
  const session = new SyntheticSessionReadout(f.transport, { now: () => time, lifetimeMs: 100 });
  assert.equal((await session.phase('configure')).ok, true);
  const deadline = session.snapshot.deadline;
  time = 200;
  const result = await session.phase('positive');
  assert.equal(result.code, 'SESSION_DEADLINE'); assert.equal(result.deadline, deadline);
  assert.equal(f.commands.length, 1); assert.deepEqual(result.events, []);
});

test('blocked writes, reads, and empty-read loops are bounded without leaking adapter errors', async () => {
  for (const [extra, code] of [
    [{ write: () => new Promise(() => {}) }, 'PHASE_DEADLINE'],
    [{ read: () => new Promise(() => {}) }, 'PHASE_DEADLINE'],
    [{ read: async () => chunk('') }, 'READ_LIMIT'],
    [{ read: async () => { throw new Error('SYNTHETIC_PRIVATE_SENTINEL'); } }, 'READOUT_FAILED'],
    [{ write: async () => { throw new Error('SYNTHETIC_PRIVATE_SENTINEL'); } }, 'READOUT_FAILED'],
  ]) {
    const f = fake([], extra); const session = new SyntheticSessionReadout(f.transport, { phaseMs: 40 });
    const result = await session.phase('configure');
    assert.equal(result.code, code); assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
    assert.equal(result.stopConfirmed, true);
  }
});

test('session ingress cap counts consumed phases and frame bytes, not just buffered tail', async () => {
  const first = hello + wire('configure');
  const f = fake([chunk(first), chunk(' '.repeat(MAX_SESSION_BYTES - first.length + 1))]);
  const session = new SyntheticSessionReadout(f.transport);
  assert.equal((await session.phase('configure')).ok, true);
  const result = await session.phase('positive');
  assert.equal(result.code, 'OVERFLOW'); assert.deepEqual(result.events, []);
});

test('fatal stderr/unsolicited idle output/idle exit closes and fences all future phases', async () => {
  for (const code of ['STDERR_PRESENT', 'UNEXPECTED_OUTPUT', 'UNEXPECTED_EXIT']) {
    let onFatal, onOutput, onExit;
    const f = fake([chunk(hello + wire('configure'))], { observe(a, b, c) { onFatal = a; onOutput = b; onExit = c; } });
    const session = new SyntheticSessionReadout(f.transport);
    assert.equal((await session.phase('configure')).ok, true);
    if (code === 'STDERR_PRESENT') onFatal(code); else if (code === 'UNEXPECTED_OUTPUT') onOutput(); else onExit();
    await session.abort();
    assert.equal(session.snapshot.fatal, code); assert.equal(session.snapshot.stopConfirmed, true);
    assert.deepEqual((await session.phase('positive')).events, []);
  }
});

test('independent parent watchdog closes a child while caller is idle', async () => {
  const session = createSyntheticSession('normal', { lifetimeMs: 300 });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(session.snapshot.fatal, 'SESSION_DEADLINE');
  assert.equal(session.snapshot.processClosedObserved, true);
  assert.equal(session.snapshot.stopConfirmed, true);
});

test('concurrent phase calls are fatal; only finite ordered commands are accepted', async () => {
  const f = fake([], { read: () => new Promise(() => {}) });
  const session = new SyntheticSessionReadout(f.transport, { phaseMs: 30 });
  const first = session.phase('configure');
  const second = await session.phase('configure');
  assert.equal(second.code, 'CONCURRENT_PHASE'); assert.equal((await first).complete, false);
  for (const value of ['positive', 'SYNTHETIC_PRIVATE_SENTINEL', { password: 'SYNTHETIC_PRIVATE_SENTINEL' }]) {
    const f2 = fake([]); const s2 = new SyntheticSessionReadout(f2.transport);
    const result = await s2.phase(value);
    assert.equal(result.code, 'PHASE_ORDER'); assert.equal(f2.commands.length, 0);
    assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  }
});

test('teardown is bounded/idempotent and an unconfirmed close is never success', async () => {
  for (const stop of [async () => false, () => new Promise(() => {}), async () => { throw Error('SYNTHETIC_PRIVATE_SENTINEL'); }]) {
    const f = fake([{ output: '', eof: true }], { stop });
    const session = new SyntheticSessionReadout(f.transport, { stopMs: 10 });
    const result = await session.phase('configure');
    assert.equal(result.code, 'TEARDOWN_UNCONFIRMED'); assert.deepEqual(result.events, []);
    assert.equal(result.stopConfirmed, false); assert.equal((await session.abort()).stopConfirmed, false);
  }
});

test('invalid/reversed clocks fail closed and original options cannot reset a deadline', async () => {
  assert.throws(() => new SyntheticSessionReadout(fake([]).transport, { now: () => NaN }), /CLOCK_INVALID/);
  let count = 0;
  const session = new SyntheticSessionReadout(fake([]).transport, { now: () => count++ ? 9 : 10 });
  assert.equal((await session.phase('configure')).code, 'CLOCK_REVERSED');
  for (const options of [{ lifetimeMs: 18_001 }, { phaseMs: 5001 }, { stopMs: 2001 }, { lifetimeMs: 0 }, { env: {} }, { now: () => 0 }]) {
    assert.throws(() => createSyntheticSession('normal', options), /INVALID_OPTIONS/);
  }
  assert.throws(() => createSyntheticSession('unknown'), /INVALID_SCENARIO/);
});

test('close boundary still requires explicit zero exit AND separate observed process closure', async () => {
  for (const tail of [{ output: '', exit_code: 7, eof: true }, { output: '', eof: true }, { output: 'echo', exit_code: 0, eof: true }]) {
    const f = fake(PHASES.map((phase, i) => chunk((i ? '' : hello) + wire(phase))).concat([tail]));
    const session = new SyntheticSessionReadout(f.transport);
    for (const phase of PHASES.slice(0, -1)) assert.equal((await session.phase(phase)).ok, true);
    const result = await session.phase('close');
    assert.equal(result.complete, false); assert.deepEqual(result.events, []); assert.equal(result.stopConfirmed, true);
  }
});

test('exit in the same close chunk is accepted only with EOF and confirmed teardown', async () => {
  for (const confirmed of [true, false]) {
    const chunks = PHASES.map((phase, i) => chunk((i ? '' : hello) + wire(phase)));
    Object.assign(chunks.at(-1), { exit_code: 0, eof: true });
    const f = fake(chunks, { stop: async () => confirmed });
    const session = new SyntheticSessionReadout(f.transport);
    for (const phase of PHASES.slice(0, -1)) assert.equal((await session.phase(phase)).ok, true);
    const result = await session.phase('close');
    assert.equal(result.complete, confirmed); assert.equal(result.ok, false);
    assert.equal(result.code, confirmed ? 'UNVERIFIED_EVENTS' : 'TEARDOWN_UNCONFIRMED');
    if (!confirmed) assert.deepEqual(result.events, []);
  }
});

test('a queued trailing chunk cannot grant completion at an otherwise valid boundary', async () => {
  const f = fake([chunk(hello + wire('configure'))], { pendingOutput: true });
  const session = new SyntheticSessionReadout(f.transport);
  const result = await session.phase('configure');
  assert.equal(result.code, 'TRAILING_OUTPUT'); assert.deepEqual(result.events, []);
});

test('source boundaries and frozen protocol hashes remain explicit; both CI jobs include this suite', async () => {
  const transport = await readFile(new URL('../scripts/fill_uat_session_transport.mjs', import.meta.url), 'utf8');
  const producer = await readFile(new URL('../scripts/fill_uat_synthetic_session.mjs', import.meta.url), 'utf8');
  for (const source of [transport, producer]) {
    assert.doesNotMatch(source, /from ['"](?:node:)?(?:https?|net|tls|dns)|fetch\s*\(|\.work\/|service_role|FILL_UAT_ADMIN_KEY|clipboard|CDP/);
  }
  assert.match(transport, /shell: false, windowsHide: true/);
  assert.match(transport, /env: process\.platform === 'win32'.*SystemRoot/);
  assert.equal(WATCHDOG_MS, 20_000); assert.equal(SCENARIOS.length, 16);
  const hashes = { 'fill_uat_safe_events.mjs': 'f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a',
    'fill_uat_transport.mjs': '5f9d17745e17fa5fee4c38a8e631525a93784eceaf184607151b2c4dc464a844' };
  for (const [name, digest] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(await readFile(new URL('../scripts/' + name, import.meta.url))).digest('hex'), digest);
  }
  const workflow = await readFile(new URL('../../.github/workflows/platform-ci.yml', import.meta.url), 'utf8');
  assert.equal(workflow.split('node --test platform/tests/fill_uat_session_transport_contract.test.mjs').length - 1, 2);
  assert.equal(workflow.split('ref: ${{ github.event.pull_request.head.sha || github.sha }}').length - 1, 2);
});
