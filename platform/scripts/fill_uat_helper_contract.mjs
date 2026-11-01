// Pure, credential-free protocol MODEL. No real helper/target or execution GO.
import { performance } from 'node:perf_hooks';
import { SafeEventReadout } from './fill_uat_safe_events.mjs';

export const FROZEN_HELPER_SHA256 = '6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548';
export const SENTINEL = 'SYNTHETIC_SENTINEL';
export const LABELS = Object.freeze(['canary', 'a', 'b']);
export const ROUTES = Object.freeze(['me', 'organizations', 'own_today', 'foreign_today', 'own_calendar', 'foreign_calendar', 'provider_connections']);
export const MAX_BYTES = 65_536;
export const MAX_LIFETIME_MS = 18_000;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const FIXTURE_PLAN = freeze({ candidate_sha: '0'.repeat(40), run_id: '00000000-0000-0000-0000-000000000001',
  authorization_id: '00000000-0000-0000-0000-000000000002', t0: '2030-01-01T00:00:00Z', date: '2030-01-01',
  calendar_start: '2030-01-01T00:00:00Z', calendar_end: '2030-01-02T00:00:00Z', publishable_key: SENTINEL,
  principals: Object.fromEntries(LABELS.map((label, i) => [label, { id: `00000000-0000-0000-0000-00000000001${i}`,
    password: `${SENTINEL}:${label}` }])) });
export const FIXTURE_CONFIG = freeze({ op: 'configure', approved_helper_sha256: '0'.repeat(64), plan: FIXTURE_PLAN });
export const FIXTURE_GATE = freeze({ op: 'operator_gate', run_id: FIXTURE_PLAN.run_id, candidate_sha: FIXTURE_PLAN.candidate_sha,
  decision: 'pass', lease_digest: '0'.repeat(64), evidence_ref: SENTINEL });
export const COMMANDS = freeze(Object.fromEntries([
  ['configure', FIXTURE_CONFIG], ['operator_gate', FIXTURE_GATE],
  ...LABELS.flatMap(label => [['login', 'denied_login'].map(op => [`${label}_${op}`, { op, label }]),
    ROUTES.flatMap(route => ['get', 'denied_get'].map(op => [`${label}_${op}_${route}`, { op, label, route }]))].flat()),
]));
export function fixtureCommandName(value) {
  try {
    const raw = JSON.stringify(value);
    return Object.keys(COMMANDS).find(key => JSON.stringify(COMMANDS[key]) === raw) ?? null;
  } catch { return null; }
}
export function readiness() {
  return freeze({ liveReady: false, publicGo: false, authorityConsumed: true, newAccountQuota: 0,
    helperCompatibilityAccepted: false, authenticatedClosure: false, code: 'LIVE_EXECUTION_NOT_AUTHORIZED',
    gaps: ['NO_CHILD_CORRELATION_OR_PHASE_FENCE', 'NO_INDEPENDENT_RUNTIME_VERDICT', 'NO_CURRENT_ACTIVATION_AUTHORITY',
      'FIXTURE_VALUES_INVALID_FOR_LIVE_HELPER'] });
}
function event(label, route, status = 0, verified = true, denied = false) {
  return { label, route, status, request_id: '', verified, denied };
}
export function fixtureReply(name) {
  const c = COMMANDS[name];
  if (!c) return event('', 'closed', 0, false);
  if (c.op === 'configure' || c.op === 'operator_gate') return event('', c.op);
  if (c.op === 'login') return event(c.label, 'login', 200);
  if (c.op === 'denied_login') return event(c.label, 'denied_login', 400, true, true);
  const denied = c.op === 'denied_get' || c.route.startsWith('foreign_') || (c.route === 'provider_connections' && c.label === 'b');
  return event(c.label, c.route, denied ? c.op === 'denied_get' ? 401 : 403 : 200, true, denied);
}
function expectation(name) {
  if (name === 'ready') return { label: '', route: 'ready', statuses: [0], denied: false };
  const c = COMMANDS[name], e = fixtureReply(name);
  return { label: e.label, route: e.route, denied: e.denied,
    statuses: c.op === 'denied_login' ? [400, 401, 403] : c.op === 'denied_get' ? [401, 403] : [e.status] };
}
class Failure extends Error { constructor(code) { super(code); this.code = code; } }
function fail(code) { throw new Failure(code); }
async function bound(fn, ms, code) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Failure(code)), Math.max(1, ms));
  })]); } finally { clearTimeout(timer); }
}
export function validateTimings(options = {}) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
      Object.keys(options).some(key => !['lifetimeMs', 'responseMs', 'stopMs', 'fixtureAge'].includes(key))) fail('INVALID_OPTIONS');
  for (const [key, defaultValue, max] of [['lifetimeMs', 16000, MAX_LIFETIME_MS], ['responseMs', 3000, 5000], ['stopMs', 1000, 2000]]) {
    const value = options[key] ?? defaultValue;
    if (!Number.isInteger(value) || value < 1 || value > max) fail('INVALID_OPTIONS');
  }
  if (options.fixtureAge !== undefined && ![60, 130, 190, 1200, 1800].includes(options.fixtureAge)) fail('INVALID_OPTIONS');
}

