import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicTransitions } from '../scripts/fill_uat_foreground_controller.mjs';

test('actual public controller: guarded startup, both operator activations, terminal cleanup and independent JSON-first gate', async () => {
  const r = await validatePublicTransitions();
  assert.equal(r.actualControllerOffline, 'PASS');
  assert.equal(r.realNetworkCalls, 0); assert.equal(r.actualProcessLaunches, 0); assert.equal(r.grantsOwnerGo, false);
  assert.deepEqual(r.operatorReadiness.map(x => x.result), ['ONE_GATE_ONE_LOGIN_EACH', 'DENY_NO_GATE_OR_LOGIN']);
  assert.ok(r.earlyInputReferencesCleared.includes('discovery-read-timeout'));
  assert.equal(r.budgetFactsUnchanged, true);
  assert.equal(r.bindingReceiptTiming[0].result,'BIND_WITH_ORIGINAL_ACTION_WINDOWS');
  assert.equal(r.bindingReceiptTiming.filter(x=>x.result==='DENY_NO_FACTORY').length,4);
});
