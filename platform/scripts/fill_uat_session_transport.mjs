// SYNTHETIC ONLY: persistent fixed producer. Never a live helper/secret adapter.
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { SafeEventReadout, SafeEventsError } from './fill_uat_safe_events.mjs';
import { PHASES, SCENARIOS, EVENTS } from './fill_uat_synthetic_session.mjs';

export const MAX_SESSION_BYTES = 65_536;
export const MAX_SESSION_MS = 18_000;
export const MAX_PHASE_MS = 5_000;
export const MAX_STOP_MS = 2_000;
const FRAME = /^FMC_SYNTHETIC\/1 ([0-9a-f]{32}) ([0-5]) (hello|configure|positive|negative|operator_simulation|close) (begin|end)$/;
const PARSER_CODES = new Set(['INVALID_CHUNK', 'OVERFLOW', 'UNSUPPORTED_CHARACTER', 'UNSUPPORTED_ANSI',
  'ANSI_OVERFLOW', 'BARE_CR', 'INVALID_RECORD', 'UNEXPECTED_EVENT', 'INCOMPLETE_FRAME', 'INCOMPLETE_PHASE']);
class Failure extends Error { constructor(code) { super(code); this.code = code; } }
function reject(code) { throw new Failure(code); }
function timings(lifetimeMs, phaseMs, stopMs) {
  if (!Number.isInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_SESSION_MS ||
      !Number.isInteger(phaseMs) || phaseMs < 1 || phaseMs > MAX_PHASE_MS ||
      !Number.isInteger(stopMs) || stopMs < 1 || stopMs > MAX_STOP_MS) reject('INVALID_OPTIONS');
}
async function bounded(operation, ms, code) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation),
    new Promise((_, fail) => { timer = setTimeout(() => fail(new Failure(code)), Math.max(1, ms)); })]); }
  finally { clearTimeout(timer); }
}

