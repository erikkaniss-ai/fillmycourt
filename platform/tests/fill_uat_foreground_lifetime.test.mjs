import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runFillLifetime } from '../scripts/fill_uat_foreground_lifetime.mjs';

const scope = { run_id: '00000000-0000-0000-0000-000000009000', authorization_id: '00000000-0000-0000-0000-000000009001' };
function fixture() {
  const events = [], rpc = { closed: false, request() {}, async drain() { return { pending: 0, closed: this.closed }; } };
  const prepared = { rpc, async close() { events.push('close'); rpc.closed = true; return { closed: true, ownedTimers: 0 }; } };
  const armed = { ...prepared, scope, ready: { live_ready: true, pre_t0: true, grantsOwnerGo: false, expires_at: Date.now() + 300000 } };
  return { events, rpc, prepared, armed, options: { scope, rpc,
    prepare: async () => { events.push('prepare'); return prepared; },
    arm: async value => { assert.equal(value, prepared); events.push('arm-and-lookup'); return armed; },
    admit: async () => { events.push('admit-once'); return { ...scope, released: true }; },
    run: async value => { assert.equal(value, armed); assert.equal(value.rpc, rpc); events.push('foreground'); return { publicOnly: true }; },
    stop: async () => { events.push('durable-stop'); return {confirmed:true}; },
  } };
}
test('one awaited lifetime retains actual methods and identity before release; returns only safe results', async () => {
  const f = fixture(), r = await runFillLifetime(f.options);
  assert.deepEqual(f.events, ['prepare', 'arm-and-lookup', 'admit-once', 'foreground', 'durable-stop','close']);
  assert.equal(r.failure, null); assert.equal(r.ownedPending, 0); assert.equal(r.grantsOwnerGo, false);
  assert.doesNotThrow(() => JSON.stringify(r)); assert.equal(Object.values(r).some(v => typeof v === 'function'), false);
});
test('fresh evaluator cannot recover methods from a JSON receipt: no admission or foreground', async () => {
  const source = (await readFile(new URL('../scripts/fill_uat_foreground_lifetime.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
  const f = fixture(), receipt = JSON.parse(JSON.stringify(f.prepared));
  const fresh = new Function('options', source + '\nreturn runFillLifetime(options);');
  const r = await fresh({ ...f.options, rpc: receipt.rpc });
  assert.deepEqual(f.events, []); assert.equal(r.failure.code, 'INVALID_LIFETIME');
});
for (const stage of ['prepare', 'arm', 'admit', 'run']) test(`failure at ${stage} cannot retry or reflect private errors`, async () => {
  const f = fixture(); f.options[stage] = async () => { throw Error('SYNTHETIC_PRIVATE_ERROR'); };
  const r = await runFillLifetime(f.options);
  assert.ok(r.failure); assert.equal(r.ownedPending, 0); assert.equal(r.rpc.closed, true);
  assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE'), false);
  assert.equal(f.events.filter(x => x === 'admit-once').length, stage === 'run' ? 1 : 0);
  assert.equal(f.events.filter(x => x === 'foreground').length, 0);
  if (stage !== 'prepare') assert.equal(r.closed.closed, true);
});
test('late admission is owned and drained but never enters foreground or renews timers', async () => {
  const f = fixture(); f.options.admissionMs = 10020; f.options.drainMs = 1000;let lateReleaseAttempts=0;
  f.options.admit = async control => { f.events.push('admit-once'); await new Promise(r => setTimeout(r, 10060));if(control.isOpen())lateReleaseAttempts++;control.assertOpen();return { ...scope, released: true }; };
  const r = await runFillLifetime(f.options);
  assert.equal(r.failure.code, 'ADMISSION_TIMEOUT'); assert.equal(r.ownedPending, 0); assert.equal(r.closed.closed, true);
  assert.equal(lateReleaseAttempts,0);assert.deepEqual(f.events, ['prepare', 'arm-and-lookup', 'admit-once','durable-stop','close']);
});
test('finite actual RPC stage/code retained while raw private exception is discarded',async()=>{
  const f=fixture();f.options.arm=async()=>{const e=Error('SYNTHETIC_PRIVATE_ERROR');e.code='RPC_TIMEOUT';e.stage='ARM';throw e;};
  const r=await runFillLifetime(f.options);assert.deepEqual(r.failure,{code:'ARM_FAILED',stage:'ARM',rpc:{code:'RPC_TIMEOUT',stage:'ARM'}});assert.equal(r.closed.closed,true);assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE'),false);
});
test('wrong release binding and expired preparation stop before foreground', async () => {
  for (const kind of ['wrong-scope', 'expired']) {
    const f = fixture(); if (kind === 'expired') f.armed.ready.expires_at = Date.now() - 1;
    else f.options.admit = async () => ({ ...scope, run_id: scope.authorization_id, released: true });
    const r = await runFillLifetime(f.options); assert.ok(r.failure); assert.equal(r.closed.closed, true); assert.equal(r.ownedPending, 0);
    assert.equal(f.events.includes('foreground'), false);
  }
});
test('unconfirmed stop keeps controller until earlier DB cutoff, reports journal ownership uncertainty',async()=>{
  const f=fixture();let now=Date.now(),closedAt;
  f.options.wall=()=>now;f.options.sleep=async ms=>{now+=ms;};f.options.stop=async()=>({confirmed:false,pending:1});
  f.prepared.close=async()=>{closedAt=now;return{closed:true};};
  const r=await runFillLifetime(f.options);assert.equal(r.failure.code,'STOP_FAILED');assert.ok(closedAt>=r.admission.releaseCutoffAt+2000);assert.equal(r.ownedPending,1);
});