export class HelperContractReadout {
  #t; #now; #previous = -Infinity; #anchor; #deadline; #responseMs; #stopMs; #timer;
  #ageAnchor; #ageTick; #used = new Set(); #tuples = []; #sessions = new Set();
  #ready = false; #configured = false; #gate = false; #busy = false; #fatal = ''; #closed = false;
  #ordinal = 0; #bytes = 0; #parsers = []; #stopPromise; #stopConfirmed = false;
  #abort = new AbortController();
  constructor(transport, options = {}, now = () => performance.now()) {
    validateTimings(options);
    if (!transport || !['read', 'write', 'end', 'stop'].every(k => typeof transport[k] === 'function') || typeof now !== 'function') fail('INVALID_OPTIONS');
    this.#t = transport; this.#now = now; this.#anchor = this.#clock();
    this.#deadline = this.#anchor + (options.lifetimeMs ?? 16000);
    this.#responseMs = options.responseMs ?? 3000; this.#stopMs = options.stopMs ?? 1000;
    this.#ageAnchor = options.fixtureAge ?? 60; this.#ageTick = this.#anchor;
    this.#timer = setTimeout(() => { void this.abort('SESSION_DEADLINE'); }, options.lifetimeMs ?? 16000);
    transport.observe?.(code => { void this.abort(code === 'STDERR_PRESENT' ? code : code === 'OVERFLOW' ? code : 'TRANSPORT_FAILED'); },
      () => { if (this.#ready && !this.#busy && !this.#closed) void this.abort('UNSOLICITED_OUTPUT'); },
      () => { if (!this.#busy && !this.#closed) void this.abort('UNEXPECTED_EXIT'); });
  }
  #clock() {
    let value; try { value = this.#now(); } catch { fail('CLOCK_INVALID'); }
    if (!Number.isFinite(value)) fail('CLOCK_INVALID');
    if (value < this.#previous) fail('CLOCK_REVERSED'); this.#previous = value; return value;
  }
  #age() { return this.#ageAnchor + (this.#clock() - this.#ageTick) / 1000; }
  // Explicit MODEL clock advancement, never a command or real DB T0 renewal.
  advanceFixtureAge(age) {
    try {
      if (this.#busy || this.#closed || this.#fatal || ![60, 130, 190, 1200, 1800].includes(age) || age < this.#age()) fail('FIXTURE_CLOCK_REJECTED');
      this.#ageTick = this.#clock(); this.#ageAnchor = age;
    } catch { void this.abort('FIXTURE_CLOCK_REJECTED'); return false; }
    return true;
  }
  get snapshot() {
    return freeze({ evidenceClass: 'SYNTHETIC_HELPER_MODEL_ONLY', ordinal: this.#ordinal,
      configured: this.#configured, fatal: this.#fatal, closed: this.#closed, stopConfirmed: this.#stopConfirmed,
      processClosedObserved: this.#t.closed === true, processId: Number.isInteger(this.#t.pid) ? this.#t.pid : null,
      deadline: this.#deadline, bytes: this.#bytes, boundaryVerified: false, childCorrelation: false,
      authenticatedClosure: false, hostedAcceptance: false, liveReady: false });
  }
  #clear() { this.#parsers.forEach(p => p.parser.clear()); this.#parsers = []; }
  async #stop(force) {
    if (!this.#stopPromise) {
      clearTimeout(this.#timer); this.#abort.abort(); this.#clear(); this.#used.clear(); this.#tuples = []; this.#sessions.clear(); this.#gate = false;
      this.#stopPromise = (async () => {
        try { this.#stopConfirmed = await bound(() => this.#t.stop({ force }), this.#stopMs, 'STOP_TIMEOUT') === true; }
        catch { this.#stopConfirmed = false; }
        this.#closed = true; return this.#stopConfirmed;
      })();
    }
    return this.#stopPromise;
  }
  async abort(code = 'ABORTED') {
    const codes = ['ABORTED', 'SESSION_DEADLINE', 'STDERR_PRESENT', 'OVERFLOW', 'UNSOLICITED_OUTPUT', 'UNEXPECTED_EXIT', 'TRANSPORT_FAILED', 'FIXTURE_CLOCK_REJECTED'];
    if (!this.#fatal && !this.#closed) this.#fatal = codes.includes(code) ? code : 'ABORTED';
    await this.#stop(true); return this.snapshot;
  }
  #remaining(limit) {
    if (this.#fatal) fail(this.#fatal);
    const time = this.#clock();
    if (this.#age() >= 1800) fail('ORIGINAL_LEASE_EXPIRED');
    if (time >= this.#deadline) fail('SESSION_DEADLINE');
    if (time >= limit) fail('RESPONSE_DEADLINE');
    return Math.min(limit, this.#deadline) - time;
  }
  #authorize(name) {
    if (name === 'ready') { if (this.#ready) fail('DUPLICATE_READY'); return; }
    if (!Object.hasOwn(COMMANDS, name)) fail('UNKNOWN_COMMAND');
    if (!this.#ready) fail('READY_REQUIRED');
    if (name === 'configure') { if (this.#configured) fail('ONE_CONFIGURATION'); return; }
    if (!this.#configured) fail('CONFIGURATION_REQUIRED');
    if (this.#used.has(name)) fail('CONSUMED_SLOT');
    const c = COMMANDS[name], age = this.#age();
    if (c.op === 'operator_gate') {
      if (this.#gate || age < 180 || age >= 600) fail('OPERATOR_GATE_REJECTED');
    } else {
      if (c.label !== 'canary' && !this.#gate) fail('OPERATOR_GATE_REQUIRED');
      if (c.op === 'login' && age >= (c.label === 'canary' ? 120 : 600)) fail('POSITIVE_WINDOW_EXPIRED');
      if (c.op === 'denied_login' || c.op === 'denied_get') {
        if (age < (c.label === 'canary' ? 120 : 1200)) fail('DENIAL_TOO_EARLY');
      } else if (c.op === 'get' && age >= (c.label === 'canary' ? 120 : 1200)) fail('POSITIVE_WINDOW_EXPIRED');
      if (['get', 'denied_get'].includes(c.op) && !this.#sessions.has(c.label)) fail('LOGIN_REQUIRED');
    }
    const e = expectation(name);
    if (this.#tuples.some(t => t.label === e.label && t.route === e.route && t.denied === e.denied && t.statuses.some(s => e.statuses.includes(s)))) fail('AMBIGUOUS_RESPONSE_SLOT');
    this.#used.add(name); this.#tuples.push(e); // Consumed before any write/ambiguity.
  }
  #result(name, code, events = []) {
    return freeze({ name: typeof name === 'string' && (name === 'ready' || Object.hasOwn(COMMANDS, name)) ? name : '',
      code, responseComplete: code === 'RESPONSE_COMPLETE_UNFENCED', events,
      correlation: 'PARENT_SERIAL_ORDER_ONLY', ...this.snapshot });
  }
  async request(name) {
    if (this.#busy) { await this.abort(); return this.#result(name, 'CONCURRENT_REQUEST'); }
    if (this.#fatal || this.#closed) return this.#result(name, this.#fatal || 'SESSION_CLOSED');
    this.#busy = true; let events = [], code = 'READOUT_FAILED';
    try {
      const limit = Math.min(this.#deadline, this.#clock() + this.#responseMs);
      this.#remaining(limit); this.#authorize(name); this.#ordinal++;
      const expected = expectation(name);
      this.#parsers = [expected, { label: '', route: 'closed' }, { label: '', route: 'deadline' }].map(slot =>
        ({ route: slot.route, parser: new SafeEventReadout([{ label: slot.label, route: slot.route }]) }));
      if (name !== 'ready') await bound(() => this.#t.write(JSON.stringify(COMMANDS[name]) + '\n', { signal: this.#abort.signal }), this.#remaining(limit), 'RESPONSE_DEADLINE');
      for (let reads = 0; ; reads++) {
        if (reads >= 1024) fail('READ_LIMIT');
        const value = await bound(() => this.#t.read({ signal: this.#abort.signal }), this.#remaining(limit), 'RESPONSE_DEADLINE');
        this.#remaining(limit);
        if (!value || typeof value.output !== 'string') fail('INVALID_CHUNK');
        if (value.stderr) fail('STDERR_PRESENT');
        if (value.error) fail(value.error === 'OVERFLOW' ? 'OVERFLOW' : 'TRANSPORT_FAILED');
        if (value.exit_code !== undefined && value.exit_code !== 0) fail('NONZERO_EXIT');
        if (value.output.length > MAX_BYTES - this.#bytes) fail('OVERFLOW'); this.#bytes += value.output.length;
        const survivors = [];
        for (const candidate of this.#parsers) {
          try { candidate.parser.feed(value.output); survivors.push(candidate); } catch { candidate.parser.clear(); }
        }
        this.#parsers = survivors;
        if (!survivors.length) fail('INVALID_RESPONSE');
        const ready = survivors.find(p => p.parser.ready);
        if (ready) {
          events = ready.parser.finish();
          if (ready.route === 'closed' || ready.route === 'deadline') fail(ready.route === 'closed' ? 'HELPER_CLOSED' : 'HELPER_DEADLINE');
          const e = events[0];
          if (!e.verified) fail('UNVERIFIED_RESPONSE');
          if (!expected.statuses.includes(e.status) || e.denied !== expected.denied) fail('RESPONSE_SEMANTICS');
          if (value.eof || value.exit_code !== undefined) fail('EARLY_EXIT');
          if (this.#t.pendingOutput === true) fail('UNSOLICITED_OUTPUT');
          break;
        }
        if (value.eof || value.exit_code !== undefined) fail('INCOMPLETE_RESPONSE');
      }
      if (name === 'ready') this.#ready = true;
      if (name === 'configure') this.#configured = true;
      if (name === 'operator_gate') this.#gate = true;
      if (COMMANDS[name]?.op === 'login') this.#sessions.add(COMMANDS[name].label);
      code = 'RESPONSE_COMPLETE_UNFENCED';
    } catch (error) {
      code = error instanceof Failure ? error.code : 'READOUT_FAILED'; this.#fatal ||= code; events = []; await this.#stop(true);
    } finally { this.#clear(); this.#busy = false; }
    if (this.#closed && !this.#stopConfirmed) { code = 'TEARDOWN_UNCONFIRMED'; events = []; }
    return this.#result(name, code, events);
  }
  async close() {
    if (this.#busy) { await this.abort(); return this.#result('', 'CONCURRENT_REQUEST'); }
    if (this.#closed || this.#fatal) { await this.#stop(true); return this.#result('', this.#fatal || 'ALREADY_CLOSED'); }
    this.#busy = true; let code = 'PROCESS_CLOSED_UNAUTHENTICATED';
    try {
      const limit = Math.min(this.#deadline, this.#clock() + this.#responseMs);
      await bound(() => this.#t.end(), this.#remaining(limit), 'RESPONSE_DEADLINE');
      for (let reads = 0; ; reads++) {
        if (reads >= 1024) fail('READ_LIMIT');
        const tail = await bound(() => this.#t.read({ signal: this.#abort.signal }), this.#remaining(limit), 'RESPONSE_DEADLINE');
        this.#remaining(limit);
        if (!tail || tail.output !== '' || tail.stderr || tail.error) fail('UNEXPECTED_CLOSE_OUTPUT');
        if (tail.exit_code === 0 && tail.eof === true) break;
        if (tail.eof || tail.exit_code !== undefined) fail('NONZERO_EXIT');
      }
      if (!await this.#stop(false)) fail('TEARDOWN_UNCONFIRMED');
    } catch (error) { code = error instanceof Failure ? error.code : 'READOUT_FAILED'; this.#fatal ||= code; await this.#stop(true); }
    finally { this.#busy = false; }
    if (!this.#stopConfirmed) code = 'TEARDOWN_UNCONFIRMED';
    return this.#result('', code);
  }
}
