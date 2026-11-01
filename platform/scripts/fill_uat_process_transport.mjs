// Reviewed-process transport PREPARATION. Import never launches anything.
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { lstat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { HelperCollector } from './fill_uat_helper_collector.mjs';
import { copyDto, exact, frozen, validateBinding, validateAuthority, bindingMatches, instant } from './fill_uat_evidence_verdict.mjs';
import { publicFixture, SCENARIOS } from './fill_uat_synthetic_wire_child.mjs';

const SELF = fileURLToPath(import.meta.url), ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Engineering cache bounds, NOT owner/Decision requirements. The checker must
// read an externally maintained checkpoint, never re-stamp stale observations.
export const PERMIT_FRESH_MS = 10000;
export const PERMIT_TIMEOUT_MS = 2000;
export const PERMIT_POLL_MS = 1000;
const FIXED_FILES = Object.freeze([
  ['helper', resolve(ROOT, '.work/f1-readonly-validator.py'), '6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548'],
  ['python', resolve(ROOT, '.work/f1-auth-admin-venv/Scripts/python.exe'), '9f29b8965d6bf169315bbc20946f33b23c9dacb4587c3cccaf1f536b844b2dc2'],
  ['venv_config', resolve(ROOT, '.work/f1-auth-admin-venv/pyvenv.cfg'), 'fb495c656cb2605b9acdaa9e32df46ba855ea4470a0568a25ec962dcb79d1a31'],
  ['base_python', 'C:/Users/Thinkpad X1 Gen7/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe', 'f8b45d63047da9d9adf09892e4cc4317b859e86a93a478cc9616bc69d3b176e5'],
  ['collector', fileURLToPath(new URL('./fill_uat_helper_collector.mjs', import.meta.url)), '4751a40941ddb9379e6d7efc96f6b8e207fc3aa7d45d9e1965c623cb891cad04'],
  ['verdict', fileURLToPath(new URL('./fill_uat_evidence_verdict.mjs', import.meta.url)), '7537808996568eeef8f0b0943926120c9159f6197a5e06448ae04ff6776e6d69'],
  ['parser', fileURLToPath(new URL('./fill_uat_safe_events.mjs', import.meta.url)), 'f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a'],
]);
const CODES = new Set(('INVALID_OPTIONS WRITE_REJECTED CONCURRENT_WRITE CONCURRENT_READ ABORTED READ_ABORTED WRITE_FAILED STDERR_PRESENT OUTPUT_LIMIT UNSUPPORTED_OUTPUT SPAWN_FAILED PROCESS_ERROR ORIGINAL_DEADLINE PERMIT_REQUIRED PERMIT_REJECTED PERMIT_STALE PERMIT_REVOKED PERMIT_FAILED PERMIT_TIMEOUT HASH_MISMATCH FILE_BINDING_REJECTED LIVE_PLATFORM_REJECTED WRITE_TIMEOUT STOP_UNCONFIRMED').split(' '));
class TransportError extends Error { constructor(code) { super('Process transport rejected.'); this.code = CODES.has(code) ? code : 'PROCESS_ERROR'; } }
function setupError(code, child, observed) {
  const error = new TransportError(code);
  Object.assign(error, { spawnAttempted: !!child, processLaunched: Number.isInteger(child?.pid), processId: Number.isInteger(child?.pid) ? child.pid : null,
    processClosedObserved: observed, stopConfirmed: observed, accountCleanupVerified: false });
  return error;
}
function requireSafe(ok, code = 'INVALID_OPTIONS') { if (!ok) throw new TransportError(code); }
async function bounded(fn, ms, code) {
  let timer; try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TransportError(code)), Math.max(1, ms));
  })]); } finally { clearTimeout(timer); }
}
const environment = () => typeof process !== 'undefined' && process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
// Bind BOTH immediately after spawn, before constructors or any await. The
// error object is deliberately ignored; only an observation bit survives.
export function observeOwnedChild(child) {
  let closed = false, failed = false;
  child.on('error', () => { failed = true; });
  const done = new Promise(resolveClose => child.once('close', () => { closed = true; resolveClose(true); }));
  return Object.freeze({ done, get closed() { return closed; }, get spawnErrorObserved() { return failed; } });
}
async function stopUnattachedChild(child, observed, stopMs) {
  child.once('error', () => {});
  try { child.stdin?.destroy(); } catch { /* Killing is still required. */ }
  try { child.kill(); } catch { /* A throw/return is never close evidence. */ }
  try { return await bounded(() => observed, stopMs, 'STOP_UNCONFIRMED') === true; } catch { return false; }
}

