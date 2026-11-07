import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJournalAdmission,decodeJournalReadback,CANONICAL_HISTORICAL_IDS} from '../scripts/fill_uat_journal_admission.mjs';
import {runFillLifetime} from '../scripts/fill_uat_foreground_lifetime.mjs';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,BASE=Date.parse('2030-01-01T00:00:00Z');
function fixture(mode='normal'){
  let now=BASE,inserted=false,released=false,stopped=false,releases=0,reads=0,stops=0,foreground=0,lateInsert,lateRelease;
  const events=[],queries=[],scope={run_id:id(9000),authorization_id:id(9001)};
  const binding={...scope,candidate_sha:'ed0eeea4ccde35ff54ee8331795326c15a49a5f9',project_ref:'yclqnbcrchwieyzkyumx',input_digest:'a'.repeat(64),deployment_id:id(9999),settled_at:new Date(BASE-1000).toISOString(),historical_ids:[...CANONICAL_HISTORICAL_IDS]};
  const frame=(kind,extra)=>[{snapshot:{kind,...scope,observed_at:new Date(now).toISOString(),...extra}}];
  const executeSql=async({project_id,query})=>{
    assert.equal(project_id,binding.project_ref);queries.push(query);const kind=/FILL_JOURNAL_(\w+)/.exec(query)?.[1];assert.ok(kind);
    const cutoff=Date.parse(/clock_timestamp\(\)<'([^']+)'::timestamptz/.exec(query)?.[1]??'');
    if(kind==='INSERT'){events.push('insert');if(mode==='inflight-insert')return new Promise(r=>{lateInsert=()=>{inserted=true;events.push('late-insert-settled');r(frame('created',{matched:true}));};});inserted=true;return frame('created',{matched:true});}
    if(kind==='PREFLIGHT'){reads++;events.push('preflight');if(mode==='late-preflight')now=BASE+231000;return frame('preflight',{matched:inserted,admissible:mode!=='unknown-slot',ready:now>=BASE+120000,preflight_executor:now>=BASE+120000?id(9998):null});}
    if(kind==='RELEASE'){events.push('release');if(mode==='late-release')now=cutoff+1;
      if(mode==='inflight-release')return new Promise(r=>{lateRelease=()=>{assert.equal(stopped,true);events.push('late-release-denied-by-stop');r(frame('released',{matched:false}));};});
      assert.match(query,/locked as materialized/);assert.match(query,/for update of i/);assert.match(query,/interval '30 seconds'/);assert.match(query,/i\.starts_at is null and i\.released_at is null and not i\.stopped/);
      const matched=!stopped&&now<cutoff-2000&&mode!=='stale-preflight';if(matched){released=true;releases++;}
      if(mode==='ambiguous-release')throw Error('SYNTHETIC_PRIVATE_DB_RESPONSE');return frame('released',{matched});}
    if(kind==='STOP'){events.push('stop');stops++;stopped=true;const response=frame('stopped',{intent_present:inserted,run_present:released,stopped:true});if(lateInsert){const done=lateInsert;lateInsert=null;setTimeout(done,10);}if(lateRelease){const done=lateRelease;lateRelease=null;setTimeout(done,10);}return response;}
    throw Error('PUBLIC_UNKNOWN');
  };
  const wall=()=>now,sleep=async ms=>{now+=ms;};
  const journal=createJournalAdmission({binding,executeSql,wall,sleep});
  const rpc={closed:false,request(){},async drain(){return{pending:0,closed:this.closed};}};
  const prepared={rpc,async close(){events.push('close');rpc.closed=true;return{closed:true,ownedTimers:0};}};
  const options={scope,rpc,wall,sleep,prepare:async()=>{events.push('prepare');return prepared;},arm:async p=>{assert.equal(p,prepared);events.push('arm-and-lookup');return{...p,scope,ready:{live_ready:true,pre_t0:true,grantsOwnerGo:false,expires_at:BASE+300000}};},
    admit:c=>journal.admit(c),stop:()=>journal.stop(),run:async(_armed,{stopJournal})=>{foreground++;events.push('reads-done');const s=await stopJournal();assert.equal(s.confirmed,true);events.push('guard-cleanup');return{publicOnly:true};}};
  return{options,journal,events,queries,binding,stats:()=>({now,inserted,released,stopped,releases,reads,stops,foreground})};
}
test('concrete flow: prepare/arm/lookup BEFORE intent, wait120s but fresh preflight, single release, reads-done -> durable stop -> guard',async()=>{
  const f=fixture(),r=await runFillLifetime(f.options),s=f.stats();assert.equal(r.failure,null);assert.equal(s.releases,1);assert.equal(s.foreground,1);assert.equal(s.stops,1);assert.ok(s.reads>12);assert.ok(s.now>=BASE+120000);assert.ok(s.now<BASE+300000);assert.equal(r.ownedPending,0);
  assert.deepEqual(f.events.slice(0,3),['prepare','arm-and-lookup','insert']);assert.deepEqual(f.events.slice(-4),['reads-done','stop','guard-cleanup','close']);
  for(const query of f.queries){assert.doesNotMatch(query,/select\s+\*|\b(delete|alter|drop|grant|revoke|create table)\b|insert into auth\.|update auth\./i);assert.ok(query.includes(f.binding.run_id));}
  const release=f.queries.find(x=>x.includes('FILL_JOURNAL_RELEASE'));for(const item of ['candidate_sha','deployment_id','input_digest','settled_at','organization_ids','preflight_executor','reconciliation_required','request_expires_at','banned_until'])assert.ok(release.includes(item));
});
for(const mode of ['late-preflight','late-release','stale-preflight','unknown-slot','ambiguous-release'])test(`concrete ${mode}: terminal stop/guard, no release replay or foreground`,async()=>{
  const f=fixture(mode),r=await runFillLifetime(f.options),s=f.stats();assert.ok(r.failure);assert.equal(s.foreground,0);assert.equal(s.stopped,true);assert.equal(s.stops,1);assert.equal(r.journalStop.confirmed,true);assert.equal(r.journalStop.guardCleanupRequired,true);assert.equal(r.ownedPending,0);
  assert.ok(f.queries.filter(x=>x.includes('FILL_JOURNAL_RELEASE')).length<=1);assert.equal(s.releases,mode==='ambiguous-release'?1:0);assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE'),false);
  if(mode==='ambiguous-release')assert.equal(r.journalStop.releaseOutcome,'UNKNOWN');
});
test('official wrapper decoded strictly; unknown/duplicate frames and raw secret errors never reflected',()=>{
  const rows=[{snapshot:{kind:'public'}}],tag='12345678-1234-1234-1234-123456789abc';
  assert.deepEqual(decodeJournalReadback({content:[{type:'text',text:JSON.stringify({result:`<untrusted-data-${tag}>${JSON.stringify(rows)}</untrusted-data-${tag}>`})}]}),{kind:'public'});
  for(const bad of [{isError:true},[{},{}],'{SYNTHETIC_PRIVATE',Object.defineProperty({},'x',{get(){throw Error('SYNTHETIC_PRIVATE');},enumerable:true})])assert.throws(()=>decodeJournalReadback(bad),e=>!e.message.includes('SYNTHETIC_PRIVATE'));
});
test('SQL remains exactly existing journal schema/trigger control, no DDL or second writer',async()=>{
  const schema=await readFile(new URL('../supabase/migrations/20261031004340_fill_uat_bootstrap.sql',import.meta.url),'utf8'),f=fixture();await runFillLifetime(f.options);
  for(const field of ['request_expires_at','preflight_executor','reconciliation_required','released_at','settled_at','input_digest'])assert.ok(schema.includes(field));
  assert.ok(f.queries.every(q=>!q.includes('security definer')));assert.match(f.queries.at(-1),/stopped_run as \(update fill_private\.uat_runs/);assert.match(f.queries.at(-1),/from stopped_intent/);
});
test('journal accepts only the canonical old17, not any arbitrary17 or old run/authority',()=>{
  assert.equal(CANONICAL_HISTORICAL_IDS.length,17);assert.ok(CANONICAL_HISTORICAL_IDS.includes('cf5ec236-b8a8-4de2-a7c4-1a1ebe5a5d91'));
  const f=fixture();for(const mutate of [b=>{b.historical_ids[0]=id(9997);},b=>{b.run_id='4c0cdb3b-c138-479b-9b69-fef96420642b';},b=>{b.authorization_id='01a1958f-5bc5-7382-822d-27d4db023a3e';}]){const b=structuredClone(f.binding);mutate(b);assert.throws(()=>createJournalAdmission({binding:b,executeSql:async()=>{throw Error('MUST_NOT_CALL');}}));}
});

test('B11 c84 and its actual human authority cannot enter a future journal or issue SQL',()=>{
  let calls=0;for(const key of ['run_id','authorization_id']){const b=structuredClone(fixture().binding);b[key]=key==='run_id'?'c84ce71e-da5d-4d35-80b8-03df361e90a4':'01a195d0-a2d3-7492-ada1-13093bfac556';assert.throws(()=>createJournalAdmission({binding:b,executeSql:async()=>{calls++;}}));}assert.equal(calls,0);
});
for(const mode of ['inflight-insert','inflight-release'])test(`uncancelled ${mode} is owned: stop, settle and final fence without release replay`,async()=>{
  const f=fixture(mode),r=await runFillLifetime(f.options),s=f.stats();assert.ok(r.failure);assert.equal(r.journalStop.confirmed,true);assert.equal(r.ownedPending,0);assert.equal(s.releases,0);assert.equal(s.foreground,0);assert.equal(s.stops,2);assert.equal(s.stopped,true);
  assert.ok(f.events.indexOf('close')>f.events.lastIndexOf('stop'));assert.ok(f.queries.filter(q=>q.includes('FILL_JOURNAL_RELEASE')).length<=1);
});
