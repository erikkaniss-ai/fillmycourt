import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { OwnedStdioTransport, createSentinelCollector, launchReviewedLiveCollector, validateCurrentPermit, PERMIT_FRESH_MS, observeOwnedChild } from '../scripts/fill_uat_process_transport.mjs';
import { publicFixture, acceptsPublicLine, SCENARIOS, WATCHDOG_MS } from '../scripts/fill_uat_synthetic_wire_child.mjs';

function fakeChild({ backpressure = false, closeOnKill = true, writeError = false, throwSetup = false, destroyError = false } = {}) {
  const child = new EventEmitter(), stdin = new EventEmitter(); let kills = 0, callback;
  Object.assign(stdin, { write(_line, cb) { callback = cb; if (writeError) cb(Error('SYNTHETIC_NEGATIVE_SECRET')); else cb(); return !backpressure; },
    end() {}, destroy() { if (destroyError) throw Error('SYNTHETIC_NEGATIVE_SECRET'); } });
  Object.assign(child, { pid: 12345, stdin, stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { kills++; if (closeOnKill) queueMicrotask(() => { child.emit('exit', 0); child.stdout.end(); child.stderr.end(); child.emit('close', 0); }); return closeOnKill; } });
  if (throwSetup) child.stdout.on = () => { throw Error('SYNTHETIC_NEGATIVE_SECRET'); };
  return { child, stdin, get kills() { return kills; }, finishWrite() { callback?.(); } };
}
const engineFor = (f, options = {}) => new OwnedStdioTransport(f.child, { deadlineMono: performance.now() + 1000, stopMs: 30, ...options });
async function setup(s) { assert.equal((await s.collector.ready()).responseComplete, true); assert.equal((await s.collector.configure()).responseComplete, true); }

