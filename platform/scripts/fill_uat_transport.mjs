// OFFLINE synthetic transport/readout only. No HTTP, Auth, credentials, helper
// launch, environment credential forwarding, terminal mode change or live adapter.
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SafeEventReadout, SafeEventsError, MAX_PHASE_BYTES } from './fill_uat_safe_events.mjs';

export const MAX_PHASE_MS = 30_000;
export const MAX_STOP_MS = 2_000;
export const SYNTHETIC_MAX_MS = 20_000;
export const SYNTHETIC_SENTINEL = 'SYNTHETIC_SENTINEL';
export const SYNTHETIC_SCENARIOS = Object.freeze([
  'no_echo', 'fragmented', 'crlf', 'sgr', 'echo', 'malformed', 'overflow',
  'partial_eof', 'zero_without_proof', 'nonzero', 'timeout', 'duplicate',
  'order', 'wrong_status',
]);
const PARSER_CODES = new Set([
  'INVALID_EXPECTATIONS', 'AMBIGUOUS_EXPECTATIONS', 'INVALID_CHUNK', 'OVERFLOW',
  'UNSUPPORTED_CHARACTER', 'UNSUPPORTED_ANSI', 'ANSI_OVERFLOW', 'BARE_CR',
  'INVALID_RECORD', 'UNEXPECTED_EVENT', 'INCOMPLETE_FRAME', 'INCOMPLETE_PHASE', 'PHASE_CLOSED',
]);
const SELF = fileURLToPath(import.meta.url);
const PIPE_SUCCESS = new Set(['no_echo', 'fragmented', 'crlf', 'sgr']);
const PIPE_REJECTION = Object.freeze({ echo: 'INVALID_RECORD', malformed: 'INVALID_RECORD', overflow: 'OVERFLOW',
  partial_eof: 'INCOMPLETE_FRAME', zero_without_proof: 'INCOMPLETE_PHASE', nonzero: 'NONZERO_EXIT', timeout: 'DEADLINE',
  duplicate: 'UNEXPECTED_EVENT', order: 'UNEXPECTED_EVENT', wrong_status: 'INVALID_RECORD' });

class PhaseFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function failure(code) { throw new PhaseFailure(code); }
function parserCode(error) {
  try { return error instanceof SafeEventsError && PARSER_CODES.has(error.code) ? error.code : 'READOUT_FAILED'; }
  catch { return 'READOUT_FAILED'; }
}
async function bounded(operation, milliseconds, timeoutCode) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new PhaseFailure(timeoutCode)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

/**
 * read({signal, timeoutMs}) -> {output:string, exit_code?:integer, eof?:boolean}.
 * A zero process exit is required; silence/ready/event count is NOT phase-close.
 * stop({reason}) -> true only after closure is observed. No raw input escapes.
 * deadline is ONE caller-supplied absolute monotonic deadline, never renewed.
 * This deliberately is not an adapter for the long-lived hosted helper.
 */
