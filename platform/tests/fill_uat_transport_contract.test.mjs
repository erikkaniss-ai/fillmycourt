import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { readSafeEventPhase, runSyntheticPipe, createSyntheticPipe,
  SYNTHETIC_EVENTS, SYNTHETIC_EXPECTED, SYNTHETIC_SCENARIOS } from '../scripts/fill_uat_transport.mjs';
import { SafeEventsError } from '../scripts/fill_uat_safe_events.mjs';

const wire = SYNTHETIC_EVENTS.map(event => JSON.stringify(event) + '\n').join('');
const sentinel = 'SYNTHETIC-SENSITIVE-MARKER';
async function fromChunks(chunks, overrides = {}) {
  let index = 0, stopped = 0;
  const result = await readSafeEventPhase({ expected: SYNTHETIC_EXPECTED,
    read: async () => chunks[index++] ?? { output: '', exit_code: 0 },
    stop: async () => { stopped++; return true; }, deadline: performance.now() + 1000, ...overrides });
  return { result, stopped, readCount: index };
}
function noLeak(result) {
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.equal(Object.hasOwn(result, 'output'), false);
  assert.equal(Object.hasOwn(result, 'error'), false);
}

test('tool-shaped fragmented chunks commit only after zero exit and teardown', async () => {
  const chunks = [];
  for (let index = 0; index < wire.length; index += 7) chunks.push({ output: wire.slice(index, index + 7), session_id: 1 });
  const { result, stopped } = await fromChunks(chunks);
  assert.equal(result.ok, true); assert.equal(result.complete, true);
  assert.deepEqual(result.events, SYNTHETIC_EVENTS);
  assert.equal(result.stopConfirmed, true); assert.equal(stopped, 1);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.events));
});

test('zero exit without proof, partial EOF, and EOF without exit fail closed', async () => {
  for (const [chunks, code] of [
    [[{ output: '', exit_code: 0 }], 'INCOMPLETE_PHASE'],
    [[{ output: wire.slice(0, 30), exit_code: 0 }], 'INCOMPLETE_FRAME'],
    [[{ output: wire, eof: true }], 'EOF_WITHOUT_EXIT'],
  ]) {
    const { result, stopped } = await fromChunks(chunks);
    assert.equal(result.ok, false); assert.equal(result.complete, false);
    assert.equal(result.code, code); assert.deepEqual(result.events, []);
    assert.equal(result.stopConfirmed, true); assert.equal(stopped, 1);
  }
});

test('nonzero exit overrides even otherwise complete proof', async () => {
  const { result } = await fromChunks([{ output: wire }, { output: '', exit_code: 7 }]);
  assert.equal(result.code, 'NONZERO_EXIT'); assert.deepEqual(result.events, []);
});

test('unknown echo/suffix/nested event and stderr never escape result', async () => {
  for (const chunk of [
    { output: sentinel + '\n' + wire, exit_code: 0 },
    { output: wire + sentinel + '\n', exit_code: 0 },
    { output: JSON.stringify({ echo: sentinel, nested: SYNTHETIC_EVENTS[0] }) + '\n', exit_code: 0 },
    { output: wire, stderr: sentinel, exit_code: 0 },
  ]) {
    const { result } = await fromChunks([chunk]);
    assert.equal(result.ok, false); assert.deepEqual(result.events, []); noLeak(result);
  }
});

test('opaque read errors, including forged SafeEventsError, are sanitized', async () => {
  for (const error of [new Error(sentinel), new SafeEventsError(sentinel)]) {
    const { result } = await fromChunks([], { read: async () => { throw error; } });
    assert.equal(result.code, 'READ_FAILED'); noLeak(result);
  }
});

test('absolute monotonic deadline is never renewed by arriving fragments', async () => {
  let now = 0, reads = 0;
  const { result } = await fromChunks([], { now: () => now, deadline: 100,
    read: async () => { reads++; now += 60; return { output: ' ' }; } });
  assert.equal(result.code, 'DEADLINE'); assert.equal(reads, 2);
  assert.deepEqual(result.events, []); assert.equal(result.stopConfirmed, true);
});

test('a blocked read is bounded and receives an aborted signal', async () => {
  let signal;
  const started = performance.now();
  const { result } = await fromChunks([], { deadline: performance.now() + 40,
    read: options => { signal = options.signal; return new Promise(() => {}); } });
  assert.equal(result.code, 'DEADLINE'); assert.equal(signal.aborted, true);
  assert.equal(result.stopConfirmed, true);
  assert.ok(performance.now() - started < 1500);
});

test('expired and reversed/nonfinite clocks close without clock reset', async () => {
  const expired = await fromChunks([], { now: () => 10, deadline: 10 });
  assert.equal(expired.result.code, 'DEADLINE'); assert.equal(expired.readCount, 0);
  let calls = 0;
  const reversed = await fromChunks([], { now: () => [10, 11, 9][calls++] ?? 9, deadline: 100,
    read: async () => ({ output: wire, exit_code: 0 }) });
  assert.equal(reversed.result.code, 'CLOCK_REVERSED');
  const invalid = await fromChunks([], { now: () => NaN, deadline: 100 });
  assert.equal(invalid.result.code, 'CLOCK_INVALID');
});

