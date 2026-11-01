// Pure DTO reduction. Inputs require independent, trusted provenance. No I/O/GO.
export const HELPER_HASH = '6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548';
export const CANDIDATE = 'ed0eeea4ccde35ff54ee8331795326c15a49a5f9';
export const LABELS = Object.freeze(['canary', 'a', 'b']);
export const GET_ROUTES = Object.freeze(['me', 'organizations', 'own_today', 'foreign_today', 'own_calendar', 'foreign_calendar', 'provider_connections']);
export const HISTORICAL_COUNT = 16, MAX_KNOWN_COUNT = 19;
export const CONSUMED_RUNS = Object.freeze(['90d00651-5b01-418d-8769-51aef782b7b0', '0c7664ff-6920-4a09-91b5-22a423187864', '0e3a5a5a-fa68-4b3f-9a96-bdca500b1ab4', '4c0cdb3b-c138-479b-9b69-fef96420642b']);
export const CONSUMED_AUTHORITIES = Object.freeze(['01a18fc1-08b7-76d2-b9ec-062882378ab8', '01a18f95-f6ff-7642-9a6a-4cc95929f5aa', '01a19021-4661-7770-af81-f1ee25bd0362', '01a1958f-5bc5-7382-822d-27d4db023a3e']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const ERROR_CODES = new Set(('INVALID_DTO AUTHORITY_REJECTED AUTHORITY_EXPIRED CONSUMED_AUTHORITY BINDING_MISMATCH EVIDENCE_TIME_REJECTED IDENTITY_MISMATCH OBSERVATION_REJECTED MISSING_OBSERVATIONS MISSING_CANARY_PROOF BUDGET_UNVERIFIED CANARY_BAN_UNVERIFIED AUTH_DENIAL_UNVERIFIED INDEPENDENT_VERDICT_REJECTED OPERATOR_LOGIN_LATE CLEANUP_UNVERIFIED CLEANUP_TIME_REJECTED INVALID_CONFIGURATION CONFIGURATION_TOO_LARGE CONFIGURATION_DEADLINE CLOCK_INVALID CLOCK_REVERSED CLOCK_SKEW ORIGINAL_DEADLINE ABORTED STDERR_PRESENT OVERFLOW TRANSPORT_FAILED UNEXPECTED_OUTPUT UNEXPECTED_EXIT COMMAND_REJECTED INDEPENDENT_GATE_REQUIRED POSITIVE_WINDOW_EXPIRED INDEPENDENT_LEASE_EXPIRED DENIAL_TOO_EARLY LOGIN_REQUIRED CONCURRENT_REQUEST SESSION_CLOSED GATE_STATE_REJECTED INDEPENDENT_GATE_REJECTED CANARY_RECEIPT_MISMATCH CONTROL_ORDER READY_REQUIRED CONFIGURATION_REQUIRED CONSUMED_SLOT COMMAND_LIMIT RESPONSE_DEADLINE READ_LIMIT INVALID_CHUNK NONZERO_EXIT INVALID_RESPONSE HELPER_CLOSED HELPER_DEADLINE UNVERIFIED_RESPONSE EARLY_EXIT INCOMPLETE_RESPONSE READOUT_FAILED TEARDOWN_UNCONFIRMED STOP_TIMEOUT UNEXPECTED_CLOSE_OUTPUT').split(' '));
export class ContractError extends Error {
  constructor(code) { const safe = ERROR_CODES.has(code) ? code : 'INVALID_DTO'; super(`Helper contract rejected (${safe}).`); Object.defineProperty(this, 'code', { value: safe, enumerable: true }); }
}
export function contractCode(error, fallback = 'INVALID_DTO') {
  try { const d = Object.getOwnPropertyDescriptor(error, 'code'); return error instanceof ContractError && d && Object.hasOwn(d, 'value') && ERROR_CODES.has(d.value) ? d.value : fallback; }
  catch { return fallback; }
}
export function requireContract(ok, code = 'INVALID_DTO') { if (!ok) throw new ContractError(code); }
export function exact(value, keys) {
  requireContract(value && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}
export function uuid(value) { requireContract(typeof value === 'string' && UUID.test(value)); return value; }
export function instant(value) {
  requireContract(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value));
  const number = Date.parse(value); requireContract(Number.isFinite(number));
  // Reject normalized invalid calendar dates, retain the exact original T0 text.
  requireContract(new Date(number).toISOString().slice(0, 19) === value.slice(0, 19));
  const fraction = value.match(/\.(\d{1,6})Z$/)?.[1] ?? '';
  return number + (Number(fraction.padEnd(6, '0')) % 1000) / 1000;
}
export function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
// Object-only boundary: never execute getters, proxies' values, toJSON or prototypes.
// Proxies cannot be authenticated by JS; callers must provide trusted plain DTOs.
export function copyDto(input) {
  let nodes = 0, bytes = 0;
  function visit(value, depth) {
    requireContract(++nodes <= 4096 && depth <= 10);
    if (typeof value === 'string') { bytes += value.length; requireContract(value.length <= 4096 && bytes <= 131072 && /^[\x20-\x7e]*$/.test(value)); return value; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { requireContract(Number.isFinite(value)); return value; }
    requireContract(value && typeof value === 'object');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    requireContract(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null);
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    requireContract(keys.every(key => typeof key === 'string' && !['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)));
    if (array) requireContract(value.length <= 128 && keys.length === value.length + 1);
    const result = array ? [] : {};
    for (const key of keys) {
      const d = descriptors[key]; requireContract(Object.hasOwn(d, 'value') && !d.get && !d.set);
      if (array && key === 'length') continue;
      if (array) requireContract(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length);
      result[key] = visit(d.value, depth + 1);
    }
    return result;
  }
  return visit(input, 0);
}
function sameSet(a, b) { return Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && [...a].sort().join(',') === [...b].sort().join(','); }
function canonical(value) { return JSON.stringify(value, function(key, v) { return v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v; }); }
export function bindingMatches(a, b) { return canonical(a) === canonical(b); }
export function validateBinding(input) {
  const b = copyDto(input);
  exact(b, ['run_id', 'authorization_id', 'candidate_sha', 'helper_sha256', 'pins', 't0', 'identities', 'historical_ids']);
  uuid(b.run_id); uuid(b.authorization_id); requireContract(b.candidate_sha === CANDIDATE && b.helper_sha256 === HELPER_HASH);
  instant(b.t0); exact(b.identities, LABELS); LABELS.forEach(label => uuid(b.identities[label]));
  requireContract(new Set(Object.values(b.identities)).size === 3);
  requireContract(Array.isArray(b.historical_ids) && b.historical_ids.length === HISTORICAL_COUNT && new Set(b.historical_ids).size === HISTORICAL_COUNT);
  b.historical_ids.forEach(id => { uuid(id); requireContract(!Object.values(b.identities).includes(id)); });
  exact(b.pins, ['operations_service_id', 'operations_sha', 'core_service_id', 'core_sha', 'preview_site_id', 'preview_sha', 'supabase_project_ref']);
  requireContract(b.pins.operations_service_id === 'c0c6e5e2-0040-48e0-a0af-abfb1ec81b61' && b.pins.operations_sha === CANDIDATE &&
    b.pins.core_service_id === 'fc97f78f-d39e-4598-a615-b2413b9b3f76' && b.pins.core_sha === '0134f603445ea7f282ef0cb866d0f3591518cbb9' &&
    b.pins.preview_site_id === 'd763b7a1-dccd-4638-8876-ac1670171698' && b.pins.preview_sha === CANDIDATE && b.pins.supabase_project_ref === 'yclqnbcrchwieyzkyumx');
  return frozen(b);
}
export function validateAuthority(input, binding, at) {
  const a = copyDto(input); exact(a, ['binding', 'owner_go_verified', 'consumed', 'max_new_accounts', 'issued_at', 'expires_at', 'public_go']);
  requireContract(bindingMatches(a.binding, binding) && a.owner_go_verified === true && a.consumed === false && a.max_new_accounts === 3 && a.public_go === false, 'AUTHORITY_REJECTED');
  requireContract(!CONSUMED_RUNS.includes(binding.run_id) && !CONSUMED_AUTHORITIES.includes(binding.authorization_id), 'CONSUMED_AUTHORITY');
  const t0 = instant(binding.t0), expiry = instant(a.expires_at);
  requireContract(instant(a.issued_at) <= t0 && expiry <= t0 + 1800000 && expiry > t0 && at >= t0 && at < expiry, 'AUTHORITY_EXPIRED');
  return frozen(a);
}

/** DTOs cannot authenticate their source. trustedInput=true is a caller
 * precondition, NEVER owner authorization issued by this reducer. */
export function reduceEvidence(bindingInput, evidenceInput, { at, trustedInput = false } = {}) {
  const reasons = []; const add = code => { if (!reasons.includes(code)) reasons.push(code); };
  let canary = 'UNKNOWN', functionality = 'UNKNOWN', cleanup = 'UNKNOWN', operatorEligible = false, cleanupLate = false, deadlineBreached = false;
  const result = () => frozen({ evaluationScope: 'GUARDED_F1_READ_ROUTE_CHECKLIST', canary, functionality, cleanup,
    f1: deadlineBreached || functionality === 'FAIL' || cleanup === 'FAIL' ? 'FAIL' : functionality === 'PASS' && cleanup === 'PASS' ? 'PASS' : 'UNKNOWN',
    operatorEligible: operatorEligible && functionality !== 'FAIL' && cleanup !== 'FAIL' && !deadlineBreached,
    cleanupLate, deadlineBreached, reasons, trustedInputRequired: true, grantsOwnerGo: false });
  if (trustedInput !== true) { add('UNTRUSTED_INPUT'); return result(); }
  let b, e, t0, now, authorityExpiry, envelopeValid = true;
  try {
    b = validateBinding(bindingInput); now = typeof at === 'string' ? instant(at) : at;
    requireContract(Number.isFinite(now)); t0 = instant(b.t0);
  } catch (error) { canary = functionality = 'FAIL'; add(contractCode(error)); return result(); }
  try { e = copyDto(evidenceInput); requireContract(e && !Array.isArray(e)); }
  catch { canary = functionality = 'FAIL'; add('INVALID_DTO'); return result(); }
  try {
    requireContract(Object.keys(e).every(k => ['binding', 'authority', 'budget', 'canary', 'independent', 'operators', 'cleanup'].includes(k)));
    requireContract(bindingMatches(e.binding, b), 'BINDING_MISMATCH');
  } catch (error) { envelopeValid = false; canary = functionality = 'FAIL'; add(contractCode(error)); }
  try { validateAuthority(e.authority, b, t0); authorityExpiry = instant(e.authority.expires_at); }
  catch (error) { functionality = 'FAIL'; authorityExpiry = t0 + 1800000; add(contractCode(error)); }
  const ids = Object.values(b.identities);
  function scoped(value) { requireContract(value && bindingMatches(value.binding, b), 'BINDING_MISMATCH'); }
  function timestamp(value, lower, upper) { const t = instant(value); requireContract(t >= lower && t < Math.min(upper, authorityExpiry), 'EVIDENCE_TIME_REJECTED'); return t; }
  function observation(obs, label, route, statuses, denied, lower, upper) {
    exact(obs, ['label', 'user_id', 'route', 'status', 'verified', 'denied', 'at']);
    requireContract(obs.label === label && obs.user_id === b.identities[label], 'IDENTITY_MISMATCH');
    requireContract(obs.route === route && statuses.includes(obs.status) && obs.verified === true && obs.denied === denied, 'OBSERVATION_REJECTED');
    return timestamp(obs.at, lower, Math.min(upper, now + 1));
  }
  function observations(value, label, requirements, lower, upper) {
    requireContract(Array.isArray(value) && value.length === requirements.length, 'MISSING_OBSERVATIONS');
    let last = lower;
    for (let i = 0; i < requirements.length; i++) {
      const [route, statuses, denied] = requirements[i];
      last = observation(value[i], label, route, statuses, denied, last, upper);
    }
    return last;
  }
  let banTime, gateTime, gateExpiry, lastObservation = t0;
  try {
    requireContract(envelopeValid, 'BINDING_MISMATCH');
    if (!e.budget || !e.canary) throw new ContractError('MISSING_CANARY_PROOF');
    exact(e.budget, ['binding', 'source', 'independent', 'known_created_ids', 'unknown_create_count', 'active_count', 'pending_activation_count', 'unresolved_nonce_count', 'at']);
    scoped(e.budget); requireContract(e.budget.source === 'guard_readback' && e.budget.independent === true && sameSet(e.budget.known_created_ids, ids) &&
      e.budget.unknown_create_count === 0 && e.budget.active_count === 0 && e.budget.pending_activation_count === 0 && e.budget.unresolved_nonce_count === 0, 'BUDGET_UNVERIFIED');
    exact(e.canary, ['binding', 'positive', 'ban', 'retained_denial', 'auth_denial', 'auth_user_banned_verified']); scoped(e.canary);
    observations(e.canary.positive, 'canary', [['login', [200], false], ['own_today', [200], false], ['foreign_today', [403], true]], t0, t0 + 120000);
    exact(e.canary.ban, ['source', 'independent', 'user_id', 'banned', 'at', 'readback_at']);
    requireContract(e.canary.ban.source === 'guard_readback' && e.canary.ban.independent === true && e.canary.ban.banned === true && e.canary.ban.user_id === b.identities.canary, 'CANARY_BAN_UNVERIFIED');
    banTime = timestamp(e.canary.ban.at, t0, t0 + 180000);
    const readback = timestamp(e.canary.ban.readback_at, banTime, Math.min(t0 + 180000, now + 1));
    const retained = observation(e.canary.retained_denial, 'canary', 'me', [401, 403], true, Math.max(t0 + 120000, readback), t0 + 180000);
    const auth = observation(e.canary.auth_denial, 'canary', 'denied_login', [400, 401, 403], true, retained, t0 + 180000);
    requireContract(e.canary.auth_user_banned_verified === true, 'AUTH_DENIAL_UNVERIFIED');
    timestamp(e.budget.at, auth, Math.min(t0 + 600000, now + 1));
    canary = 'PASS';
  } catch (error) {
    const code = contractCode(error);
    canary = code === 'MISSING_OBSERVATIONS' || code === 'MISSING_CANARY_PROOF' ? 'UNKNOWN' : 'FAIL';
    if (functionality !== 'FAIL') functionality = canary; add(code);
  }
  if (canary === 'PASS' && functionality !== 'FAIL') {
    try {
      if (!e.independent) { add('MISSING_INDEPENDENT_VERDICT'); }
      else {
        exact(e.independent, ['binding', 'source', 'decision', 'lease_digest', 'evidence_ref', 'at', 'expires_at']); scoped(e.independent);
        requireContract(e.independent.source === 'cto_checkpoint' && e.independent.decision === 'pass' && HEX.test(e.independent.lease_digest) &&
          /^https:\/\/github\.com\/erikkaniss-ai\/fillmycourt\/pull\/8#issuecomment-[0-9]+$/.test(e.independent.evidence_ref), 'INDEPENDENT_VERDICT_REJECTED');
        gateTime = timestamp(e.independent.at, Math.max(t0 + 180000, instant(e.budget.at)), t0 + 600000);
        gateExpiry = timestamp(e.independent.expires_at, gateTime + 1, t0 + 600001);
        operatorEligible = now >= gateTime && now < gateExpiry && now < t0 + 600000 && now < instant(e.authority.expires_at);
      }
    } catch (error) { functionality = 'FAIL'; add(contractCode(error)); }
  }
  if (canary === 'PASS' && gateTime !== undefined && gateExpiry !== undefined && functionality !== 'FAIL') {
    try {
      if (!e.operators) add('MISSING_OPERATOR_PROOF');
      else {
        exact(e.operators, ['a', 'b']);
        for (const label of ['a', 'b']) {
          exact(e.operators[label], ['binding', 'observations']); scoped(e.operators[label]);
          const obs = e.operators[label].observations;
          observations(obs, label, [['login', [200], false], ['me', [200], false], ['organizations', [200], false],
            ['own_today', [200], false], ['foreign_today', [403], true], ['own_calendar', [200], false], ['foreign_calendar', [403], true],
            ['provider_connections', [label === 'b' ? 403 : 200], label === 'b']], gateTime, t0 + 1200000);
          requireContract(instant(obs[0].at) < Math.min(gateExpiry, t0 + 600000), 'OPERATOR_LOGIN_LATE');
        }
        functionality = 'PASS';
      }
    } catch (error) { const code = contractCode(error); functionality = code === 'MISSING_OBSERVATIONS' ? 'UNKNOWN' : 'FAIL'; add(code); }
  }
  try {
    if (!e.cleanup) add('MISSING_CLEANUP');
    else {
      exact(e.cleanup, ['binding', 'source', 'independent', 'known_banned_ids', 'historical_banned_ids', 'unknown_create_count', 'active_count', 'pending_activation_count', 'unresolved_nonce_count', 'at']);
      scoped(e.cleanup);
      requireContract(e.cleanup.source === 'guard_readback' && e.cleanup.independent === true && sameSet(e.cleanup.known_banned_ids, ids) && sameSet(e.cleanup.historical_banned_ids, b.historical_ids) &&
        e.cleanup.unknown_create_count === 0 && e.cleanup.active_count === 0 && e.cleanup.pending_activation_count === 0 && e.cleanup.unresolved_nonce_count === 0, 'CLEANUP_UNVERIFIED');
      if (functionality === 'PASS') for (const label of ['a', 'b']) {
        lastObservation = Math.max(lastObservation, instant(e.operators[label].observations.at(-1).at));
      }
      const cleanupTime = instant(e.cleanup.at);
      requireContract(cleanupTime >= Math.max(lastObservation, banTime ?? t0) && cleanupTime <= now, 'CLEANUP_TIME_REJECTED');
      // Cleanup must continue after expiry. Report eventual blocking separately
      // from the immutable execution-deadline violation; never renew authority.
      cleanupLate = cleanupTime >= Math.min(t0 + 1800000, authorityExpiry);
      if (cleanupLate) { deadlineBreached = true; add('CLEANUP_AFTER_ORIGINAL_DEADLINE'); }
      cleanup = 'PASS';
    }
  } catch (error) { cleanup = 'FAIL'; add(contractCode(error)); }
  return result();
}
