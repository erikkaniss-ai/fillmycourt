// Fixed fictional producer only. No Auth, network, helper, credentials or config.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const WATCHDOG_MS = 20_000;
export const PHASES = Object.freeze(['configure', 'positive', 'negative', 'operator_simulation', 'close']);
export const SCENARIOS = Object.freeze(['normal', 'echo', 'stderr', 'wrong_session', 'wrong_phase',
  'duplicate', 'early_eof', 'nonzero', 'missing_end', 'overflow', 'late_phase', 'unverified',
  'invalid_control', 'extra_after_end', 'zero_without_end', 'stall']);
const event = (label, route, status = 0, verified = true, denied = false) =>
  Object.freeze({ label, route, status, request_id: '', verified, denied });
export const EVENTS = Object.freeze({
  configure: Object.freeze([event('', 'ready'), event('', 'configure')]),
  positive: Object.freeze([event('canary', 'login', 200), event('canary', 'own_today', 200),
    event('canary', 'foreign_today', 403, true, true)]),
  negative: Object.freeze([event('canary', 'denied_login', 400, true, true), event('canary', 'me', 401, true, true)]),
  operator_simulation: Object.freeze([event('a', 'own_calendar', 200), event('a', 'foreign_calendar', 403, true, true),
    event('b', 'own_today', 200), event('b', 'foreign_today', 403, true, true)]),
  // The frozen parser correctly requires verified=false on the terminal control.
  close: Object.freeze([event('', 'closed', 0, false)]),
});
export function frame(identity, sequence, phase, boundary) {
  return `FMC_SYNTHETIC/1 ${identity} ${sequence} ${phase} ${boundary}\n`;
}

async function producer(scenario) {
  const watchdog = setTimeout(() => process.exit(70), WATCHDOG_MS);
  const identity = randomBytes(16).toString('hex');
  const write = value => new Promise(resolveWrite => process.stdout.write(value, resolveWrite));
  const fail = () => { clearTimeout(watchdog); process.exit(64); };
  let input = '', index = 0, busy = false;
  await write(frame(identity, 0, 'hello', 'begin'));
  process.stdin.setEncoding('utf8');
  process.stdin.on('error', fail);
  process.stdin.on('end', () => { if (index < PHASES.length) fail(); });
  process.stdin.on('data', async chunk => {
    // One finite literal command per phase. No arbitrary payload or pipelining.
    if (busy || chunk.length > 128 - input.length) return fail();
    input += chunk;
    const end = input.indexOf('\n');
    if (end < 0) return;
    const command = input.slice(0, end);
    if (input.slice(end + 1) || command !== `SYNTHETIC_SENTINEL:${PHASES[index]}`) return fail();
    input = ''; busy = true;
    const phase = PHASES[index], sequence = ++index;
    if (phase === 'positive' && scenario === 'stall') return;
    if (phase === 'positive' && scenario === 'early_eof') { clearTimeout(watchdog); process.exit(0); }
    if (phase === 'positive' && scenario === 'nonzero') { clearTimeout(watchdog); process.exit(7); }
    let records = EVENTS[phase].map(value => JSON.stringify(value) + '\n').join('');
    if (phase === 'positive' && scenario === 'unverified') {
      records = EVENTS[phase].map((value, i) => JSON.stringify(i ? value : { ...value, status: 500, verified: false }) + '\n').join('');
    }
    if (phase === 'operator_simulation') records = '\x1b[32m' + records + '\x1b[0m';
    // Keep formatting on record lines, never on synthetic boundary frames.
    if (phase === 'operator_simulation') records = records.replace(/\n\x1b\[0m$/, '\x1b[0m\n');
    let wire = frame(identity, sequence, phase, 'begin') + records + frame(identity, sequence, phase, 'end');
    if (phase === 'negative') wire = wire.replace(/\n/g, '\r\n');
    if (phase === 'positive') {
      if (scenario === 'echo') wire = 'SYNTHETIC_SENTINEL:positive\n' + wire;
      if (scenario === 'stderr') process.stderr.write('SYNTHETIC_STDERR\n');
      if (scenario === 'wrong_session') wire = wire.replace(identity, 'f'.repeat(32) === identity ? 'e'.repeat(32) : 'f'.repeat(32));
      if (scenario === 'wrong_phase') wire = wire.replace('2 positive begin', '3 negative begin');
      if (scenario === 'duplicate') wire = wire.replace(records, records + records);
      if (scenario === 'missing_end' || scenario === 'zero_without_end') wire = wire.slice(0, wire.lastIndexOf('FMC_SYNTHETIC/1'));
      if (scenario === 'overflow') wire = 'x'.repeat(65_537);
      if (scenario === 'late_phase') wire = frame(identity, 1, 'configure', 'end') + wire;
      if (scenario === 'invalid_control') wire = '\x1b[2K' + wire;
      if (scenario === 'extra_after_end') wire += '{}\n';
    }
    for (let offset = 0; offset < wire.length; offset += 11) await write(wire.slice(offset, offset + 11));
    busy = false;
    if (phase === 'positive' && scenario === 'zero_without_end') { clearTimeout(watchdog); process.exit(0); }
    if (phase === 'close') {
      clearTimeout(watchdog);
      process.stdin.destroy();
      process.stdout.end();
      process.exitCode = 0;
    }
  });
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  if (process.argv.length === 3 && SCENARIOS.includes(process.argv[2])) await producer(process.argv[2]);
  else process.exitCode = 64;
}