// Stream-level injection for offline tests; this class CANNOT choose/launch a
// target. Only the two fixed factories below create processes.
export class OwnedStdioTransport {
  #child; #deadline; #clock; #last; #timer; #stopMs; #queue = []; #queued = 0; #ingress = 0;
  #closed = false; #stdoutEOF = false; #exitSeen = false; #exitCode; #stopping = false; #fatal = '';
  #pending; #writing = false; #writeAbort; #closePromise; #closeResolve; #stopPromise;
  #onFatal; #onOutput; #onExit; #permit; #permitTimer; #checking = false; #epoch = -1;
  constructor(child, { deadlineMono, monotonic = () => performance.now(), stopMs = 1000, checkPermit, initialEpoch = 0 } = {}) {
    requireSafe(child?.stdin && child.stdout && child.stderr && typeof child.kill === 'function' && typeof monotonic === 'function');
    const start = monotonic(); requireSafe(Number.isFinite(start) && Number.isFinite(deadlineMono) && deadlineMono > start && deadlineMono - start <= 1800000 && Number.isInteger(stopMs) && stopMs >= 1 && stopMs <= 2000);
    requireSafe((checkPermit === undefined || typeof checkPermit === 'function') && Number.isInteger(initialEpoch) && initialEpoch >= 0);
    this.#child = child; this.#deadline = deadlineMono; this.#clock = monotonic; this.#last = start; this.#stopMs = stopMs; this.#permit = checkPermit; this.#epoch = initialEpoch;
    this.#closePromise = new Promise(resolveClose => { this.#closeResolve = resolveClose; });
    try {
    child.stdout.on('data', data => {
      if (this.#stopping || this.#closed) return;
      this.#notify(this.#onOutput); if (this.#stopping) return;
      if (!Buffer.isBuffer(data)) { this.#fail('UNSUPPORTED_OUTPUT'); return; }
      if (data.length > 65536 - this.#ingress || data.length > 65536 - this.#queued || this.#queue.length >= 256) { this.#fail('OUTPUT_LIMIT'); return; }
      this.#ingress += data.length;
      if (data.some(byte => byte > 127)) { this.#fail('UNSUPPORTED_OUTPUT'); return; }
      this.#queued += data.length; this.#deliver({ output: data.toString('ascii') });
    });
    child.stdout.once('end', () => { this.#stdoutEOF = true; });
    child.stdout.on('error', () => this.#fail('PROCESS_ERROR'));
    child.stderr.on('data', () => { if (!this.#stopping) this.#fail('STDERR_PRESENT'); }); // Drain; never retain text.
    child.stderr.on('error', () => this.#fail('PROCESS_ERROR'));
    child.once('error', () => this.#fail('SPAWN_FAILED'));
    child.stdin.on('error', () => { if (!this.#stopping) this.#fail('WRITE_FAILED'); });
    child.once('exit', code => { this.#exitSeen = true; this.#exitCode = Number.isInteger(code) ? code : null; });
    child.once('close', code => {
      this.#closed = true; this.#stdoutEOF = true; this.#exitCode = Number.isInteger(code) ? code : null;
      clearTimeout(this.#timer); clearInterval(this.#permitTimer); this.#writeAbort?.('WRITE_FAILED');
      this.#deliver({ output: '', exit_code: Number.isInteger(code) ? code : 1, eof: true });
      this.#closeResolve(true); this.#notify(this.#onExit);
    });
      if (!this.#closed && !this.#stopping) {
        this.#timer = setTimeout(() => this.#fail('ORIGINAL_DEADLINE'), deadlineMono - start);
        if (checkPermit) this.#permitTimer = setInterval(() => { void this.#refresh(); }, PERMIT_POLL_MS);
      }
    } catch { clearTimeout(this.#timer); clearInterval(this.#permitTimer); throw new TransportError('PROCESS_ERROR'); }
  }
  get closed() { return this.#closed; }
  get pid() { return this.#child.pid; }
  get pendingOutput() { return this.#queue.some(x => x.output.length > 0); }
  get snapshot() { return Object.freeze({ processId: Number.isInteger(this.#child.pid) ? this.#child.pid : null,
    processClosedObserved: this.#closed, stdoutEOFObserved: this.#stdoutEOF, exitObserved: this.#exitSeen,
    exitCode: this.#exitCode ?? null, fatal: this.#fatal, bytes: this.#ingress, queuedBytes: this.#queued,
    writeInFlight: this.#writing, originalDeadlineMono: this.#deadline, accountCleanupVerified: false }); }
  observe(a, b, c) { this.#onFatal = a; this.#onOutput = b; this.#onExit = c; if (this.#fatal) this.#notify(a, this.#fatal === 'STDERR_PRESENT' ? this.#fatal : 'TRANSPORT_FAILED'); }
  #notify(fn, ...args) { try { fn?.(...args); } catch { this.#fail('PROCESS_ERROR'); } }
  #budget() { const n = this.#clock(); requireSafe(Number.isFinite(n) && n >= this.#last, 'PROCESS_ERROR'); this.#last = n;
    requireSafe(n < this.#deadline && !this.#stopping && !this.#closed, 'ORIGINAL_DEADLINE'); return this.#deadline - n; }
  #deliver(value) { if (this.#pending) { const receive = this.#pending; this.#pending = undefined; receive(value); } else this.#queue.push(value); }
  #fail(code) {
    if (this.#fatal || this.#closed) return;
    this.#fatal = CODES.has(code) ? code : 'PROCESS_ERROR'; this.#queue.length = 0; this.#queued = 0;
    this.#deliver({ output: '', error: this.#fatal === 'OUTPUT_LIMIT' ? 'OVERFLOW' : 'TRANSPORT_FAILED' });
    this.#notify(this.#onFatal, this.#fatal === 'STDERR_PRESENT' ? this.#fatal : this.#fatal === 'OUTPUT_LIMIT' ? 'OVERFLOW' : 'TRANSPORT_FAILED');
    void this.stop({ force: true });
  }
  async #refresh() {
    if (!this.#permit || this.#stopping || this.#closed || this.#checking) return;
    this.#checking = true;
    try { const epoch = await bounded(() => this.#permit(this.pid), Math.min(PERMIT_TIMEOUT_MS, this.#budget()), 'PERMIT_TIMEOUT');
      requireSafe(Number.isInteger(epoch) && epoch >= this.#epoch, 'PERMIT_REJECTED'); this.#epoch = epoch;
    } catch { this.#fail('PERMIT_FAILED'); } finally { this.#checking = false; }
  }
  async read({ signal } = {}) {
    if (signal?.aborted) { this.#fail('READ_ABORTED'); return { output: '', error: 'TRANSPORT_FAILED' }; }
    if (!this.#closed && !this.#stopping) { try { this.#budget(); } catch { this.#fail('ORIGINAL_DEADLINE'); } }
    if (this.#queue.length) { const value = this.#queue.shift(); this.#queued -= value.output.length; return value; }
    if (this.#closed) return { output: '', exit_code: this.#exitCode ?? 1, eof: true };
    if (this.#stopping) return { output: '', error: 'TRANSPORT_FAILED' };
    if (this.#pending) { this.#fail('CONCURRENT_READ'); throw new TransportError('CONCURRENT_READ'); }
    return await new Promise(resolveRead => {
      const aborted = () => { this.#pending = undefined; this.#fail('READ_ABORTED'); resolveRead({ output: '', error: 'TRANSPORT_FAILED' }); };
      this.#pending = value => { signal?.removeEventListener('abort', aborted); this.#queued -= value.output.length; resolveRead(value); };
      signal?.addEventListener('abort', aborted, { once: true });
    });
  }
  async write(line, { signal } = {}) {
    try {
      requireSafe(typeof line === 'string' && line.length <= 16384 && /^[\x20-\x7e]*\n$/.test(line), 'WRITE_REJECTED');
      requireSafe(!this.#writing && !signal?.aborted, signal?.aborted ? 'ABORTED' : 'CONCURRENT_WRITE');
      this.#writing = true;
      if (this.#permit) {
        const epoch = await bounded(() => this.#permit(this.pid), Math.min(PERMIT_TIMEOUT_MS, this.#budget()), 'PERMIT_TIMEOUT');
        requireSafe(Number.isInteger(epoch) && epoch >= this.#epoch, 'PERMIT_REJECTED'); this.#epoch = epoch;
      }
      await bounded(() => new Promise((resolveWrite, rejectWrite) => {
        let callback = false, drained = false, returnKnown = false, done = false;
        const settle = code => {
          if (done) return; if (!code && (!returnKnown || !callback || !drained)) return; done = true;
          this.#child.stdin.removeListener('drain', onDrain); signal?.removeEventListener('abort', onAbort); this.#writeAbort = undefined;
          if (code) rejectWrite(new TransportError(code)); else resolveWrite();
        };
        const onDrain = () => { drained = true; settle(); }, onAbort = () => settle('ABORTED');
        this.#writeAbort = settle; this.#child.stdin.once('drain', onDrain); signal?.addEventListener('abort', onAbort, { once: true });
        try { const accepted = this.#child.stdin.write(line, error => { if (error) settle('WRITE_FAILED'); else { callback = true; settle(); } });
          drained ||= accepted === true; returnKnown = true; settle();
        } catch { settle('WRITE_FAILED'); }
      }), Math.min(5000, this.#budget()), 'WRITE_TIMEOUT');
    } catch (error) { this.#writeAbort?.('WRITE_FAILED'); this.#fail(error instanceof TransportError && CODES.has(error.code) ? error.code : 'WRITE_FAILED'); throw new TransportError('WRITE_FAILED'); }
    finally { line = undefined; this.#writing = false; }
  }
  end() { this.#budget(); this.#child.stdin.end(); }
  async stop({ force = true } = {}) {
    if (!this.#stopPromise) {
      this.#stopping = true; clearTimeout(this.#timer); clearInterval(this.#permitTimer); this.#queue.length = 0; this.#queued = 0;
      this.#writeAbort?.('ABORTED'); if (this.#pending) this.#deliver({ output: '', error: 'TRANSPORT_FAILED' });
      this.#stopPromise = Promise.resolve().then(async () => {
        try {
          if (!this.#closed && force) { try { this.#child.stdin.destroy(); } catch { /* Still attempt kill and observe close. */ } this.#child.kill(); }
          return await bounded(() => this.#closePromise, this.#stopMs, 'PROCESS_ERROR') === true;
        }
        catch { return false; }
      });
    }
    return this.#stopPromise;
  }
}

export function validateCurrentPermit(bindingInput, recordInput, now, transportHash) {
  try {
    const b = validateBinding(bindingInput), r = copyDto(recordInput);
    exact(r, ['binding', 'authority', 'source', 'checked_at', 'expires_at', 'revoked', 'guard_healthy', 'unknown_create_count', 'unresolved_nonce_count', 'revocation_epoch', 'scopes', 'transport_sha256']);
    requireSafe(r.source === 'independent_owner_guard_checkpoint' && bindingMatches(r.binding, b) && r.revoked === false && r.guard_healthy === true && r.unknown_create_count === 0 && r.unresolved_nonce_count === 0, 'PERMIT_REJECTED');
    validateAuthority(r.authority, b, now);
    requireSafe(Number.isFinite(now) && instant(r.checked_at) <= now && now - instant(r.checked_at) <= PERMIT_FRESH_MS && now < instant(r.expires_at) && instant(r.expires_at) <= instant(r.authority.expires_at), 'PERMIT_STALE');
    requireSafe(Number.isInteger(r.revocation_epoch) && r.revocation_epoch >= 0 && /^[0-9a-f]{64}$/.test(r.transport_sha256) && r.transport_sha256 === transportHash, 'PERMIT_REJECTED');
    requireSafe(Array.isArray(r.scopes) && [...r.scopes].sort().join(',') === ['existing_operations_staging', 'existing_protected_preview', 'frozen_helper_launch', 'stdin_credentials'].sort().join(','), 'PERMIT_REJECTED');
    return frozen(r);
  } catch { throw new TransportError('PERMIT_REJECTED'); }
}
async function verifyFiles(transportHash) {
  try {
    requireSafe(platform() === 'win32', 'LIVE_PLATFORM_REJECTED');
    for (const [, path, expected] of [...FIXED_FILES, ['transport', SELF, transportHash]]) {
      const stat = await lstat(path); requireSafe(stat.isFile() && !stat.isSymbolicLink(), 'FILE_BINDING_REJECTED');
      requireSafe(stat.size > 0 && stat.size <= 32 * 1024 * 1024, 'FILE_BINDING_REJECTED');
      requireSafe(resolve(await realpath(path)).toLowerCase() === resolve(path).toLowerCase(), 'FILE_BINDING_REJECTED');
      const digest = createHash('sha256'); let bytes = 0;
      const stream = createReadStream(path, { highWaterMark: 65536 });
      try { for await (const chunk of stream) { bytes += chunk.length; requireSafe(bytes <= 32 * 1024 * 1024, 'FILE_BINDING_REJECTED'); digest.update(chunk); } }
      finally { stream.destroy(); }
      requireSafe(digest.digest('hex') === expected, 'HASH_MISMATCH');
    }
  } catch { throw new TransportError('FILE_BINDING_REJECTED'); }
}

// FUTURE use only after separately applicable authority/private integration review.
// No boolean GO/default permit/CLI. The external checker is a trusted dependency,
// not an authenticator manufactured by this module. Not called in this batch.
export async function launchReviewedLiveCollector(options) {
  let collector, engine, child, observeClose, observedChild, orphanStop;
  const stopOrphan = () => { if (!child) return Promise.resolve(true); orphanStop ??= stopUnattachedChild(child, observeClose, 2000); return orphanStop; };
  try {
    requireSafe(options && [Object.prototype, null].includes(Object.getPrototypeOf(options)), 'PERMIT_REQUIRED');
    const descriptors = Object.getOwnPropertyDescriptors(options);
    requireSafe(Reflect.ownKeys(descriptors).length === 3 && Reflect.ownKeys(descriptors).every(k => ['config', 'binding', 'checkCurrentPermit'].includes(k) && Object.hasOwn(descriptors[k], 'value')), 'PERMIT_REQUIRED');
    requireSafe(typeof options?.checkCurrentPermit === 'function', 'PERMIT_REQUIRED');
    const b = validateBinding(options.binding), check = options.checkCurrentPermit;
    let permit = copyDto(await bounded(() => check(b, { stage: 'before_hash', processId: null }), PERMIT_TIMEOUT_MS, 'PERMIT_TIMEOUT'));
    const hash = permit?.transport_sha256; permit = validateCurrentPermit(b, permit, Date.now(), hash);
    const originalEpoch = permit.revocation_epoch;
    await verifyFiles(hash);
    permit = validateCurrentPermit(b, await bounded(() => check(b, { stage: 'before_launch', processId: null }), PERMIT_TIMEOUT_MS, 'PERMIT_TIMEOUT'), Date.now(), hash);
    requireSafe(permit.revocation_epoch >= originalEpoch, 'PERMIT_REJECTED');
    let hooks;
    const deferred = { get closed() { return engine ? engine.closed : observedChild?.closed === true; }, get pendingOutput() { return engine?.pendingOutput ?? false; },
      observe(...args) { hooks = args; }, read: args => engine.read(args), write: (...args) => engine.write(...args), end: () => engine.end(), stop: args => engine ? engine.stop(args) : stopOrphan() };
    collector = new HelperCollector({ config: options.config, binding: b, authority: permit.authority, transport: deferred,
      wall: () => Date.now(), monotonic: () => performance.now() });
    const deadline = performance.now() + Math.min(instant(b.t0) + 1800000, instant(permit.authority.expires_at), instant(permit.expires_at)) - Date.now();
    requireSafe(deadline - performance.now() >= 1000, 'PERMIT_STALE');
    child = spawn(FIXED_FILES[1][1], ['-I', '-B', FIXED_FILES[0][1], '--hosted-owner-approved'], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: dirname(FIXED_FILES[0][1]), env: environment() });
    observedChild = observeOwnedChild(child); observeClose = observedChild.done;
    engine = new OwnedStdioTransport(child, { deadlineMono: deadline, initialEpoch: permit.revocation_epoch, checkPermit: async pid => {
      const record = await check(b, { stage: 'current', processId: pid });
      permit = validateCurrentPermit(b, record, Date.now(), hash); return permit.revocation_epoch;
    } });
    engine.observe(...hooks);
    return Object.freeze({ collector, processEvidence: () => Object.freeze({ ...engine.snapshot, evidenceClass: 'OWNED_HELPER_PROCESS_ONLY', grantsOwnerGo: false }) });
  } catch {
    if (collector) await collector.abort();
    if (engine) { if (!await engine.stop({ force: true })) throw setupError('STOP_UNCONFIRMED', child, false); }
    else if (child && !await stopOrphan()) throw setupError('STOP_UNCONFIRMED', child, false);
    throw setupError('PERMIT_REJECTED', child, !!child);
  }
}

export async function createSentinelCollector(scenario = 'normal', options = {}) {
  requireSafe(SCENARIOS.includes(scenario));
  const safe = copyDto(options); requireSafe(Object.keys(safe).every(k => ['lifetimeMs', 'responseMs', 'stopMs'].includes(k)));
  const lifetime = safe.lifetimeMs ?? 18000, responseMs = safe.responseMs ?? 3000, stopMs = safe.stopMs ?? 1000;
  requireSafe(Number.isInteger(lifetime) && lifetime >= 1 && lifetime <= 18000 && Number.isInteger(responseMs) && responseMs >= 1 && responseMs <= 5000 && Number.isInteger(stopMs) && stopMs >= 1 && stopMs <= 2000);
  const fixture = publicFixture(); let age = 60;
  const executable = typeof process !== 'undefined' ? process.execPath : 'node';
  const child = spawn(executable, [fileURLToPath(new URL('./fill_uat_synthetic_wire_child.mjs', import.meta.url)), scenario], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: environment() });
  const observedChild = observeOwnedChild(child), observed = observedChild.done;
  let collector, engine;
  try {
    // Finite PUBLIC fault fixture tests construction failure AFTER spawn. It is
    // unavailable to the real factory and never relaxes any launch gate.
    engine = new OwnedStdioTransport(child, { deadlineMono: performance.now() + lifetime, stopMs,
      ...(scenario === 'setup_failure' ? { monotonic: () => NaN } : {}) });
    collector = new HelperCollector({ ...fixture, transport: engine, wall: () => instant(fixture.binding.t0) + age * 1000, monotonic: () => age * 1000, responseMs, stopMs });
  } catch {
    if (engine) { if (!await engine.stop({ force: true })) throw setupError('STOP_UNCONFIRMED', child, false); }
    else if (!await stopUnattachedChild(child, observed, stopMs)) throw setupError('STOP_UNCONFIRMED', child, false);
    throw setupError('PROCESS_ERROR', child, true);
  }
  return Object.freeze({ collector, publicBinding: frozen(fixture.binding), processEvidence: () => Object.freeze({ ...engine.snapshot, evidenceClass: 'SYNTHETIC_WIRE_CHILD_ONLY', modelClock: true, actualHelperLaunched: false }),
    advanceFixtureAge(next) { requireSafe([60, 61, 62, 125, 126, 130, 131, 140, 190, 200, 220, 1200].includes(next) && next >= age); age = next; return true; } });
}
