// Plain-JSONL fictional mock ONLY. No live helper, network or credential target.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { COMMANDS, MAX_BYTES, fixtureCommandName, fixtureReply, HelperContractReadout, validateTimings } from './fill_uat_helper_contract.mjs';

export const WATCHDOG_MS = 20_000;
export const SCENARIOS = Object.freeze(['normal', 'fragmented', 'crlf', 'sgr', 'echo', 'duplicate', 'late', 'closed',
  'deadline', 'nonzero', 'early_eof', 'overflow', 'stderr', 'unverified', 'wrong_tuple', 'stall', 'wrong_schema', 'ready_twice']);
const SELF = fileURLToPath(import.meta.url);
const control = (route, verified) => ({ label: '', route, status: 0, request_id: '', verified, denied: false });
export function syntheticInputAccepted(line) {
  if (typeof line !== 'string' || line.length > 4096 || /[^\x20-\x7e]/.test(line)) return null;
  try { return fixtureCommandName(JSON.parse(line)); } catch { return null; }
}

async function producer(scenario) {
  const watchdog = setTimeout(() => process.exit(70), WATCHDOG_MS);
  const write = value => new Promise(resolveWrite => process.stdout.write(value, resolveWrite));
  const emit = async value => {
    let raw = JSON.stringify(value) + '\n';
    if (scenario === 'crlf') raw = raw.replace(/\n/g, '\r\n');
    if (scenario === 'sgr') raw = '\x1b[32m' + raw.slice(0, -1) + '\x1b[0m\n';
    if (scenario === 'fragmented' || scenario === 'sgr') {
      for (let i = 0; i < raw.length; i += 7) await write(raw.slice(i, i + 7));
    } else await write(raw);
  };
  let configured = false, gate = false, busy = false, buffer = '', halted = false;
  const used = new Set(), loggedIn = new Set();
  const fatal = async () => { if (halted) return; halted = true; buffer = ''; await emit(control('closed', false));
    clearTimeout(watchdog); process.stdin.destroy(); process.stdout.end(); process.exitCode = 0; };
  await emit(control('ready', true));
  if (scenario === 'ready_twice') await emit(control('ready', true));
  process.stdin.setEncoding('utf8');
  process.stdin.on('error', () => { void fatal(); });
  process.stdin.on('end', () => {
    if (!configured) { void fatal(); return; }
    clearTimeout(watchdog); process.stdout.end(); process.exitCode = 0;
  });
  process.stdin.on('data', async data => {
    if (halted) return;
    if (busy || data.length > 4097 - buffer.length) return void fatal();
    buffer += data;
    const end = buffer.indexOf('\n');
    if (end < 0) return;
    const name = syntheticInputAccepted(buffer.slice(0, end));
    if (!name || buffer.slice(end + 1)) return void fatal();
    buffer = ''; busy = true;
    const c = COMMANDS[name];
    if (name === 'configure') {
      if (configured) return void fatal(); configured = true;
    } else {
      if (!configured || used.has(name)) return void fatal(); used.add(name);
      if (name === 'operator_gate') { if (gate) return void fatal(); gate = true; }
      else {
        if (c.label !== 'canary' && !gate) return void fatal();
        if (['get', 'denied_get'].includes(c.op) && !loggedIn.has(c.label)) return void fatal();
        if (c.op === 'login') loggedIn.add(c.label);
      }
    }
    let reply = fixtureReply(name);
    if (name === 'canary_login') {
      if (scenario === 'stall') return;
      if (scenario === 'closed' || scenario === 'deadline') reply = control(scenario, false);
      if (scenario === 'nonzero' || scenario === 'early_eof') { clearTimeout(watchdog); process.exit(scenario === 'nonzero' ? 7 : 0); }
      if (scenario === 'echo') await write(JSON.stringify(c) + '\n');
      if (scenario === 'overflow') await write('x'.repeat(MAX_BYTES + 1));
      if (scenario === 'stderr') process.stderr.write('SYNTHETIC_STDERR\n');
      if (scenario === 'late') await emit(fixtureReply('configure'));
      if (scenario === 'unverified') reply = { ...reply, status: 500, verified: false };
      if (scenario === 'wrong_tuple') reply = { ...reply, label: 'a' };
      if (scenario === 'wrong_schema') reply = { ...reply, nested: {} };
      if (scenario === 'duplicate') await emit(reply);
    }
    await emit(reply); busy = false;
    if (reply.route === 'closed' || reply.route === 'deadline') {
      halted = true; clearTimeout(watchdog); process.stdin.destroy(); process.stdout.end();
      process.exitCode = reply.route === 'deadline' ? 90 : 0;
    }
  });
}

// Fixed mock-only process and finite scenarios. No executable/path/env overrides.
export function createSyntheticHelper(scenario = 'normal', options = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error('INVALID_SCENARIO');
  validateTimings(options);
  const executable = typeof process !== 'undefined' ? process.execPath : 'node';
  const child = spawn(executable, [SELF, scenario], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: typeof process !== 'undefined' && process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {} });
  let closed = false, stopping = false, bytes = 0, pending, onFatal, onOutput, onExit, resolveClose;
  const queue = [], closeObserved = new Promise(resolve => { resolveClose = resolve; });
  const deliver = value => { if (pending) { const receive = pending; pending = undefined; receive(value); } else queue.push(value); };
  const fatal = code => { queue.length = 0; bytes = 0; deliver({ output: '', error: code }); onFatal?.(code); };
  child.stdout.on('data', data => {
    if (stopping || closed) return; onOutput?.(); if (stopping) return;
    if (data.length > MAX_BYTES - bytes) return fatal('OVERFLOW');
    bytes += data.length; deliver({ output: data.toString('utf8') });
  });
  child.stderr.on('data', () => { if (!stopping) fatal('STDERR_PRESENT'); });
  child.on('error', () => fatal('TRANSPORT_FAILED'));
  child.stdin.on('error', () => { if (!stopping) fatal('TRANSPORT_FAILED'); });
  child.once('close', code => {
    closed = true; deliver({ output: '', exit_code: Number.isInteger(code) ? code : 1, eof: true }); resolveClose(true); onExit?.();
  });
  return new HelperContractReadout({
    observe(a, b, c) { onFatal = a; onOutput = b; onExit = c; },
    get closed() { return closed; }, get pid() { return child.pid; },
    get pendingOutput() { return queue.some(c => c.output?.length); },
    write(line, { signal }) {
      if (signal.aborted || closed || stopping || !line.endsWith('\n') || !syntheticInputAccepted(line.slice(0, -1))) throw Error('WRITE_REJECTED');
      return new Promise((resolve, reject) => child.stdin.write(line, error => error ? reject(Error('WRITE_FAILED')) : resolve()));
    },
    end() { child.stdin.end(); },
    async read({ signal }) {
      if (queue.length) { const value = queue.shift(); bytes -= value.output?.length || 0; return value; }
      if (closed || signal.aborted) return { output: '', eof: true };
      if (pending) throw Error('CONCURRENT_READ');
      return await new Promise(resolve => {
        const abort = () => { pending = undefined; resolve({ output: '', eof: true }); };
        pending = value => { signal.removeEventListener('abort', abort); bytes -= value.output?.length || 0; resolve(value); };
        signal.addEventListener('abort', abort, { once: true });
      });
    },
    async stop({ force }) { stopping = true; queue.length = 0; bytes = 0; if (!closed && force) child.kill(); await closeObserved; return closed; },
  }, options);
}

if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === SELF) {
  if (process.argv.length === 3 && SCENARIOS.includes(process.argv[2])) await producer(process.argv[2]);
  else process.exitCode = 64;
}