export async function readSafeEventPhase({ expected, read, stop, deadline,
  now = () => performance.now(), maxReads = 1024, stopTimeoutMs = 1000 } = {}) {
  let parser, code = 'INVALID_OPTIONS', complete = false, events = [], reads = 0, stopConfirmed = false;
  let previous = -Infinity;
  const controller = new AbortController();
  function clock() {
    let value;
    try { value = now(); } catch { failure('CLOCK_INVALID'); }
    if (!Number.isFinite(value)) failure('CLOCK_INVALID');
    if (value < previous) failure('CLOCK_REVERSED');
    previous = value;
    return value;
  }
  try {
    if (typeof read !== 'function' || typeof stop !== 'function' || typeof now !== 'function' ||
        !Number.isFinite(deadline) || !Number.isInteger(maxReads) || maxReads < 1 || maxReads > 4096 ||
        !Number.isInteger(stopTimeoutMs) || stopTimeoutMs < 1 || stopTimeoutMs > MAX_STOP_MS) failure('INVALID_OPTIONS');
    const remaining = deadline - clock();
    if (remaining <= 0) failure('DEADLINE');
    if (remaining > MAX_PHASE_MS) failure('INVALID_OPTIONS');
    try { parser = new SafeEventReadout(expected); } catch (error) { failure(parserCode(error)); }
    for (;;) {
      const budget = deadline - clock();
      if (budget <= 0) failure('DEADLINE');
      if (reads >= maxReads) failure('READ_LIMIT');
      reads++;
      let chunk;
      try {
        chunk = await bounded(() => read({ signal: controller.signal, timeoutMs: budget }), budget, 'DEADLINE');
      } catch (error) {
        if (error instanceof PhaseFailure && error.code === 'DEADLINE') throw error;
        failure('READ_FAILED');
      }
      if (clock() >= deadline) failure('DEADLINE');
      if (!chunk || typeof chunk !== 'object') failure('INVALID_CHUNK');
      if (chunk.transport_error === 'OVERFLOW') failure('OVERFLOW');
      if (chunk.transport_error) failure('READ_FAILED');
      if (chunk.stderr) failure('STDERR_PRESENT');
      const exit = chunk.exit_code;
      if (exit !== undefined && exit !== null && !Number.isInteger(exit)) failure('INVALID_EXIT');
      if (exit !== undefined && exit !== null && exit !== 0) failure('NONZERO_EXIT');
      try { parser.feed(chunk.output); } catch (error) { failure(parserCode(error)); }
      if (exit === 0) {
        try { events = parser.finish(); } catch (error) { failure(parserCode(error)); }
        code = events.every(event => event.verified) ? 'OK' : 'UNVERIFIED_EVENTS';
        complete = true; break;
      }
      if (chunk.eof === true) failure('EOF_WITHOUT_EXIT');
    }
  } catch (error) {
    code = error instanceof PhaseFailure ? error.code : 'READOUT_FAILED';
    events = [];
  } finally {
    controller.abort();
    parser?.clear();
    if (typeof stop === 'function') {
      const cleanupBudget = Number.isInteger(stopTimeoutMs) && stopTimeoutMs > 0 && stopTimeoutMs <= MAX_STOP_MS ? stopTimeoutMs : MAX_STOP_MS;
      try { stopConfirmed = await bounded(() => stop({ reason: code }), cleanupBudget, 'STOP_TIMEOUT') === true; }
      catch { stopConfirmed = false; }
    }
  }
  if (!stopConfirmed) { complete = false; events = []; if (code === 'OK' || code === 'UNVERIFIED_EVENTS') code = 'TEARDOWN_UNCONFIRMED'; }
  return Object.freeze({ ok: complete && code === 'OK', complete, code, events: Object.freeze(events), reads,
    phaseClosed: true, stopConfirmed });
}

export const SYNTHETIC_EVENTS = Object.freeze([
  Object.freeze({ label: '', route: 'ready', status: 0, request_id: '', verified: true, denied: false }),
  Object.freeze({ label: 'canary', route: 'me', status: 401,
    request_id: '00000000-0000-4000-8000-000000000001', verified: true, denied: true }),
  Object.freeze({ label: 'canary', route: 'denied_login', status: 400,
    request_id: '', verified: true, denied: true }),
]);
export const SYNTHETIC_EXPECTED = Object.freeze(SYNTHETIC_EVENTS.map(({ label, route }) => Object.freeze({ label, route })));

// Fixed self-only executable/scenarios; never accepts a command/path/env override.
export function createSyntheticPipe(scenario) {
  if (!SYNTHETIC_SCENARIOS.includes(scenario)) throw new Error('INVALID_SYNTHETIC_SCENARIO');
  const child = spawn(process.execPath, [SELF, '--synthetic-producer'], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
  });
  const queue = [];
  let pending, queuedBytes = 0, closed = false, overflow = false, stopping = false;
  let observeClose;
  const closeObserved = new Promise(resolveClose => { observeClose = resolveClose; });
  function deliver(value) {
    if (pending) { const resolveRead = pending; pending = undefined; resolveRead(value); }
    else queue.push(value);
  }
  child.stdout.on('data', data => {
    if (overflow || closed || stopping) return;
    if (queuedBytes + data.length > MAX_PHASE_BYTES) {
      overflow = true; queue.length = 0; queuedBytes = 0;
      deliver({ output: '', transport_error: 'OVERFLOW' }); return;
    }
    queuedBytes += data.length;
    deliver({ output: data.toString('utf8') });
  });
  child.stderr.on('data', () => { if (!stopping) deliver({ output: '', stderr: true }); }); // Drain, never retain error text.
  child.once('error', () => deliver({ output: '', transport_error: 'SPAWN_FAILED' }));
  child.once('close', code => {
    closed = true;
    deliver({ output: '', exit_code: Number.isInteger(code) ? code : 1, eof: true });
    observeClose(true);
  });
  child.stdin.on('error', () => {}); // Fixed synthetic command only; never print an EPIPE object.
  child.stdin.end(`${SYNTHETIC_SENTINEL}:${scenario}\n`);
  async function read({ signal }) {
    if (queue.length) {
      const value = queue.shift(); queuedBytes -= value.output?.length || 0; return value;
    }
    if (closed || signal.aborted) return { output: '', eof: true };
    return await new Promise(resolveRead => {
      const aborted = () => { pending = undefined; resolveRead({ output: '', eof: true }); };
      pending = value => { signal.removeEventListener('abort', aborted); queuedBytes -= value.output?.length || 0; resolveRead(value); };
      signal.addEventListener('abort', aborted, { once: true });
    });
  }
  async function stop() {
    stopping = true;
    queue.length = 0; queuedBytes = 0;
    if (!closed) child.kill();
    await closeObserved;
    return closed;
  }
  return Object.freeze({ read, stop, get closed() { return closed; } });
}