test('empty-read loops are bounded independently of clock progress', async () => {
  const { result } = await fromChunks([], { now: () => 0, deadline: 100, maxReads: 3,
    read: async () => ({ output: '' }) });
  assert.equal(result.code, 'READ_LIMIT'); assert.equal(result.reads, 3);
});

test('unverified semantic outcomes remain safe failure reports, never OK', async () => {
  const events = SYNTHETIC_EVENTS.map(event => event.route === 'denied_login'
    ? { ...event, status: 200, verified: false, denied: false } : event);
  const { result } = await fromChunks([{ output: events.map(e => JSON.stringify(e) + '\n').join(''), exit_code: 0 }]);
  assert.equal(result.ok, false); assert.equal(result.complete, true);
  assert.equal(result.code, 'UNVERIFIED_EVENTS'); assert.deepEqual(result.events, events);
});

test('no phase result is committed when teardown cannot be confirmed', async () => {
  for (const stop of [async () => false, async () => { throw Error(sentinel); }, () => new Promise(() => {})]) {
    const { result } = await fromChunks([{ output: wire, exit_code: 0 }], { stop, stopTimeoutMs: 20 });
    assert.equal(result.code, 'TEARDOWN_UNCONFIRMED'); assert.equal(result.ok, false);
    assert.equal(result.stopConfirmed, false); assert.deepEqual(result.events, []); noLeak(result);
  }
});

test('duplicate, order, overflow, unknown schema and impossible statuses reject', async () => {
  const first = JSON.stringify(SYNTHETIC_EVENTS[0]) + '\n';
  for (const [output, code] of [
    [first + wire, 'UNEXPECTED_EVENT'],
    [JSON.stringify(SYNTHETIC_EVENTS[1]) + '\n', 'UNEXPECTED_EVENT'],
    ['x'.repeat(65537), 'OVERFLOW'],
    ['{"unexpected":true}\n', 'INVALID_RECORD'],
    [first + JSON.stringify({ ...SYNTHETIC_EVENTS[1], status: 400 }) + '\n', 'INVALID_RECORD'],
    ['\x1b[2J' + wire, 'UNSUPPORTED_ANSI'],
  ]) {
    const { result } = await fromChunks([{ output, exit_code: 0 }]);
    assert.equal(result.code, code); assert.equal(result.ok, false); assert.deepEqual(result.events, []);
  }
});

test('native PIPE: every fixed synthetic scenario has bounded observed teardown', { timeout: 30000 }, async () => {
  const success = new Set(['no_echo', 'fragmented', 'crlf', 'sgr']);
  const expectedCodes = { echo: ['INVALID_RECORD'], malformed: ['INVALID_RECORD'], overflow: ['OVERFLOW'],
    partial_eof: ['INCOMPLETE_FRAME'], zero_without_proof: ['INCOMPLETE_PHASE'], nonzero: ['NONZERO_EXIT'],
    timeout: ['DEADLINE'], duplicate: ['UNEXPECTED_EVENT'], order: ['UNEXPECTED_EVENT'], wrong_status: ['INVALID_RECORD'] };
  for (const scenario of SYNTHETIC_SCENARIOS) {
    const result = await runSyntheticPipe(scenario, scenario === 'timeout' ? 250 : 2500);
    assert.equal(result.evidenceClass, 'SYNTHETIC_NATIVE_PIPE_ONLY');
    assert.equal(result.ok, success.has(scenario), scenario);
    assert.equal(result.stopConfirmed, true, scenario);
    assert.equal(result.processClosedObserved, true, scenario);
    assert.equal(result.expectedOutcomeMatched, true, scenario);
    assert.equal(result.networkCalls, 0); assert.equal(result.hostedAcceptance, false);
    if (!success.has(scenario)) assert.ok(expectedCodes[scenario].includes(result.code), scenario);
  }
});

test('synthetic runner cannot select arbitrary executables, scenarios or timeouts', async () => {
  assert.throws(() => createSyntheticPipe(sentinel), /^Error: INVALID_SYNTHETIC_SCENARIO$/);
  await assert.rejects(runSyntheticPipe('no_echo', Infinity), /^Error: INVALID_SYNTHETIC_TIMEOUT$/);
});

test('source boundary: no network/helper launch or credential environment forwarding', () => {
  const source = readFileSync(new URL('../scripts/fill_uat_transport.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\s*\(|node:(?:https?|net|tls)|httpx|f1-readonly-validator|--hosted-owner-approved/);
  assert.doesNotMatch(source, /\.\.\.process\.env|env:\s*process\.env|console\.(?:log|error)\(.*(?:chunk|output|command)/);
});
