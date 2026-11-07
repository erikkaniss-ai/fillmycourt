// Pure REAL-wire collector preparation. Only an injected transport; no launcher,
// filesystem, network, credential discovery or CLI. DTO truth is caller-trusted.
import { SafeEventReadout } from './fill_uat_safe_events.mjs';
import { HELPER_HASH, CANDIDATE, LABELS, GET_ROUTES, ContractError, requireContract as req,
  exact, uuid, instant, copyDto, frozen, bindingMatches, validateBinding, validateAuthority, reduceEvidence, contractCode } from './fill_uat_evidence_verdict.mjs';

const EXCLUDED = ['b82a8774-839f-4b73-8c4d-5c76c10dd957', '45ef3b07-f811-4e27-b41b-64fe5970d675',
  '4ff65a8d-3d3b-4fd7-a032-a81fd8f51fce', 'c29ba3be-d7ae-4dff-b662-88d1b0504024',
  '057375d4-0d8f-4879-babe-db842630c871', 'bc7a9bbf-ba3f-4e40-9a60-7fe0367c7dc3', 'af2942da-fab9-419b-8d42-8ecb107c4cd9'];
function validateConfiguration(input, binding) {
  const c = copyDto(input);
  exact(c, ['op', 'approved_helper_sha256', 'plan']); req(c.op === 'configure' && c.approved_helper_sha256 === HELPER_HASH);
  const p = c.plan; exact(p, ['candidate_sha', 'run_id', 'authorization_id', 't0', 'date', 'calendar_start', 'calendar_end', 'publishable_key', 'principals']);
  req(p.candidate_sha === CANDIDATE && p.run_id === binding.run_id && p.authorization_id === binding.authorization_id && p.t0 === binding.t0);
  req(typeof p.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(p.date) && new Date(p.date + 'T00:00:00Z').toISOString().slice(0, 10) === p.date);
  const start = instant(p.calendar_start), end = instant(p.calendar_end), day = Date.parse(p.date + 'T00:00:00Z');
  req(end > start && end - start <= 26 * 3600000 && Math.abs(Math.floor(start / 86400000) - Math.floor(day / 86400000)) <= 1);
  req(typeof p.publishable_key === 'string' && /^sb_publishable_[A-Za-z0-9_-]{20,240}$/.test(p.publishable_key));
  exact(p.principals, LABELS);
  const passwords = new Set();
  for (const label of LABELS) {
    const principal = p.principals[label]; exact(principal, ['id', 'password']); uuid(principal.id);
    req(principal.id === binding.identities[label] && !EXCLUDED.includes(principal.id) && !binding.historical_ids.includes(principal.id));
    req(typeof principal.password === 'string' && /^[\x21-\x7e]{40,128}$/.test(principal.password)); passwords.add(principal.password);
  }
  req(passwords.size === 3);
  return c; // Internal call only: NEVER returned from a collector receipt.
}
async function bounded(fn, ms, code) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ContractError(code)), Math.max(1, ms));
  })]); } finally { clearTimeout(timer); }
}