export async function runSyntheticPipe(scenario, timeoutMs = 1500) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PHASE_MS) throw new Error('INVALID_SYNTHETIC_TIMEOUT');
  const pipe = createSyntheticPipe(scenario);
  const result = await readSafeEventPhase({ expected: SYNTHETIC_EXPECTED, read: pipe.read, stop: pipe.stop,
    deadline: performance.now() + timeoutMs });
  return Object.freeze({ evidenceClass: 'SYNTHETIC_NATIVE_PIPE_ONLY', scenario, ...result,
    expectedOutcomeMatched: PIPE_SUCCESS.has(scenario) ? result.ok : !result.ok && result.code === PIPE_REJECTION[scenario],
    processClosedObserved: pipe.closed, networkCalls: 0, hostedAcceptance: false });
}

// Standalone producer: stdin accepts ONLY the literal sentinel + allowlisted
// scenario; no config/user/run/password/token fields or arbitrary payload exist.
async function syntheticProducer() {
  const watchdog = setTimeout(() => process.exit(70), SYNTHETIC_MAX_MS);
  const write = text => new Promise(resolveWrite => process.stdout.write(text, resolveWrite));
  const line = event => JSON.stringify(event) + '\n';
  await write(line(SYNTHETIC_EVENTS[0]));
  let command = '', done = false;
  process.stdin.setEncoding('utf8');
  const scenario = await new Promise(resolveScenario => {
    process.stdin.on('data', chunk => {
      if (done) return;
      if (chunk.length > 128 - command.length) { done = true; command = ''; resolveScenario(null); return; }
      command += chunk;
      const end = command.indexOf('\n');
      if (end < 0) return;
      const value = command.slice(0, end).replace(/\r$/, ''), trailing = command.slice(end + 1);
      done = true; command = '';
      const prefix = `${SYNTHETIC_SENTINEL}:`;
      resolveScenario(!trailing && value.startsWith(prefix) && SYNTHETIC_SCENARIOS.includes(value.slice(prefix.length)) ? value.slice(prefix.length) : null);
    });
    process.stdin.once('end', () => { if (!done) { done = true; command = ''; resolveScenario(null); } });
  });
  if (!scenario) { clearTimeout(watchdog); process.exit(64); }
  if (scenario === 'timeout') return; // Watchdog is independent from the reader deadline.
  if (scenario === 'zero_without_proof') { clearTimeout(watchdog); process.exit(0); }
  const first = line(SYNTHETIC_EVENTS[1]), second = line(SYNTHETIC_EVENTS[2]);
  let wire = first + second;
  if (scenario === 'crlf') wire = wire.replace(/\n/g, '\r\n');
  if (scenario === 'sgr') wire = '\x1b[31m' + first + '\x1b[0m' + second;
  if (scenario === 'echo') wire = `${SYNTHETIC_SENTINEL}\n` + wire;
  if (scenario === 'malformed') wire = '{invalid}\n';
  if (scenario === 'overflow') wire = 'x'.repeat(MAX_PHASE_BYTES + 1);
  if (scenario === 'partial_eof') wire = first.slice(0, 43);
  if (scenario === 'duplicate') wire = first + first + second;
  if (scenario === 'order') wire = second + first;
  if (scenario === 'wrong_status') wire = line({ ...SYNTHETIC_EVENTS[2], status: 200, denied: false });
  if (scenario === 'fragmented' || scenario === 'sgr') {
    for (let index = 0; index < wire.length; index += 7) {
      await write(wire.slice(index, index + 7));
      await new Promise(resolveTick => setTimeout(resolveTick, 2));
    }
  } else await write(wire);
  clearTimeout(watchdog);
  process.exit(scenario === 'nonzero' ? 7 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  if (process.argv.length === 3 && process.argv[2] === '--synthetic-producer') {
    await syntheticProducer();
  } else if (process.argv.length === 3 && process.argv[2] === '--synthetic-pipe-check') {
    const reports = [];
    for (const scenario of SYNTHETIC_SCENARIOS) reports.push(await runSyntheticPipe(scenario, scenario === 'timeout' ? 250 : 1500));
    console.log(JSON.stringify({ evidenceClass: 'SYNTHETIC_NATIVE_PIPE_ONLY', node: process.version, platform: process.platform, reports }));
    process.exitCode = reports.every(r => r.expectedOutcomeMatched && r.processClosedObserved && r.stopConfirmed) ? 0 : 1;
  } else {
    console.log(JSON.stringify({ evidenceClass: 'SYNTHETIC_ONLY', code: 'INVALID_SYNTHETIC_ARGUMENTS' }));
    process.exitCode = 64;
  }
}