// Exported for deterministic offline adapters/tests. Writes are ONLY fixed phase
// commands; callbacks cannot supply arbitrary config or change the producer path.
export class SyntheticSessionReadout {
  #transport; #now; #previous = -Infinity; #deadline; #phaseMs; #stopMs;
  #index = 0; #identity = ''; #bytes = 0; #line = ''; #parser;
  #busy = false; #fatal = ''; #closed = false; #stopPromise; #stopConfirmed = false;
  #timer; #controller = new AbortController();
  constructor(transport, { lifetimeMs = 16_000, phaseMs = 3_000, stopMs = 1_000, now = () => performance.now() } = {}) {
    if (!transport || !['read', 'write', 'stop'].every(key => typeof transport[key] === 'function') ||
        typeof now !== 'function') reject('INVALID_OPTIONS');
    timings(lifetimeMs, phaseMs, stopMs);
    this.#transport = transport; this.#now = now; this.#phaseMs = phaseMs; this.#stopMs = stopMs;
    this.#deadline = this.#clock() + lifetimeMs;
    this.#timer = setTimeout(() => { void this.abort('SESSION_DEADLINE'); }, lifetimeMs);
    transport.observe?.(code => { void this.abort(code === 'STDERR_PRESENT' ? code : code === 'OVERFLOW' ? code : 'TRANSPORT_FAILED'); },
      () => { if (this.#index > 0 && !this.#busy && !this.#closed) void this.abort('UNEXPECTED_OUTPUT'); },
      () => { if (!this.#busy && !this.#closed) void this.abort('UNEXPECTED_EXIT'); });
  }
  #clock() {
    let value;
    try { value = this.#now(); } catch { reject('CLOCK_INVALID'); }
    if (!Number.isFinite(value)) reject('CLOCK_INVALID');
    if (value < this.#previous) reject('CLOCK_REVERSED');
    this.#previous = value; return value;
  }
  get snapshot() {
    return Object.freeze({ evidenceClass: 'SYNTHETIC_SESSION_ONLY', identity: this.#identity,
      completedPhases: this.#index, fatal: this.#fatal, closed: this.#closed,
      stopConfirmed: this.#stopConfirmed, deadline: this.#deadline, bytes: this.#bytes,
      processId: Number.isInteger(this.#transport.pid) ? this.#transport.pid : null,
      processClosedObserved: this.#transport.closed === true, hostedAcceptance: false });
  }
  async #stop(force) {
    if (!this.#stopPromise) {
      clearTimeout(this.#timer); this.#controller.abort();
      this.#parser?.clear(); this.#parser = undefined; this.#line = '';
      this.#stopPromise = (async () => {
        try { this.#stopConfirmed = await bounded(() => this.#transport.stop({ force }), this.#stopMs, 'STOP_TIMEOUT') === true; }
        catch { this.#stopConfirmed = false; }
        this.#closed = true;
        return this.#stopConfirmed;
      })();
    }
    return this.#stopPromise;
  }
  async abort(code = 'ABORTED') {
    const codes = new Set(['ABORTED', 'SESSION_DEADLINE', 'STDERR_PRESENT', 'OVERFLOW', 'UNEXPECTED_OUTPUT', 'UNEXPECTED_EXIT', 'TRANSPORT_FAILED']);
    if (!this.#fatal && !this.#closed) this.#fatal = codes.has(code) ? code : 'ABORTED';
    await this.#stop(true);
    return this.snapshot;
  }
  async phase(phase) {
    if (this.#busy) { await this.abort('ABORTED'); return this.#result(phase, false, 'CONCURRENT_PHASE'); }
    if (this.#fatal || this.#closed) return this.#result(phase, false, this.#fatal || 'SESSION_CLOSED');
    this.#busy = true;
    let events = [], complete = false, code = 'READOUT_FAILED', began = false, ended = false, closeExitSeen = false;
    try {
      if (phase !== PHASES[this.#index]) reject('PHASE_ORDER');
      const phaseDeadline = Math.min(this.#deadline, this.#clock() + this.#phaseMs);
      const budget = () => {
        if (this.#fatal) reject(this.#fatal);
        const time = this.#clock();
        if (time >= this.#deadline) reject('SESSION_DEADLINE');
        if (time >= phaseDeadline) reject('PHASE_DEADLINE');
        return phaseDeadline - time;
      };
      this.#parser = new SafeEventReadout(EVENTS[phase].map(({ label, route }) => ({ label, route })));
      await bounded(() => this.#transport.write(`SYNTHETIC_SENTINEL:${phase}\n`, { signal: this.#controller.signal }), budget(), 'PHASE_DEADLINE');
      budget();
      for (let reads = 0; ; reads++) {
        if (reads >= 1024) reject('READ_LIMIT');
        const chunk = await bounded(() => this.#transport.read({ signal: this.#controller.signal }), budget(), 'PHASE_DEADLINE');
        budget();
        if (!chunk || typeof chunk.output !== 'string') reject('INVALID_CHUNK');
        if (chunk.stderr) reject('STDERR_PRESENT');
        if (chunk.error) reject(chunk.error === 'OVERFLOW' ? 'OVERFLOW' : 'TRANSPORT_FAILED');
        if (chunk.exit_code !== undefined && (!Number.isInteger(chunk.exit_code) || chunk.exit_code !== 0)) reject('NONZERO_EXIT');
        if (chunk.output.length > MAX_SESSION_BYTES - this.#bytes) reject('OVERFLOW');
        this.#bytes += chunk.output.length;
        for (const char of chunk.output) {
          const n = char.charCodeAt(0);
          if (n > 126 || (n < 32 && ![9, 10, 13, 27].includes(n))) reject('UNSUPPORTED_CHARACTER');
          this.#line += char;
          if (char !== '\n') continue;
          let line = this.#line.slice(0, -1); this.#line = '';
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (ended) reject('TRAILING_OUTPUT');
          if (line.startsWith('FMC_SYNTHETIC/1 ')) {
            const m = FRAME.exec(line);
            if (!m) reject('INVALID_BOUNDARY');
            const [, identity, sequence, name, boundary] = m;
            if (!this.#identity) {
              if (this.#index !== 0 || began || sequence !== '0' || name !== 'hello' || boundary !== 'begin') reject('MISSING_HELLO');
              this.#identity = identity; continue;
            }
            if (identity !== this.#identity) reject('CORRELATION');
            if (Number(sequence) !== this.#index + 1 || name !== phase) reject('PHASE_FENCE');
            if (boundary === 'begin') { if (began) reject('DUPLICATE_BOUNDARY'); began = true; }
            else { if (!began) reject('MISSING_BEGIN'); events = this.#parser.finish(); ended = true; }
          } else {
            if (!began) reject('MISSING_BEGIN');
            this.#parser.feed(line + '\n');
          }
        }
        if (ended) {
          if (this.#line) reject('TRAILING_OUTPUT');
          if (phase !== 'close' && (chunk.eof || chunk.exit_code !== undefined)) reject('EARLY_EXIT');
          if (phase === 'close' && (chunk.eof || chunk.exit_code !== undefined)) {
            if (chunk.exit_code !== 0 || chunk.eof !== true) reject('INCOMPLETE_EXIT');
            closeExitSeen = true;
          }
          if (this.#transport.pendingOutput === true) reject('TRAILING_OUTPUT');
          break;
        }
        if (chunk.eof || chunk.exit_code !== undefined) reject('INCOMPLETE_PHASE');
      }
      this.#parser?.clear(); this.#parser = undefined;
      code = events.every(e => e.verified) ? 'OK' : 'UNVERIFIED_EVENTS';
      complete = true;
      if (phase === 'close') {
        // A boundary is not a process close. Require the separate exit receipt.
        for (let reads = 0; !closeExitSeen; reads++) {
          if (reads >= 1024) reject('READ_LIMIT');
          const tail = await bounded(() => this.#transport.read({ signal: this.#controller.signal }), budget(), 'PHASE_DEADLINE');
          budget();
          if (!tail || tail.output !== '' || tail.stderr || tail.error) reject('TRAILING_OUTPUT');
          if (tail.exit_code === 0 && tail.eof === true) break;
          if (tail.exit_code !== undefined || tail.eof) reject('NONZERO_EXIT');
        }
        if (!await this.#stop(false)) reject('TEARDOWN_UNCONFIRMED');
      } else if (code !== 'OK') {
        this.#fatal = code; await this.#stop(true);
      }
      if (this.#fatal && this.#fatal !== 'UNVERIFIED_EVENTS') reject(this.#fatal);
      this.#index++;
    } catch (error) {
      code = error instanceof Failure ? error.code : error instanceof SafeEventsError && PARSER_CODES.has(error.code) ? error.code : 'READOUT_FAILED';
      this.#fatal ||= code; events = []; complete = false;
      await this.#stop(true);
    } finally {
      this.#parser?.clear(); this.#parser = undefined; this.#line = ''; this.#busy = false;
    }
    if (this.#closed && !this.#stopConfirmed) { complete = false; events = []; code = 'TEARDOWN_UNCONFIRMED'; }
    return this.#result(phase, complete, code, events);
  }
  #result(phase, complete, code, events = []) {
    // Do not echo unknown caller input. Phase names themselves are allowlisted.
    return Object.freeze({ phase: PHASES.includes(phase) ? phase : '', complete, ok: complete && code === 'OK',
      code, events: Object.freeze(events), ...this.snapshot });
  }
}

export function createSyntheticSession(scenario = 'normal', options) {
  if (!SCENARIOS.includes(scenario)) reject('INVALID_SCENARIO');
  // Validate before spawning. No external executable/path/environment is accepted.
  if (options !== undefined && (!options || Object.getPrototypeOf(options) !== Object.prototype ||
      Object.keys(options).some(key => !['lifetimeMs', 'phaseMs', 'stopMs'].includes(key)))) reject('INVALID_OPTIONS');
  timings(options?.lifetimeMs ?? 16_000, options?.phaseMs ?? 3_000, options?.stopMs ?? 1_000);
  // The persistent tool has no global process. CTO-approved fallback is ONLY
  // the fixed executable name, never a guessed path or caller-provided command.
  const executable = typeof process !== 'undefined' ? process.execPath : 'node';
  const child = spawn(executable, [fileURLToPath(new URL('./fill_uat_synthetic_session.mjs', import.meta.url)), scenario], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: typeof process !== 'undefined' && process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
  });
  let closed = false, stopping = false, pending, bytes = 0, fatalObserver, outputObserver, exitObserver;
  const queue = []; let resolveClose;
  const closeObserved = new Promise(resolve => { resolveClose = resolve; });
  function deliver(value) {
    if (pending) { const receive = pending; pending = undefined; receive(value); }
    else queue.push(value);
  }
  function fatal(code) { queue.length = 0; bytes = 0; deliver({ output: '', error: code }); fatalObserver?.(code); }
  child.stdout.on('data', data => {
    if (stopping || closed) return;
    outputObserver?.();
    if (stopping) return;
    if (data.length > MAX_SESSION_BYTES - bytes) return fatal('OVERFLOW');
    bytes += data.length; deliver({ output: data.toString('utf8') });
  });
  child.stderr.on('data', () => { if (!stopping) fatal('STDERR_PRESENT'); }); // Drain; retain no stderr bytes.
  child.on('error', () => fatal('TRANSPORT_FAILED'));
  child.stdin.on('error', () => { if (!stopping) fatal('TRANSPORT_FAILED'); });
  child.once('close', code => {
    closed = true; deliver({ output: '', exit_code: Number.isInteger(code) ? code : 1, eof: true }); resolveClose(true); exitObserver?.();
  });
  const transport = {
    observe(onFatal, onOutput, onExit) { fatalObserver = onFatal; outputObserver = onOutput; exitObserver = onExit; },
    get closed() { return closed; },
    get pid() { return child.pid; },
    get pendingOutput() { return queue.some(value => value.output?.length); },
    write(command, { signal }) {
      if (signal.aborted || stopping || closed || !PHASES.some(phase => command === `SYNTHETIC_SENTINEL:${phase}\n`)) reject('WRITE_FAILED');
      return new Promise((resolve, fail) => child.stdin.write(command, error => error ? fail(new Failure('WRITE_FAILED')) : resolve()));
    },
    async read({ signal }) {
      if (queue.length) { const value = queue.shift(); bytes -= value.output?.length || 0; return value; }
      if (closed || signal.aborted) return { output: '', eof: true };
      if (pending) reject('CONCURRENT_READ');
      return await new Promise(resolve => {
        const aborted = () => { pending = undefined; resolve({ output: '', eof: true }); };
        pending = value => { signal.removeEventListener('abort', aborted); bytes -= value.output?.length || 0; resolve(value); };
        signal.addEventListener('abort', aborted, { once: true });
      });
    },
    async stop({ force }) {
      stopping = true; queue.length = 0; bytes = 0;
      if (!closed && force) child.kill();
      await closeObserved; return closed;
    },
  };
  return new SyntheticSessionReadout(transport, options);
}
