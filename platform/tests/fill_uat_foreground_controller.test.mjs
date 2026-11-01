import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicTransitions } from '../scripts/fill_uat_foreground_controller.mjs';
import {createPublicDiscoveryReplay} from '../scripts/fill_uat_public_control_replay.mjs';
import {ControlRpc,runFillForeground,ACTIVE_RPC_MS} from '../scripts/fill_uat_foreground_caller.mjs';
import {readFile} from 'node:fs/promises';
const archive=JSON.parse(await readFile(new URL('./fill_uat_control_frames.json',import.meta.url),'utf8'));
const publicReplay=frames=>createPublicDiscoveryReplay({originalT0:archive.original_t0,frames:frames??archive.frames.map(f=>f.snapshot)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('actual public controller: guarded startup, both operator activations, terminal cleanup and independent JSON-first gate', async () => {
  const r = await validatePublicTransitions();
  assert.equal(r.actualControllerOffline, 'PASS');
  assert.equal(r.realNetworkCalls, 0); assert.equal(r.actualProcessLaunches, 0); assert.equal(r.grantsOwnerGo, false);
  assert.deepEqual(r.operatorReadiness.map(x => x.result), ['ONE_GATE_ONE_LOGIN_EACH', 'DENY_NO_GATE_OR_LOGIN']);
  assert.ok(r.earlyInputReferencesCleared.includes('discovery-read-timeout'));
  assert.equal(r.budgetFactsUnchanged, true);
  assert.equal(r.bindingReceiptTiming[0].result,'BIND_WITH_ORIGINAL_ACTION_WINDOWS');
  assert.equal(r.bindingReceiptTiming.filter(x=>x.result==='DENY_NO_FACTORY').length,4);
  assert.deepEqual(r.clockWaitCases.map(x=>x.result),['REAL_WAIT_ORIGINAL_TIMESTAMP','REAL_WAIT_ORIGINAL_TIMESTAMP','DENY_NO_FACTORY','DENY_NO_FACTORY','DENY_NO_FACTORY','DENY_NO_FACTORY']);
  assert.ok(r.clockWaitCases.every(x=>x.originalTimestampUnchanged));
});

test('B11 original first/second discovery frames, explicitly neutralized test copy: valid bounded WAIT, no factory',async()=>{
  const r=await publicReplay();for(let i=0;i<2;i++){r.begin(i);const s=await r.complete(i);assert.equal(s.stopped,false);assert.equal(s.discovery,true);assert.equal(s.controlFailure,null);assert.equal(s.readTrace.substage,'RETURN');assert.ok(s.readTrace.entryWall!==null);}
  assert.equal(r.status().actualProcessLaunches,0);await r.stop();
  assert.equal(archive.frames[1].snapshot.observed_at,'2026-11-01T08:26:25.083349Z');
});

test('actual stopped partial frame denies; explicitly counterfactual open partial waits but never admits factory',async()=>{
  const original=archive.partial.snapshot,r=await publicReplay([original]);r.begin(0);let s=await r.complete(0);assert.equal(s.stopped,true);assert.equal(s.controlFailure.reason,'DISCOVERY_REJECTED');await r.stop();
  const testCopy={...original,stopped:false,reconciliation_required:false};
  const partial=await publicReplay([testCopy]);partial.begin(0);s=await partial.complete(0);assert.equal(s.stopped,false);assert.equal(s.discovery,true);assert.equal(partial.status().actualProcessLaunches,0);await partial.stop();
  const expired={...testCopy,observed_at:'2026-11-01T08:27:22.841587Z'};
  const late=await publicReplay([expired]);late.begin(0);s=await late.complete(0);assert.equal(s.stopped,true);assert.equal(s.controlFailure.reason,'DISCOVERY_REJECTED');await late.stop();
});

test('STOP overtakes late COMPLETE: finite ENTRY reason, no decode/adoption/cache/publish/factory',async()=>{
  const r=await publicReplay();r.begin(1);await r.stop();const s=await r.complete(1);
  assert.equal(s.controlFailure.reason,'STOPPED_BEFORE_COMPLETE');assert.equal(s.controlFailure.substage,'ENTRY');assert.equal(s.readTrace.substage,'ENTRY');assert.equal(s.clockWait,null);assert.equal(r.status().actualProcessLaunches,0);assert.equal(s.grantsOwnerGo,false);
});

test('uncancelled real 2s RPC boundary owns late response, reports timing, cannot reopen controller',async()=>{
  const r=await publicReplay();r.begin(1);let dispatched=0;
  const rpc=new ControlRpc({mcp__node_repl__js:async()=>{dispatched++;await sleep(2234);const s=await r.complete(1);return{content:[{type:'text',text:JSON.stringify(s)}],_meta:{'codex/nodeReplExecutionDurationMs':9}};}});
  assert.equal(ACTIVE_RPC_MS,2000);await assert.rejects(()=>rpc.request('COMPLETE','PUBLIC_CODE_ONLY'),e=>e.code==='RPC_TIMEOUT');await r.stop();
  const drained=await rpc.drain(1000),record=drained.records[0];assert.equal(dispatched,1);assert.equal(drained.pending,0);assert.equal(record.code,'RPC_TIMEOUT');assert.equal(record.lateSettlement,true);assert.equal(record.nodeExecutionMs,9);assert.ok(record.settledAt>record.deadlineAt);assert.equal(r.status().controlFailure.reason,'STOPPED_BEFORE_COMPLETE');assert.equal(r.status().actualProcessLaunches,0);
  assert.equal(JSON.stringify(record).includes('PUBLIC_CODE_ONLY'),false);
});

test('foreground COMPLETE frame omits SQL plan, retains original official response, always durable-stops',async()=>{
  const calls=[],scope={run_id:'00000000-0000-0000-0000-000000009000',authorization_id:'00000000-0000-0000-0000-000000009001'};let stops=0;
  const result=v=>({content:[{type:'text',text:JSON.stringify(v)}]});
  const tools={mcp__node_repl__js:async({code})=>{calls.push(code);if(code.includes('.begin()'))return result({discovery:true,project_id:'PUBLIC_PROJECT',query:'PUBLIC_SQL_QUERY_SENTINEL'});if(code.includes('.complete('))return result({stopped:true,discovery:true,cutoff:Date.now()+1000});return result({closed:true});},mcp__codex_apps__supabase_execute_sql:async args=>{assert.equal(args.query,'PUBLIC_SQL_QUERY_SENTINEL');return result({snapshot:'PUBLIC_ORIGINAL_RAW_RESPONSE'});}};
  const rpc=new ControlRpc(tools),prepared={rpc,scope,ready:{live_ready:true,pre_t0:true,expires_at:Date.now()+10000,prepare_id:'PUBLIC_ONLY'}};
  const r=await runFillForeground(tools,scope,prepared,{wall:Date.now,sleep,stopJournal:async()=>{stops++;return{confirmed:true};}});
  assert.equal(r.failure,null);assert.equal(stops,1);const complete=calls.find(c=>c.includes('.complete('));assert.ok(complete.includes('PUBLIC_ORIGINAL_RAW_RESPONSE'));assert.equal(complete.includes('PUBLIC_SQL_QUERY_SENTINEL'),false);assert.ok(complete.includes('{"discovery":true}'));
});

test('RPC metadata is finite/allowlisted; raw private error and code are discarded',async()=>{
  const rpc=new ControlRpc({mcp__node_repl__js:async()=>{throw Error('SYNTHETIC_PRIVATE_EXCEPTION');}});
  await assert.rejects(()=>rpc.request('COMPLETE','SYNTHETIC_PRIVATE_CODE'),e=>e.code==='RPC_REMOTE_FAILED');const s=await rpc.drain(100);assert.equal(s.pending,0);assert.ok(s.records[0].settledAt!==null);assert.equal(JSON.stringify(s).includes('SYNTHETIC_PRIVATE'),false);
});

test('STOP response may retain last COMPLETE trace, but is never labelled as fresh STOP node timing',async()=>{
  const rpc=new ControlRpc({mcp__node_repl__js:async()=>({content:[{type:'text',text:JSON.stringify({readTrace:{nodeEntryAt:1,nodeReturnAt:2,nodeElapsedMs:1}})}]})});await rpc.request('STOP','PUBLIC_STOP',{startup:true});const r=await rpc.drain(100);assert.equal(Object.hasOwn(r.records[0],'nodeEntryAt'),false);
});