test('native fixed sentinel→new transport→FROZEN collector, plain JSONL and separate observed close', async () => {
  const s = await createSentinelCollector('fragmented');
  try {
    const original = s.processEvidence().originalDeadlineMono, expiry = s.collector.snapshot.originalExpiresAt;
    await setup(s); const pid = s.processEvidence().processId;
    for (const [age, command] of [[60, { op: 'login', label: 'canary' }], [61, { op: 'get', label: 'canary', route: 'own_today' }],
      [62, { op: 'get', label: 'canary', route: 'foreign_today' }], [130, { op: 'denied_get', label: 'canary', route: 'me' }], [131, { op: 'denied_login', label: 'canary' }]]) {
      s.advanceFixtureAge(age); const r = await s.collector.command(command);
      assert.equal(r.responseComplete, true, r.code); assert.equal(r.boundaryVerified, false); assert.equal(r.grantsOwnerGo, false);
      assert.equal(s.processEvidence().processId, pid); assert.equal(s.processEvidence().processClosedObserved, false);
    }
    const r = await s.collector.close(); assert.equal(r.code, 'PROCESS_CLOSED_UNAUTHENTICATED'); assert.equal(r.stopConfirmed, true);
    const p = s.processEvidence(); assert.equal(p.processClosedObserved, true); assert.equal(p.stdoutEOFObserved, true);
    assert.equal(p.exitObserved, true); assert.equal(p.exitCode, 0); assert.equal(p.originalDeadlineMono, original);
    assert.equal(s.collector.snapshot.originalExpiresAt, expiry); assert.equal(p.modelClock, true); assert.equal(p.actualHelperLaunched, false);
    assert.equal(p.accountCleanupVerified, false); assert.equal(r.cleanupIntentRequired, true);
  } finally { await s.collector.abort(); }
});
for (const scenario of ['normal', 'crlf', 'sgr']) test(`native plain-wire ${scenario} is no-echo with bounded observed teardown`, async () => {
  const s = await createSentinelCollector(scenario);
  try { await setup(s); assert.equal((await s.collector.command({ op: 'login', label: 'canary' })).responseComplete, true); assert.equal((await s.collector.close()).stopConfirmed, true); }
  finally { await s.collector.abort(); }
});
for (const scenario of ['echo', 'stderr', 'overflow', 'nonascii', 'duplicate', 'closed', 'deadline', 'wrong_tuple', 'unverified', 'nonzero', 'early_eof', 'stall']) {
  test(`native fault ${scenario} fences frozen collector and confirms only owned-process closure`, async () => {
    const s = await createSentinelCollector(scenario, { responseMs: 700 });
    try {
      await setup(s); const r = await s.collector.command({ op: 'login', label: 'canary' });
      if (scenario === 'duplicate' && r.responseComplete) { await new Promise(resolve => setTimeout(resolve, 50)); assert.ok(s.collector.snapshot.fatal); }
      else { assert.equal(r.responseComplete, false); assert.deepEqual(r.events, []); }
      assert.equal(s.processEvidence().processClosedObserved, true); assert.equal(s.collector.snapshot.stopConfirmed, true);
      assert.equal(s.processEvidence().accountCleanupVerified, false); assert.equal(s.collector.snapshot.cleanupIntentRequired, true);
      assert.equal((await s.collector.command({ op: 'get', label: 'canary', route: 'me' })).responseComplete, false);
    } finally { await s.collector.abort(); }
  });
}
test('repeated ready and nonzero clean-close path never grant response/process success', async () => {
  const repeated = await createSentinelCollector('ready_twice');
  try { await repeated.collector.ready(); await new Promise(resolve => setTimeout(resolve, 50)); assert.ok(repeated.collector.snapshot.fatal); assert.equal(repeated.processEvidence().processClosedObserved, true); }
  finally { await repeated.collector.abort(); }
  const nonzero = await createSentinelCollector('close_nonzero');
  try { await setup(nonzero); assert.notEqual((await nonzero.collector.close()).code, 'PROCESS_CLOSED_UNAUTHENTICATED'); assert.equal(nonzero.processEvidence().processClosedObserved, true); }
  finally { await nonzero.collector.abort(); }
});
test('deterministic POST-SPAWN constructor rejection observes kill+close before factory rejects', async () => {
  await assert.rejects(createSentinelCollector('setup_failure'), error => {
    assert.equal(error.code, 'PROCESS_ERROR'); assert.equal(error.processLaunched, true); assert.ok(Number.isInteger(error.processId));
    assert.equal(error.processClosedObserved, true); assert.equal(error.stopConfirmed, true); assert.equal(error.accountCleanupVerified, false); return true;
  });
});
test('canonical public-only child input rejects substitutions, duplicate JSON and arbitrary payloads', () => {
  const config = publicFixture().config; assert.equal(acceptsPublicLine(JSON.stringify(config)), true);
  for (const mutate of [c => { c.plan.principals.a.password = 'SYNTHETIC_NEGATIVE_PASSWORD'; },
    c => { c.plan.publishable_key = 'sb_secret_SYNTHETIC_NEGATIVE'; }, c => { c.plan.run_id = 'SYNTHETIC_NEGATIVE_RUN'; },
    c => { c.plan.principals.a.id = 'SYNTHETIC_NEGATIVE_USER'; }, c => { c.plan.url = 'https://synthetic.invalid'; }]) {
    const c = structuredClone(config); mutate(c); assert.equal(acceptsPublicLine(JSON.stringify(c)), false);
  }
  assert.equal(acceptsPublicLine(JSON.stringify(config).replace('"op":"configure"', '"op":"configure","op":"configure"')), false);
  assert.equal(acceptsPublicLine('{"op":"login","label":"canary","password":"SYNTHETIC_NEGATIVE"}'), false);
  assert.equal(acceptsPublicLine('x'.repeat(16384)), false);
});
test('backpressure requires BOTH write callback and drain; no secret reflected in metadata', async () => {
  const f = fakeChild({ backpressure: true }), e = engineFor(f); let done = false;
  const writing = e.write('{"sentinel":"SYNTHETIC_SENTINEL"}\n').then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(done, false); assert.equal(e.snapshot.writeInFlight, true);
  f.stdin.emit('drain'); await writing; assert.equal(done, true); assert.equal(e.snapshot.writeInFlight, false);
  assert.equal(JSON.stringify(e.snapshot).includes('SYNTHETIC_SENTINEL'), false); assert.equal(await e.stop({ force: true }), true);
});
test('write errors, abort and concurrent writes clear pending state and observe owned close', async () => {
  const errorFixture = fakeChild({ writeError: true }), errorEngine = engineFor(errorFixture);
  await assert.rejects(errorEngine.write('{"sentinel":"SYNTHETIC_NEGATIVE_SECRET"}\n'), error => !error.message.includes('SYNTHETIC_NEGATIVE'));
  assert.equal(await errorEngine.stop({ force: true }), true);
  for (const concurrent of [false, true]) {
    const f = fakeChild({ backpressure: true }), e = engineFor(f), abort = new AbortController();
    const first = e.write('{}\n', { signal: abort.signal }).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 1));
    if (concurrent) await assert.rejects(e.write('{}\n')); else abort.abort();
    const result = await first; assert.ok(result instanceof Error); assert.equal(await e.stop({ force: true }), true);
    assert.equal(e.snapshot.writeInFlight, false); assert.equal(f.stdin.listenerCount('drain'), 0);
  }
});
test('stdout EOF, exit and close are distinct; kill return is never close proof', async () => {
  const f = fakeChild({ closeOnKill: false }), e = engineFor(f, { stopMs: 10 });
  f.child.stdout.end(); await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(e.snapshot.stdoutEOFObserved, true); assert.equal(e.snapshot.processClosedObserved, false);
  f.child.emit('exit', 0); assert.equal(e.snapshot.exitObserved, true); assert.equal(e.snapshot.processClosedObserved, false);
  assert.equal(await e.stop({ force: true }), false); assert.equal(e.snapshot.processClosedObserved, false);
  f.child.emit('close', 0); assert.equal(e.snapshot.processClosedObserved, true); assert.equal(await e.stop({ force: true }), false);
});
test('cumulative output/queue/non-ASCII/stderr bounds drain without retaining text', async () => {
  const f = fakeChild(), e = engineFor(f);
  f.child.stdout.write(Buffer.alloc(65536, 32)); assert.equal((await e.read()).output.length, 65536);
  f.child.stdout.write(Buffer.from('x')); await e.stop({ force: true }); assert.equal(e.snapshot.fatal, 'OUTPUT_LIMIT'); assert.equal(e.snapshot.queuedBytes, 0);
  for (const stderr of [false, true]) {
    const x = fakeChild(), t = engineFor(x);
    if (stderr) x.child.stderr.write('SYNTHETIC_NEGATIVE_SECRET'); else x.child.stdout.write(Buffer.from([0x80]));
    assert.equal(await t.stop({ force: true }), true); assert.equal(t.snapshot.queuedBytes, 0); assert.equal(JSON.stringify(t.snapshot).includes('SYNTHETIC_NEGATIVE'), false);
  }
  const q = fakeChild(), t = engineFor(q); for (let i = 0; i < 257; i++) q.child.stdout.write(Buffer.from('x'));
  assert.equal(await t.stop({ force: true }), true); assert.equal(t.snapshot.fatal, 'OUTPUT_LIMIT');
});
test('read abort/concurrency, expired or reversed clocks fence and terminate safely', async () => {
  const f = fakeChild(), e = engineFor(f), controller = new AbortController();
  const first = e.read({ signal: controller.signal }); controller.abort(); assert.equal((await first).error, 'TRANSPORT_FAILED'); assert.equal(await e.stop({ force: true }), true);
  const g = fakeChild(), t = engineFor(g); const pending = t.read(); await assert.rejects(t.read()); await pending; assert.equal(await t.stop({ force: true }), true);
  for (const next of [-1, 100]) {
    let clock = 0; const x = fakeChild(), s = engineFor(x, { deadlineMono: 100, monotonic: () => clock });
    clock = next; assert.equal((await s.read()).error, 'TRANSPORT_FAILED'); assert.equal(await s.stop({ force: true }), true);
  }
});
test('independent idle deadline stops a native sentinel without a continuing caller', async () => {
  const s = await createSentinelCollector('normal', { lifetimeMs: 300 });
  try { await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(s.processEvidence().processClosedObserved, true); assert.equal(s.processEvidence().fatal, 'ORIGINAL_DEADLINE'); assert.equal(s.collector.snapshot.cleanupIntentRequired, true); }
  finally { await s.collector.abort(); }
});
function permitFixture() {
  const { binding, authority } = publicFixture(); const now = Date.parse(binding.t0) + 60000;
  const record = { binding, authority, source: 'independent_owner_guard_checkpoint', checked_at: new Date(now).toISOString(),
    expires_at: authority.expires_at, revoked: false, guard_healthy: true, unknown_create_count: 0, unresolved_nonce_count: 0,
    revocation_epoch: 2, scopes: ['existing_operations_staging', 'existing_protected_preview', 'frozen_helper_launch', 'stdin_credentials'], transport_sha256: 'a'.repeat(64) };
  return { binding, record, now, hash: record.transport_sha256 };
}
test('current permit is structured+correlated+fresh, not a local boolean or consumed authority', () => {
  const p = permitFixture(); assert.equal(validateCurrentPermit(p.binding, p.record, p.now, p.hash).revocation_epoch, 2);
  for (const mutate of [r => { r.revoked = true; }, r => { r.guard_healthy = false; }, r => { r.unknown_create_count = 1; },
    r => { r.unresolved_nonce_count = 1; }, r => { r.checked_at = new Date(p.now - PERMIT_FRESH_MS - 1).toISOString(); }, r => { r.authority.consumed = true; },
    r => { r.scopes.push('production'); }, r => { r.transport_sha256 = '0'.repeat(64); }, r => { r.binding.run_id = '0e3a5a5a-fa68-4b3f-9a96-bdca500b1ab4'; }]) {
    const record = structuredClone(p.record); mutate(record); assert.throws(() => validateCurrentPermit(p.binding, record, p.now, p.hash));
  }
  assert.throws(() => validateCurrentPermit(p.binding, true, p.now, p.hash));
});
test('future REAL factory refusals occur without hash/launch or current secrets; NO valid live invocation', async () => {
  const { binding } = publicFixture();
  for (const options of [undefined, { permit: true }, { config: {}, binding, checkCurrentPermit: true },
    { config: {}, binding, checkCurrentPermit: async () => null }, { config: {}, binding, checkCurrentPermit: async () => true },
    { config: {}, binding, checkCurrentPermit: async () => { throw Error('SYNTHETIC_NEGATIVE_SECRET'); } }]) {
    await assert.rejects(launchReviewedLiveCollector(options), error => {
      assert.equal(error.processLaunched, false); assert.equal(error.processClosedObserved, false); assert.equal(error.message.includes('SYNTHETIC_NEGATIVE'), false); return true;
    });
  }
});
test('dynamic checks before writes and while idle reject revocation, stale epochs and stuck checker', async () => {
  for (const checkPermit of [async () => false, async () => 1, async () => { throw Error('SYNTHETIC_NEGATIVE_SECRET'); }]) {
    const f = fakeChild(), e = engineFor(f, { checkPermit, initialEpoch: 2 });
    await assert.rejects(e.write('{}\n')); assert.equal(await e.stop({ force: true }), true);
  }
  const idle = fakeChild(), e = engineFor(idle, { deadlineMono: performance.now() + 3000, checkPermit: async () => false });
  await new Promise(resolve => setTimeout(resolve, 1050)); assert.equal(e.snapshot.fatal, 'PERMIT_FAILED'); assert.equal(e.snapshot.processClosedObserved, true);
  const blocked = fakeChild(), b = engineFor(blocked, { checkPermit: () => new Promise(() => {}) });
  await assert.rejects(b.write('{}\n')); assert.equal(await b.stop({ force: true }), true);
});
test('cached checkpoints retain actual observed timestamp; repeated reads cannot renew freshness or authority', () => {
  const p = permitFixture(), checked = p.record.checked_at, expiry = p.record.expires_at;
  assert.equal(validateCurrentPermit(p.binding, p.record, p.now + PERMIT_FRESH_MS - 1, p.hash).checked_at, checked);
  assert.throws(() => validateCurrentPermit(p.binding, p.record, p.now + PERMIT_FRESH_MS + 1, p.hash));
  assert.equal(p.record.checked_at, checked); assert.equal(p.record.expires_at, expiry);
});
test('stream setup exception is sanitized and forced stop still kills when stdin destroy throws', async () => {
  const f = fakeChild({ throwSetup: true }); assert.throws(() => engineFor(f), error => !error.message.includes('SYNTHETIC_NEGATIVE'));
  f.child.kill(); // Fake fixture only; no OS process exists.
  const g = fakeChild({ destroyError: true }), e = engineFor(g); assert.equal(await e.stop({ force: true }), true); assert.equal(g.kills, 1);
});
test('immediate owned observer catches async spawn error during constructor-failure cleanup, without retaining it', async () => {
  const f = fakeChild({ throwSetup: true }); const observed = observeOwnedChild(f.child);
  assert.throws(() => engineFor(f));
  queueMicrotask(() => f.child.emit('error', Error('SYNTHETIC_NEGATIVE_SECRET')));
  await Promise.resolve(); // Models the first await in collector.abort before fallback cleanup.
  assert.equal(observed.spawnErrorObserved, true); assert.equal(observed.closed, false);
  f.child.kill(); assert.equal(await observed.done, true); assert.equal(observed.closed, true);
  assert.equal(JSON.stringify(observed).includes('SYNTHETIC_NEGATIVE'), false);
});
test('no generic exec/path/env options, inert CLI guards, fixed prelaunch hashes and frozen integration', async () => {
  for (const options of [{ env: {} }, { path: 'SYNTHETIC_NEGATIVE' }, { executable: 'node' }, { lifetimeMs: 18001 }]) await assert.rejects(createSentinelCollector('normal', options));
  await assert.rejects(createSentinelCollector('unknown'));
  const source = await readFile(new URL('../scripts/fill_uat_process_transport.mjs', import.meta.url), 'utf8');
  const child = await readFile(new URL('../scripts/fill_uat_synthetic_wire_child.mjs', import.meta.url), 'utf8');
  assert.match(source, /shell: false, windowsHide: true/g); assert.match(source, /await verifyFiles\(hash\)/);
  assert.match(source, /'before_hash'/); assert.match(source, /'before_launch'/); assert.match(source, /validateCurrentPermit/);
  assert.doesNotMatch(source + child, /node:process|\bfetch\s*\(|from ['"](?:node:)?(?:https?|net|tls|dns)|console\./);
  assert.doesNotMatch(child, /f1-readonly-validator|\.work\/|FMC_SYNTHETIC\/1/);
  assert.match(child, /typeof process !== 'undefined'/); assert.equal(WATCHDOG_MS, 20000); assert.equal(SCENARIOS.length, 19);
  const hashes = { 'fill_uat_helper_collector.mjs': '4751a40941ddb9379e6d7efc96f6b8e207fc3aa7d45d9e1965c623cb891cad04',
    'fill_uat_evidence_verdict.mjs': '7537808996568eeef8f0b0943926120c9159f6197a5e06448ae04ff6776e6d69',
    'fill_uat_safe_events.mjs': 'f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a' };
  for (const [file, hash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(await readFile(new URL('../scripts/' + file, import.meta.url))).digest('hex'), hash);
  const ci = await readFile(new URL('../../.github/workflows/platform-ci.yml', import.meta.url), 'utf8');
  assert.equal(ci.split('node --test platform/tests/fill_uat_process_transport.test.mjs').length - 1, 2);
  assert.equal(ci.split('ref: ${{ github.event.pull_request.head.sha || github.sha }}').length - 1, 2);
});