export class HelperCollector {
  #config; #binding; #authority; #t; #wall; #mono; #anchorWall; #anchorMono; #lastMono; #lastWall;
  #expiry; #responseMs; #stopMs; #timer; #controller = new AbortController();
  #ready = false; #configured = false; #gate = false; #gateExpiry = 0; #used = new Set(); #loggedIn = new Set();
  #busy = false; #fatal = ''; #closed = false; #stopPromise; #stopConfirmed = false; #parsers = []; #bytes = 0; #ordinal = 0;
  #canary = new Map(); #cleanupIntent = true;
  constructor({ config, binding, authority, transport, wall, monotonic, responseMs = 5000, stopMs = 1000 } = {}) {
    try {
      this.#binding = validateBinding(binding); this.#config = validateConfiguration(config, this.#binding);
      req(typeof wall === 'function' && typeof monotonic === 'function' && transport && ['read', 'write', 'end', 'stop'].every(k => typeof transport[k] === 'function'));
      req(Number.isInteger(responseMs) && responseMs >= 1 && responseMs <= 5000 && Number.isInteger(stopMs) && stopMs >= 1 && stopMs <= 2000);
      this.#wall = wall; this.#mono = monotonic; this.#t = transport; this.#responseMs = responseMs; this.#stopMs = stopMs;
      this.#anchorWall = wall(); this.#anchorMono = monotonic();
      req(Number.isFinite(this.#anchorWall) && Number.isFinite(this.#anchorMono), 'CLOCK_INVALID');
      this.#lastWall = this.#anchorWall; this.#lastMono = this.#anchorMono;
      this.#authority = validateAuthority(authority, this.#binding, this.#anchorWall);
      this.#expiry = Math.min(instant(this.#binding.t0) + 1800000, instant(this.#authority.expires_at));
      const untilExpiry = this.#expiry - this.#anchorWall;
      this.#timer = setTimeout(() => { void this.abort(untilExpiry <= 300000 ? 'ORIGINAL_DEADLINE' : 'CONFIGURATION_DEADLINE'); }, Math.min(untilExpiry, 300000));
      transport.observe?.(code => { void this.abort(code === 'STDERR_PRESENT' ? code : code === 'OVERFLOW' ? code : 'TRANSPORT_FAILED'); },
        () => { if (this.#ready && !this.#busy && !this.#closed) void this.abort('UNEXPECTED_OUTPUT'); },
        () => { if (!this.#busy && !this.#closed) void this.abort('UNEXPECTED_EXIT'); });
    } catch (error) {
      this.clearSecrets(); clearTimeout(this.#timer);
      throw new ContractError(contractCode(error, 'INVALID_CONFIGURATION'));
    }
  }
  clearSecrets() { this.#config = undefined; }
  #clock() {
    let wall, mono; try { wall = this.#wall(); mono = this.#mono(); } catch { throw new ContractError('CLOCK_INVALID'); }
    req(Number.isFinite(wall) && Number.isFinite(mono), 'CLOCK_INVALID');
    req(mono >= this.#lastMono && wall >= this.#lastWall, 'CLOCK_REVERSED');
    req(Math.abs((wall - this.#anchorWall) - (mono - this.#anchorMono)) <= 2000, 'CLOCK_SKEW');
    this.#lastMono = mono; this.#lastWall = wall;
    req(wall >= instant(this.#binding.t0) && wall < this.#expiry, 'ORIGINAL_DEADLINE');
    return { wall, mono };
  }
  get snapshot() {
    return frozen({ binding: this.#binding, ordinal: this.#ordinal, ready: this.#ready, configured: this.#configured,
      secretReferencesRetained: this.#config !== undefined, fatal: this.#fatal, closed: this.#closed,
      stopConfirmed: this.#stopConfirmed, processClosedObserved: this.#t?.closed === true,
      originalExpiresAt: new Date(this.#expiry).toISOString(), cleanupIntentRequired: this.#cleanupIntent,
      boundaryVerified: false, childCorrelation: false, grantsOwnerGo: false });
  }
  #clearParsers() { this.#parsers.forEach(c => c.parser.clear()); this.#parsers = []; }
  async #stop(force) {
    if (!this.#stopPromise) {
      clearTimeout(this.#timer); this.#controller.abort(); this.clearSecrets(); this.#clearParsers();
      this.#loggedIn.clear(); this.#canary.clear(); this.#used.clear(); this.#gate = false;
      this.#stopPromise = (async () => {
        try { this.#stopConfirmed = await bounded(() => this.#t.stop({ force }), this.#stopMs, 'STOP_TIMEOUT') === true; }
        catch { this.#stopConfirmed = false; }
        this.#closed = true; return this.#stopConfirmed;
      })();
    }
    return this.#stopPromise;
  }
  async abort(code = 'ABORTED') {
    const allowed = ['ABORTED', 'ORIGINAL_DEADLINE', 'CONFIGURATION_DEADLINE', 'STDERR_PRESENT', 'OVERFLOW', 'TRANSPORT_FAILED', 'UNEXPECTED_OUTPUT', 'UNEXPECTED_EXIT'];
    if (!this.#fatal && !this.#closed) this.#fatal = allowed.includes(code) ? code : 'ABORTED';
    await this.#stop(true); return this.snapshot;
  }
  #command(input) {
    const c = copyDto(input); const op = c?.op;
    req(['login', 'denied_login', 'get', 'denied_get'].includes(op), 'COMMAND_REJECTED');
    exact(c, ['get', 'denied_get'].includes(op) ? ['op', 'label', 'route'] : ['op', 'label']);
    req(LABELS.includes(c.label) && (!['get', 'denied_get'].includes(op) || GET_ROUTES.includes(c.route)), 'COMMAND_REJECTED');
    const age = this.#clock().wall - instant(this.#binding.t0), operator = c.label !== 'canary';
    req(!operator || this.#gate, 'INDEPENDENT_GATE_REQUIRED');
    if (op === 'login') {
      req(age < (operator ? 600000 : 120000), 'POSITIVE_WINDOW_EXPIRED');
      if (operator) req(this.#clock().wall < this.#gateExpiry, 'INDEPENDENT_LEASE_EXPIRED');
    }
    if (op === 'get') req(age < (operator ? 1200000 : 120000), 'POSITIVE_WINDOW_EXPIRED');
    if (op === 'denied_login' || op === 'denied_get') req(age >= (operator ? 1200000 : 120000), 'DENIAL_TOO_EARLY');
    if (op === 'get' || op === 'denied_get') req(this.#loggedIn.has(c.label), 'LOGIN_REQUIRED');
    return c;
  }
  #expect(c) {
    if (['ready', 'configure', 'operator_gate'].includes(c.op)) return { label: '', route: c.op, statuses: [0], denied: false };
    if (c.op === 'login') return { label: c.label, route: 'login', statuses: [200], denied: false };
    if (c.op === 'denied_login') return { label: c.label, route: 'denied_login', statuses: [400, 401, 403], denied: true };
    const denied = c.op === 'denied_get' || c.route.startsWith('foreign_') || c.route === 'provider_connections' && c.label === 'b';
    return { label: c.label, route: c.route, statuses: c.op === 'denied_get' ? [401, 403] : [denied ? 403 : 200], denied };
  }
  #receipt(code, events = [], observations = []) {
    return frozen({ code, responseComplete: code === 'RESPONSE_COMPLETE_UNFENCED', events, observations, ...this.snapshot });
  }
  async ready() { return this.#exchange({ op: 'ready' }); }
  async configure() { return this.#exchange({ op: 'configure' }); }
  async command(input) { return this.#exchange(input, 'command'); }
  async authorizeOperators(evidence, { trustedInput = false } = {}) {
    return this.#exchange(evidence, 'gate', trustedInput);
  }
  async #exchange(input, kind = 'control', trustedInput = false) {
    if (this.#busy) { await this.abort(); return this.#receipt('CONCURRENT_REQUEST'); }
    if (this.#fatal || this.#closed) return this.#receipt(this.#fatal || 'SESSION_CLOSED');
    this.#busy = true; let line, events = [], observations = [], code = 'READOUT_FAILED', c;
    try {
      const start = this.#clock(), limit = start.mono + this.#responseMs;
      const budget = () => { req(!this.#fatal, this.#fatal || 'ABORTED'); const time = this.#clock(); req(time.mono < limit, 'RESPONSE_DEADLINE'); return Math.min(limit - time.mono, this.#expiry - time.wall); };
      if (kind === 'command') c = this.#command(input);
      else if (kind === 'gate') {
        req(this.#configured && !this.#gate, 'GATE_STATE_REJECTED');
        const proof = copyDto(input), verdict = reduceEvidence(this.#binding, proof, { at: start.wall, trustedInput });
        req(verdict.operatorEligible, 'INDEPENDENT_GATE_REJECTED');
        const required = [['login', 'login'], ['get:own_today', 'own_today'], ['get:foreign_today', 'foreign_today'], ['denied_get:me', 'me'], ['denied_login', 'denied_login']];
        const external = [...proof.canary.positive, proof.canary.retained_denial, proof.canary.auth_denial];
        required.forEach(([key], i) => req(bindingMatches(this.#canary.get(key), external[i]), 'CANARY_RECEIPT_MISMATCH'));
        this.#gateExpiry = instant(proof.independent.expires_at);
        c = { op: 'operator_gate', run_id: this.#binding.run_id, candidate_sha: CANDIDATE, decision: 'pass',
          lease_digest: proof.independent.lease_digest, evidence_ref: proof.independent.evidence_ref };
      } else {
        c = input; req(c.op === 'ready' ? !this.#ready : this.#ready && !this.#configured && !!this.#config, 'CONTROL_ORDER');
        if (c.op === 'configure') req(start.wall - this.#anchorWall < 300000 && start.mono - this.#anchorMono < 300000, 'CONFIGURATION_DEADLINE');
      }
      if (c.op !== 'ready') req(this.#ready, 'READY_REQUIRED');
      if (!['ready', 'configure'].includes(c.op)) req(this.#configured, 'CONFIGURATION_REQUIRED');
      const slot = `${c.label ?? ''}:${c.op}:${c.route ?? ''}`;
      req(!this.#used.has(slot), 'CONSUMED_SLOT'); this.#used.add(slot); // BEFORE write, no ambiguous retries.
      req(++this.#ordinal <= 64, 'COMMAND_LIMIT');
      const expected = this.#expect(c);
      this.#parsers = [expected, { label: '', route: 'closed' }, { label: '', route: 'deadline' }].map(e => ({ route: e.route, parser: new SafeEventReadout([{ label: e.label, route: e.route }]) }));
      if (c.op !== 'ready') {
        if (c.op === 'configure') { line = JSON.stringify(this.#config) + '\n'; req(line.length <= 16384, 'CONFIGURATION_TOO_LARGE'); this.clearSecrets(); }
        else line = JSON.stringify(c) + '\n';
        try { await bounded(() => this.#t.write(line, { signal: this.#controller.signal }), budget(), 'RESPONSE_DEADLINE'); }
        finally { line = undefined; }
      }
      for (let reads = 0; ; reads++) {
        req(reads < 1024, 'READ_LIMIT');
        const chunk = await bounded(() => this.#t.read({ signal: this.#controller.signal }), budget(), 'RESPONSE_DEADLINE');
        budget(); req(chunk && typeof chunk.output === 'string', 'INVALID_CHUNK');
        req(!chunk.stderr, 'STDERR_PRESENT'); req(!chunk.error, chunk.error === 'OVERFLOW' ? 'OVERFLOW' : 'TRANSPORT_FAILED');
        req(chunk.exit_code === undefined || chunk.exit_code === 0, 'NONZERO_EXIT');
        req(chunk.output.length <= 65536 - this.#bytes, 'OVERFLOW'); this.#bytes += chunk.output.length;
        const survivors = [];
        for (const p of this.#parsers) { try { p.parser.feed(chunk.output); survivors.push(p); } catch { p.parser.clear(); } }
        this.#parsers = survivors; req(survivors.length > 0, 'INVALID_RESPONSE');
        const complete = survivors.find(p => p.parser.ready);
        if (complete) {
          events = complete.parser.finish(); req(!['closed', 'deadline'].includes(complete.route), complete.route === 'closed' ? 'HELPER_CLOSED' : 'HELPER_DEADLINE');
          const e = events[0]; req(e.verified === true && expected.statuses.includes(e.status) && e.denied === expected.denied, 'UNVERIFIED_RESPONSE');
          req(!chunk.eof && chunk.exit_code === undefined, 'EARLY_EXIT'); req(this.#t.pendingOutput !== true, 'UNEXPECTED_OUTPUT'); break;
        }
        req(!chunk.eof && chunk.exit_code === undefined, 'INCOMPLETE_RESPONSE');
      }
      // Recheck actual positive windows after a potentially slow response.
      if (kind === 'command') this.#command(c);
      if (kind === 'gate') req(this.#clock().wall < Math.min(this.#gateExpiry, instant(this.#binding.t0) + 600000), 'INDEPENDENT_LEASE_EXPIRED');
      const at = new Date(this.#clock().wall).toISOString();
      if (c.label) {
        observations = [{ label: c.label, user_id: this.#binding.identities[c.label], route: events[0].route,
          status: events[0].status, verified: events[0].verified, denied: events[0].denied, at }];
        if (c.label === 'canary') this.#canary.set(`${c.op}${c.route ? ':' + c.route : ''}`, observations[0]);
      }
      if (c.op === 'ready') this.#ready = true;
      if (c.op === 'configure') {
        req(this.#clock().wall - this.#anchorWall < 300000, 'CONFIGURATION_DEADLINE'); this.#configured = true;
        clearTimeout(this.#timer); this.#timer = setTimeout(() => { void this.abort('ORIGINAL_DEADLINE'); }, this.#expiry - this.#clock().wall);
      }
      if (c.op === 'operator_gate') this.#gate = true;
      if (c.op === 'login') this.#loggedIn.add(c.label);
      code = 'RESPONSE_COMPLETE_UNFENCED';
    } catch (error) { code = contractCode(error, 'READOUT_FAILED'); this.#fatal ||= code; events = []; observations = []; await this.#stop(true); }
    finally { line = undefined; this.#clearParsers(); this.#busy = false; }
    if (this.#closed && !this.#stopConfirmed) { code = 'TEARDOWN_UNCONFIRMED'; events = []; observations = []; }
    return this.#receipt(code, events, observations);
  }
  async close() {
    if (this.#busy) { await this.abort(); return this.#receipt('CONCURRENT_REQUEST'); }
    if (this.#closed || this.#fatal) { await this.#stop(true); return this.#receipt(this.#fatal || 'ALREADY_CLOSED'); }
    this.#busy = true; let code = 'PROCESS_CLOSED_UNAUTHENTICATED';
    try {
      const start = this.#clock(), budget = () => { const time = this.#clock(); req(time.mono - start.mono < this.#responseMs, 'RESPONSE_DEADLINE'); return Math.min(this.#responseMs - time.mono + start.mono, this.#expiry - time.wall); };
      await bounded(() => this.#t.end(), budget(), 'RESPONSE_DEADLINE');
      for (let reads = 0; ; reads++) {
        req(reads < 1024, 'READ_LIMIT'); const tail = await bounded(() => this.#t.read({ signal: this.#controller.signal }), budget(), 'RESPONSE_DEADLINE'); budget();
        req(tail && tail.output === '' && !tail.error && !tail.stderr, 'UNEXPECTED_CLOSE_OUTPUT');
        if (tail.eof === true && tail.exit_code === 0) break;
        req(tail.eof !== true && tail.exit_code === undefined, 'NONZERO_EXIT');
      }
      req(await this.#stop(false), 'TEARDOWN_UNCONFIRMED');
    } catch (error) { code = contractCode(error, 'READOUT_FAILED'); this.#fatal ||= code; await this.#stop(true); }
    finally { this.#busy = false; }
    if (!this.#stopConfirmed) code = 'TEARDOWN_UNCONFIRMED'; return this.#receipt(code);
  }
}
