// Fixed PUBLIC fictional DTO child. No network/live helper/credential inputs.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CANDIDATE, HELPER_HASH, LABELS, GET_ROUTES } from './fill_uat_evidence_verdict.mjs';

export const WATCHDOG_MS = 20_000;
export const SCENARIOS = Object.freeze(['normal', 'fragmented', 'crlf', 'sgr', 'echo', 'stderr', 'overflow', 'nonascii',
  'duplicate', 'closed', 'deadline', 'wrong_tuple', 'unverified', 'nonzero', 'early_eof', 'stall', 'ready_twice', 'close_nonzero', 'setup_failure']);
const ID = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2030-01-01T00:00:00Z');
export function publicFixture() {
  const binding = { run_id: ID(9000), authorization_id: ID(9001), candidate_sha: CANDIDATE, helper_sha256: HELPER_HASH,
    t0: new Date(T0).toISOString(), identities: { canary: ID(9010), a: ID(9011), b: ID(9012) },
    historical_ids: Array.from({ length: 17 }, (_, i) => ID(9100 + i)),
    pins: { operations_service_id: 'c0c6e5e2-0040-48e0-a0af-abfb1ec81b61', operations_sha: CANDIDATE,
      core_service_id: 'fc97f78f-d39e-4598-a615-b2413b9b3f76', core_sha: '0134f603445ea7f282ef0cb866d0f3591518cbb9',
      preview_site_id: 'd763b7a1-dccd-4638-8876-ac1670171698', preview_sha: CANDIDATE, supabase_project_ref: 'yclqnbcrchwieyzkyumx' } };
  const authority = { binding, owner_go_verified: true, consumed: false, max_new_accounts: 3, issued_at: new Date(T0 - 1000).toISOString(), expires_at: new Date(T0 + 1800000).toISOString(), public_go: false };
  const config = { op: 'configure', approved_helper_sha256: HELPER_HASH, plan: { candidate_sha: CANDIDATE, run_id: binding.run_id,
    authorization_id: binding.authorization_id, t0: binding.t0, date: '2030-01-01', calendar_start: binding.t0,
    calendar_end: '2030-01-02T00:00:00.000Z', publishable_key: 'sb_publishable_SYNTHETIC_SENTINEL_PUBLIC_KEY',
    principals: Object.fromEntries(LABELS.map(label => [label, { id: binding.identities[label], password: `SYNTHETIC_SENTINEL:${label}:` + 'X'.repeat(45) }])) } };
  return JSON.parse(JSON.stringify({ binding, authority, config }));
}
const COMMANDS = Object.freeze(LABELS.flatMap(label => ['login', 'denied_login'].map(op => ({ op, label }))
  .concat(GET_ROUTES.flatMap(route => ['get', 'denied_get'].map(op => ({ op, label, route }))))));
export function acceptsPublicLine(line) {
  // Exact raw canonical text also rejects duplicate JSON keys and substitutions.
  return typeof line === 'string' && line.length <= 16383 &&
    (line === JSON.stringify(publicFixture().config) || COMMANDS.some(c => line === JSON.stringify(c)));
}
const safeEvent = (label, route, status = 0, verified = true, denied = false) => ({ label, route, status, request_id: '', verified, denied });
async function producer(scenario) {
  const watchdog = setTimeout(() => process.exit(70), WATCHDOG_MS);
  let buffer = '', configured = false, busy = false, halted = false; const used = new Set(), sessions = new Set();
  const write = value => new Promise(resolveWrite => process.stdout.write(value, resolveWrite));
  const emit = async e => {
    let raw = JSON.stringify(e) + '\n';
    if (scenario === 'crlf') raw = raw.replace(/\n/g, '\r\n');
    if (scenario === 'sgr') raw = '\x1b[32m' + raw.slice(0, -1) + '\x1b[0m\n';
    if (scenario === 'fragmented' || scenario === 'sgr') for (let i = 0; i < raw.length; i += 7) await write(raw.slice(i, i + 7));
    else await write(raw);
  };
  const finish = code => { halted = true; buffer = ''; clearTimeout(watchdog); process.stdin.destroy(); process.stdout.end(); process.exitCode = code; };
  const reject = async () => { if (!halted) { halted = true; await emit(safeEvent('', 'closed', 0, false)); finish(0); } };
  await emit(safeEvent('', 'ready')); if (scenario === 'ready_twice') await emit(safeEvent('', 'ready'));
  process.stdin.setEncoding('utf8'); process.stdin.on('error', () => { void reject(); });
  process.stdin.on('end', () => { if (!configured) void reject(); else finish(scenario === 'close_nonzero' ? 7 : 0); });
  process.stdin.on('data', async data => {
    if (halted) return;
    if (busy || data.length > 16384 - buffer.length) return void reject();
    buffer += data; const index = buffer.indexOf('\n'); if (index < 0) return;
    const raw = buffer.slice(0, index); if (buffer.slice(index + 1) || !acceptsPublicLine(raw)) return void reject();
    buffer = ''; busy = true; const c = JSON.parse(raw), slot = `${c.op}:${c.label ?? ''}:${c.route ?? ''}`;
    if (used.has(slot) || c.op !== 'configure' && !configured) return void reject(); used.add(slot);
    let e;
    if (c.op === 'configure') { if (configured) return void reject(); configured = true; e = safeEvent('', 'configure'); }
    else if (c.op === 'login') { sessions.add(c.label); e = safeEvent(c.label, 'login', 200); }
    else if (c.op === 'denied_login') e = safeEvent(c.label, 'denied_login', 400, true, true);
    else {
      if (!sessions.has(c.label)) return void reject();
      const denied = c.op === 'denied_get' || c.route.startsWith('foreign_') || c.route === 'provider_connections' && c.label === 'b';
      e = safeEvent(c.label, c.route, denied ? c.op === 'denied_get' ? 401 : 403 : 200, true, denied);
    }
    if (c.op === 'login' && c.label === 'canary') {
      if (scenario === 'stall') return;
      if (scenario === 'nonzero' || scenario === 'early_eof') return finish(scenario === 'nonzero' ? 7 : 0);
      if (scenario === 'echo') await write(raw + '\n');
      if (scenario === 'stderr') process.stderr.write('SYNTHETIC_SENTINEL_STDERR\n');
      if (scenario === 'overflow') await write('x'.repeat(65537));
      if (scenario === 'nonascii') await write('\u0080\n');
      if (scenario === 'duplicate') await emit(e);
      if (scenario === 'closed' || scenario === 'deadline') e = safeEvent('', scenario, 0, false);
      if (scenario === 'wrong_tuple') e = { ...e, label: 'a' };
      if (scenario === 'unverified') e = { ...e, status: 500, verified: false };
    }
    await emit(e); busy = false;
    if (e.route === 'closed' || e.route === 'deadline') finish(e.route === 'deadline' ? 90 : 0);
  });
}
if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && SCENARIOS.includes(process.argv[2])) await producer(process.argv[2]);
  else process.exitCode = 64;
}
