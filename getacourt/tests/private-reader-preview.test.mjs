import test from 'node:test';
import assert from 'node:assert/strict';
import {approved,ciState,FILES,CONTENT_SECURITY_POLICY,LEAFLET_HASHES,
  createStaticPackage,readStaticPackageInputs,writeStaticPackage} from '../qa/private-reader-preview.mjs';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,mkdir,readFile,readdir,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import * as readerGate from '../qa/private-reader-preview.mjs';
const sha='1'.repeat(40),repo={full_name:'erikkaniss-ai/fillmycourt'};
const pr={number:5,state:'open',draft:true,title:'Reader [skip netlify]',
  body:`<!-- GET_STAGING_UAT_APPROVED_SHA:${sha} -->`,
  head:{sha,ref:'get/release-candidate-mvp-qa-04',repo},base:{ref:'getacourt-staging',repo}};

const workflow=readFileSync(new URL('../../.github/workflows/getacourt-federated-search-ci.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const readerJob=workflow.split('  private-reader-draft:\n')[1]?.split('  private-search-draft:\n')[0];
function jobAdmitted(github,inputs={},dependency=github.event_name==='pull_request'?'success':'skipped',wasCancelled=false){
  const expression=readerJob.match(/^    if: (.+)$/m)?.[1];
  assert.ok(expression,'existing Reader job has an explicit admission expression');
  return !!runInNewContext(expression,{github,inputs,needs:{'search-contract-and-browser':{result:dependency}},
    always:()=>true,cancelled:()=>wasCancelled,contains:(a,b)=>typeof a==='string'&&a.includes(b),
    format:(s,v)=>s.replace('{0}',v)});
}
const context={eventName:'workflow_dispatch',repository:repo.full_name,
  ref:'refs/heads/'+pr.head.ref,workflowSha:sha,sourceSha:sha,browserResult:'skipped',
  runId:'99',runAttempt:'1',actor:'erikkaniss-ai',triggeringActor:'erikkaniss-ai',
  event:{inputs:{candidate_sha:sha,scope:'pr5-reader-static'}}};
const requiredPaths=['platform-ci','getacourt-a11y-ci','getacourt-offline-safety-ci','getacourt-federated-search-ci'];
const greenRuns=()=>requiredPaths.map((name,index)=>({id:index+1,pull_requests:[{number:5}],path:'.github/workflows/'+name+'.yml',head_sha:sha,
  event:'pull_request',head_branch:pr.head.ref,head_repository:repo,run_number:2,run_attempt:1,
  status:'completed',conclusion:'success'}));
const sourceJobs=async(id,attempt)=>({total_count:1,jobs:[{id:100+id,run_id:id,name:'search-contract-and-browser',status:'completed',conclusion:'success'}]});
const approvalJobs=id=>({total_count:1,jobs:[{id:100+id,run_id:id,name:'reader-approval-event-no-source-ci',status:'completed',conclusion:'skipped'}]});
const edited=()=>({...context,eventName:'pull_request',ref:'refs/pull/5/merge',workflowSha:'2'.repeat(40),
  event:{number:5,action:'edited',pull_request:pr,changes:{body:{from:''}},sender:{login:'erikkaniss-ai',type:'User'}}});
const adapters=(c=edited())=>({context:c,loadPr:async()=>pr,loadRuns:async()=>greenRuns(),
  loadRunJobs:sourceJobs,checkProtection:async()=>401,attempts:1});

for(const index of [0,1,2])for(const field of ['head_repository','head_branch']){
  test(`shared ${requiredPaths[index]} refuses newer failure with missing ${field}`,async()=>{
    const newer={...greenRuns()[index],id:20,run_number:3,conclusion:'failure'};delete newer[field];
    const runs=[...greenRuns(),newer];
    assert.equal(ciState(runs,sha),false);
    await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),loadRuns:async()=>runs,
      loadRunJobs:async()=>assert.fail('unknown shared CI reached federated reads'),
      checkProtection:async()=>assert.fail('unknown shared CI reached protection')}),/REQUIRED_CI_NOT_GREEN/);
  });
}

test('shared CI validates identity, PR linkage and exact-attempt ordering on all three workflows',()=>{
  for(const index of [0,1,2]){
    const mutations=[r=>r.head_repository=null,r=>r.head_repository=42,r=>r.head_repository=[],
      r=>r.head_repository={full_name:null},r=>r.head_repository={full_name:[]},
      r=>r.head_repository={full_name:repo.full_name.toUpperCase()},
      r=>r.head_branch=null,r=>r.head_branch=42,r=>r.head_branch={},r=>r.head_branch='',
      r=>r.id=0,r=>r.id='20',r=>r.id=9007199254740992,
      r=>r.run_number=null,r=>r.run_number=0,r=>r.run_number='3',r=>r.run_number=1.5,
      r=>r.run_attempt=0,r=>r.run_attempt='1',r=>r.run_attempt=NaN,
      r=>r.pull_requests=[],r=>r.pull_requests=[{number:8}],r=>r.pull_requests=[{number:'5'}],
      r=>r.pull_requests=[null],r=>r.pull_requests=[{number:5},{number:5}],r=>r.pull_requests='5',
      r=>r.status='unknown',r=>r.conclusion=null];
    for(const mutate of mutations){
      const newer={...greenRuns()[index],id:20,run_number:3,conclusion:'failure'};mutate(newer);
      assert.equal(ciState([...greenRuns(),newer],sha),false);
    }
    for(const [status,conclusion] of [['completed','failure'],['completed','cancelled'],['completed','skipped'],
      ['queued',null],['pending',null],['in_progress',null]]){
      assert.equal(ciState([...greenRuns(),{...greenRuns()[index],id:20,run_number:3,status,conclusion}],sha),false);
    }
    assert.equal(ciState([...greenRuns(),{...greenRuns()[index]}],sha),false,'duplicate exact attempt');
    assert.equal(ciState([...greenRuns(),{...greenRuns()[index],id:20}],sha),false,'ambiguous run number');
    assert.equal(ciState([...greenRuns(),{...greenRuns()[index],run_number:3}],sha),false,'contradictory same ID ordering');
    const retry={...greenRuns()[index],run_attempt:2,conclusion:'failure'};
    assert.equal(ciState([...greenRuns(),retry],sha),false,'later failed attempt');
    const recovered=greenRuns();recovered[index]={...recovered[index],run_attempt:1,conclusion:'failure'};
    assert.equal(ciState([...recovered,{...greenRuns()[index],run_attempt:2}],sha),true,'latest genuine success');
  }
});

test('shared CI keeps exact relevance boundaries, explicit foreign heads, bool interface and input order',()=>{
  const runs=greenRuns(),before=JSON.stringify(runs);
  assert.equal(ciState(runs,sha),true);assert.equal(JSON.stringify(runs),before);
  assert.equal(ciState(null,sha),false);assert.equal(ciState({},sha),false);
  for(const index of [0,1,2]){
    const newer={...runs[index],id:20,run_number:3,conclusion:'failure'};
    for(const fields of [{head_sha:'2'.repeat(40)},{event:'workflow_dispatch'},{event:'push'},
      {path:'.github/workflows/unrelated.yml'},{head_repository:{full_name:'other/repo'}},
      {head_branch:'another-branch'}])assert.equal(ciState([...runs,{...newer,...fields}],sha),true);
    for(const fields of [{head_sha:'2'.repeat(40)},{event:'pull_request_target'},
      {path:'.github/workflows/unrelated.yml'}]){
      const missing=runs.filter((_,i)=>i!==index);
      assert.equal(ciState([...missing,{...newer,...fields}],sha),false);
    }
    for(const fields of [{path:null},{path:42},{path:'unknown'},{head_sha:null},{head_sha:42},
      {event:null},{event:42},{event:'unknown'},{event:'PULL_REQUEST'}]){
      assert.equal(ciState([...runs,{...newer,...fields}],sha),false,'ambiguous relevance is not unrelated');
    }
  }
  const invalidSha='A'.repeat(40);
  assert.equal(ciState(runs.map(r=>({...r,head_sha:invalidSha})),invalidSha),false);
  const lower='a'.repeat(40),caseRuns=runs.map(r=>({...r,head_sha:lower}));
  assert.equal(ciState([...caseRuns,{...caseRuns[0],id:20,run_number:3,head_sha:lower.toUpperCase(),conclusion:'failure'}],lower),false);
});

test('edited owner approval is an actual workflow path with no browser replay or Search activation',()=>{
  assert.match(workflow,/types: \[opened, synchronize, reopened, edited\]/);
  const github={repository:repo.full_name,event_name:'pull_request',actor:context.actor,triggering_actor:context.actor,run_attempt:1,event:edited().event};
  assert.equal(jobAdmitted(github,{},'skipped'),true);
  assert.equal(jobAdmitted(github,{},'success'),false);
  assert.equal(jobAdmitted(github,{},'skipped',true),false);
  for(const mutate of [g=>g.actor='other',g=>g.triggering_actor='other',g=>g.event.sender.type='Bot',
    g=>g.run_attempt=2,g=>g.event.pull_request.number=8,g=>g.event.pull_request.head.ref='main']){
    const g=structuredClone(github);mutate(g);assert.equal(jobAdmitted(g,{},'skipped'),false);
  }
  const browser=workflow.split('  search-contract-and-browser:\n')[1].split('  private-reader-draft:\n')[0];
  const sourceIf=browser.match(/^    if: (.+)$/m)[1];
  assert.equal(runInNewContext(sourceIf,{github}),false);
  assert.match(browser,/reader-approval-event-no-source-ci/);
  assert.match(workflow,/group: .*reader-approval.*get-federated/);
  const searchIf=workflow.split('  private-search-draft:\n')[1].match(/^    if: (.+)$/m)[1];
  assert.equal(runInNewContext(searchIf,{github}),false);
});

test('only a first-attempt owner marker-only transition can qualify an edited snapshot',async()=>{
  assert.equal(await readerGate.qualifyReaderInvocation(adapters()),sha);
  const stale=edited();stale.event.changes.body.from=pr.body.replace(sha,'2'.repeat(40));
  assert.equal(await readerGate.qualifyReaderInvocation(adapters(stale)),sha);
  const cases=[];
  const change=fn=>{const c=structuredClone(edited());fn(c);cases.push(c);};
  change(c=>delete c.event.changes);change(c=>c.event.changes={title:{from:'x'}});
  change(c=>c.event.changes.title={from:'x'});change(c=>c.event.changes.base={});
  change(c=>c.event.changes.body.extra='unexpected');
  change(c=>c.event.changes.body.from=pr.body);change(c=>c.event.changes.body.from='unrelated prose');
  change(c=>c.event.changes.body.from=pr.body+pr.body);
  change(c=>c.event.changes.body.from='<!-- GET_STAGING_UAT_APPROVED_SHA:bad -->');
  change(c=>c.event.pull_request.body='');change(c=>c.event.pull_request.body=pr.body+pr.body);
  change(c=>c.event.pull_request.body=pr.body+'\n<!-- GET_SEARCH_UAT_APPROVED_SHA:'+sha+' -->');
  change(c=>c.actor='other');change(c=>c.event.sender.login='other');change(c=>c.event.sender.type='Bot');
  change(c=>c.triggeringActor='other');change(c=>c.runAttempt='2');change(c=>c.runAttempt=1);change(c=>c.runId='0');
  change(c=>c.runId='9007199254740993');change(c=>c.sourceSha='2'.repeat(40));
  change(c=>c.event.number=8);change(c=>c.event.pull_request.head.ref='main');change(c=>c.event.pull_request.base.ref='main');
  change(c=>c.event.pull_request.head.repo={full_name:'other/repo'});change(c=>c.eventName='pull_request_target');
  change(c=>c.event.action='labeled');change(c=>c.ref='refs/pull/8/merge');
  for(const result of ['success','failure','cancelled'])change(c=>c.browserResult=result);
  for(const c of cases)await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(c),
    loadPr:async()=>assert.fail('invalid event reached a live adapter')}),/INVOCATION|APPROVAL/);
});

test('edited live body as well as head must remain bound through both post-CI rechecks',async()=>{
  for(const driftAt of [1,2,3]){
    let calls=0;
    await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),
      loadPr:async()=>++calls===driftAt?{...pr,body:pr.body+'\nchanged'}:pr}),
    /EXACT_OWNER_UAT|PR_CHANGED/);
  }
  const c=edited();c.event.pull_request={...pr,body:pr.body+'\n'};
  assert.equal(await readerGate.qualifyReaderInvocation({...adapters(c),loadPr:async()=>c.event.pull_request}),sha);
});

test('approval-only green cannot replace genuine federated CI and current approval must not self-wait',async()=>{
  await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(context),loadRunJobs:async id=>approvalJobs(id)}),/CI/);
  const genuine=greenRuns()[3];
  const olderApproval={...genuine,id:5,run_number:3};
  const currentApproval={...genuine,id:99,run_number:4,status:'in_progress',conclusion:null};
  const calls=[];
  assert.equal(await readerGate.qualifyReaderInvocation({...adapters(),loadRuns:async()=>[...greenRuns(),olderApproval,currentApproval],
    loadRunJobs:async(id,attempt)=>{calls.push([id,attempt]);return id===5?approvalJobs(id):sourceJobs(id,attempt);}}),sha);
  assert.deepEqual(calls,[[5,1],[4,1]]);
  // Current-run API metadata can lag; its authenticated exact runner ID/attempt
  // must be excluded without waiting for its own PR-linkage population.
  assert.equal(await readerGate.qualifyReaderInvocation({...adapters(),
    loadRuns:async()=>[...greenRuns(),{...currentApproval,pull_requests:[]}]}),sha);
  const failed={...genuine,id:6,run_number:3,conclusion:'failure'};
  await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),
    loadRuns:async()=>[...greenRuns(),failed,{...olderApproval,run_number:4}],
    loadRunJobs:async(id,a)=>id===5?approvalJobs(id):sourceJobs(id,a)}),/CI/);
});

test('exact-attempt job proof refuses unknown, duplicate, partial and unlinked evidence',async()=>{
  const bad=[{total_count:2,jobs:(await sourceJobs(4,1)).jobs},
    {total_count:0,jobs:[]},
    {total_count:2,jobs:[...(await sourceJobs(4,1)).jobs,...approvalJobs(4).jobs]},
    {total_count:1,jobs:[{...(await sourceJobs(4,1)).jobs[0],name:'unknown'}]},
    {total_count:2,jobs:[...(await sourceJobs(4,1)).jobs,{...(await sourceJobs(4,1)).jobs[0],id:999}]},
    {total_count:1,jobs:[{...approvalJobs(4).jobs[0],conclusion:'success'}]},
    {total_count:1,jobs:[null]},
    {total_count:1,jobs:[{...(await sourceJobs(4,1)).jobs[0],id:0}]},
    {total_count:1,jobs:[{...(await sourceJobs(4,1)).jobs[0],run_id:5}]},
    {total_count:1,jobs:[{...(await sourceJobs(4,1)).jobs[0],status:'unknown'}]},
    {total_count:101,jobs:Array.from({length:101},(_,i)=>({...approvalJobs(4).jobs[0],id:100+i}))}];
  for(const payload of bad)await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),loadRunJobs:async()=>payload}),/CI/);
  for(const fields of [{id:0},{id:'4'},{run_attempt:0},{run_attempt:1.5},{run_number:0},{id:9007199254740992},
    {pull_requests:[]},{pull_requests:[{number:8}]},{status:'unknown'}]){
    await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),
      loadRuns:async()=>[...greenRuns().slice(0,3),{...greenRuns()[3],...fields}]}),/CI/);
  }
  for(const status of ['queued','in_progress','cancelled'])await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),
    loadRuns:async()=>[...greenRuns().slice(0,3),{...greenRuns()[3],status,conclusion:status==='cancelled'?'cancelled':null}]}),/CI/);
  await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),loadRunJobs:async()=>{throw Error('READ_FAILED');}}),/READ_FAILED/);
  for(const conclusion of ['cancelled','skipped','failure'])await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),
    loadRunJobs:async()=>({total_count:1,jobs:[{...(await sourceJobs(4,1)).jobs[0],conclusion}]})}),/CI/);
});

test('newer relevant ambiguous head identity cannot fall through to an older genuine green',async()=>{
  const older={...greenRuns()[3],id:10,run_number:10};
  const mutations=[r=>delete r.head_repository,r=>r.head_repository=null,r=>r.head_repository=false,
    r=>r.head_repository=repo.full_name,r=>r.head_repository=[],r=>r.head_repository={},
    r=>r.head_repository={full_name:repo.full_name.toUpperCase()},
    r=>r.head_repository={full_name:'erikkaniss-ai/FillMyCourt'},
    ...[null,42,false,[],{},'', ' '].map(value=>r=>r.head_repository={full_name:value}),
    r=>delete r.head_branch,...[null,42,false,[],{},'', ' '].map(value=>r=>r.head_branch=value)];
  for(const mutate of mutations){
    const newer={...older,id:11,run_number:11,conclusion:'failure'};mutate(newer);
    const jobs=[],protection=[];
    await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),
      loadRuns:async()=>[...greenRuns().slice(0,3),older,newer],
      loadRunJobs:async(id,a)=>{jobs.push(id);return sourceJobs(id,a);},
      checkProtection:async()=>{protection.push(true);return 401;}}),/CI_RUN_PROOF_INVALID/);
    assert.deepEqual(jobs,[]);assert.deepEqual(protection,[]);
  }
});

test('explicit complete foreign identities stay unrelated and exact current approval identity stays excluded',async()=>{
  const older={...greenRuns()[3],id:10,run_number:10};
  for(const foreign of [{...older,id:11,run_number:11,conclusion:'failure',head_repository:{full_name:'other/repo'}},
    {...older,id:11,run_number:11,conclusion:'failure',head_branch:'another-branch'}]){
    const reads=[];
    assert.equal(await readerGate.qualifyReaderInvocation({...adapters(),
      loadRuns:async()=>[...greenRuns().slice(0,3),older,foreign],
      loadRunJobs:async(id,a)=>{reads.push(id);return sourceJobs(id,a);}}),sha);
    assert.deepEqual(reads,[10]);
  }
  const current={...older,id:99,run_number:12,status:'in_progress',conclusion:null};
  delete current.head_repository;delete current.head_branch;
  assert.equal(await readerGate.qualifyReaderInvocation({...adapters(),
    loadRuns:async()=>[...greenRuns().slice(0,3),older,current]}),sha);
  await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),
    loadRuns:async()=>[...greenRuns().slice(0,3),older,{...current,run_attempt:2}]}),/CI_RUN_PROOF_INVALID/);
});

test('classification has a 16-candidate bound and caches only complete exact attempts',async()=>{
  const candidates=Array.from({length:17},(_,i)=>({...greenRuns()[3],id:20+i,run_number:20+i}));
  let calls=0;
  await assert.rejects(readerGate.qualifyReaderInvocation({...adapters(),loadRuns:async()=>[...greenRuns().slice(0,3),...candidates],
    loadRunJobs:async id=>{calls++;return approvalJobs(id);}}),/CI/);
  assert.equal(calls,16);
  assert.equal(typeof readerGate.genuineFederatedCi,'function');
  const cache=new Map(),ids=[];
  const load=async(id,a)=>{ids.push([id,a]);return sourceJobs(id,a);};
  assert.equal(await readerGate.genuineFederatedCi(greenRuns(),sha,edited(),load,cache),true);
  assert.equal(await readerGate.genuineFederatedCi(greenRuns(),sha,edited(),load,cache),true);
  const next=[...greenRuns().slice(0,3),{...greenRuns()[3],run_attempt:2}];
  assert.equal(await readerGate.genuineFederatedCi(next,sha,edited(),load,cache),true);
  assert.deepEqual(ids,[[4,1],[4,2]]);
  const pending=[...greenRuns().slice(0,3),{...greenRuns()[3],status:'in_progress',conclusion:null}];
  const uncached=new Map(),reads=[];
  const read=async(id,a)=>{reads.push([id,a]);return sourceJobs(id,a);};
  assert.equal(await readerGate.genuineFederatedCi(pending,sha,edited(),read,uncached),false);
  assert.equal(uncached.size,0);
  assert.equal(await readerGate.genuineFederatedCi(greenRuns(),sha,edited(),read,uncached),true);
  assert.deepEqual(reads,[[4,1],[4,1]]);
});

test('actual private Reader job admits the explicit same-commit manual PR5 static invocation only',()=>{
  const gh={repository:repo.full_name,event_name:'workflow_dispatch',sha,ref:context.ref,event:{}};
  assert.equal(jobAdmitted(gh,context.event.inputs),true);
  for(const inputs of [{},{candidate_sha:sha},{scope:'pr5-reader-static'},
    {...context.event.inputs,candidate_sha:'2'.repeat(40)},
    {...context.event.inputs,scope:'pr5-search'}])assert.equal(jobAdmitted(gh,inputs),false);
  assert.equal(jobAdmitted({...gh,ref:'refs/heads/main'},context.event.inputs),false);
  assert.equal(jobAdmitted({...gh,event_name:'push'},context.event.inputs),false);
  const pull={repository:repo.full_name,event_name:'pull_request',event:{action:'synchronize',pull_request:pr}};
  assert.equal(jobAdmitted(pull),true);
  assert.equal(jobAdmitted({...pull,event:{pull_request:{...pr,body:''}}}),false);
  assert.equal(jobAdmitted({...pull,event:{pull_request:{...pr,head:{...pr.head,ref:'main'}}}}),false);
  assert.equal(jobAdmitted({...pull,event:{pull_request:{...pr,head:{...pr.head,repo:{full_name:'other/repo'}}}}}),false);
  assert.equal(jobAdmitted({...gh,repository:'other/repo'},context.event.inputs),false);
  for(const result of ['success','failure','cancelled'])assert.equal(jobAdmitted(gh,context.event.inputs,result),false);
  for(const result of ['skipped','failure','cancelled'])assert.equal(jobAdmitted(pull,{},result),false);
  assert.equal(jobAdmitted(gh,context.event.inputs,'skipped',true),false);
  assert.equal(jobAdmitted(pull,{},'success',true),false);
});

test('offline precredential qualification allows only the exact candidate after current PR and complete CI rechecks',async()=>{
  assert.equal(typeof readerGate.qualifyReaderInvocation,'function');
  const trace=[];
  const result=await readerGate.qualifyReaderInvocation({context,
    loadPr:async()=>{trace.push('pr');return pr;},
    loadRuns:async()=>{trace.push('ci');return greenRuns();},
    loadRunJobs:sourceJobs,
    checkProtection:async target=>{trace.push('protection');assert.equal(target,'https://deploy-preview-5--getacourt-preview.netlify.app/');return 401;},
    wait:async()=>assert.fail('green prerequisites do not wait')});
  assert.equal(result,sha);assert.deepEqual(trace,['pr','ci','pr','protection','pr']);
});

test('existing approved PR invocation retains its successful browser dependency without a circular workflow requirement',async()=>{
  const pull={...context,eventName:'pull_request',ref:'refs/pull/5/merge',
    workflowSha:'2'.repeat(40),browserResult:'success',event:{number:5,action:'synchronize',pull_request:pr}};
  assert.equal(await readerGate.qualifyReaderInvocation({context:pull,loadPr:async()=>pr,
    loadRuns:async()=>greenRuns().slice(0,3),checkProtection:async()=>401}),sha);
  await assert.rejects(readerGate.qualifyReaderInvocation({context:{...pull,event:{number:5,pull_request:{...pr,body:''}}},
    loadPr:async()=>assert.fail('stale event reached live adapters')}),/INVOCATION/);
});

test('manual/PR event or candidate mismatches are refused before any external adapter',async()=>{
  assert.equal(typeof readerGate.qualifyReaderInvocation,'function');
  const prContext={...context,eventName:'pull_request',ref:'refs/pull/5/merge',
    browserResult:'success',event:{number:5,action:'synchronize',pull_request:pr}};
  const bad=[{...context,eventName:'push'},{...context,repository:'other/repo'},
    {...context,ref:'refs/heads/main'},{...context,workflowSha:'2'.repeat(40)},
    {...context,sourceSha:''},{...context,browserResult:'failure'},
    {...context,browserResult:'success'},{...context,browserResult:'cancelled'},
    {...prContext,browserResult:'skipped'},{...prContext,browserResult:'cancelled'},
    {...context,event:{inputs:{}}},{...context,event:{inputs:{candidate_sha:sha,scope:'pr8-reader-static'}}},
    {...context,event:{inputs:{...context.event.inputs,target:'public'}}},
    {...prContext,event:{number:8,pull_request:pr}},
    {...prContext,ref:'refs/pull/8/merge'},
    {...prContext,event:{number:5,pull_request:{...pr,head:{...pr.head,ref:'main'}}}}];
  for(const value of ['',sha+'x','A'.repeat(40),'main','../'+sha,'2'.repeat(40)])bad.push({...context,event:{inputs:{...context.event.inputs,candidate_sha:value}}});
  const never=async()=>assert.fail('rejected invocation reached an external adapter');
  for(const candidate of bad)await assert.rejects(readerGate.qualifyReaderInvocation({context:candidate,loadPr:never,loadRuns:never,checkProtection:never,wait:never}),/INVOCATION/);
  assert.equal(readerGate.invocationCandidate(prContext),sha);
});

test('missing/stale/duplicate approval and drift stay closed before credentials or upload',async()=>{
  assert.equal(typeof readerGate.qualifyReaderInvocation,'function');
  const badPr=[{...pr,body:''},{...pr,body:pr.body+pr.body},
    {...pr,body:pr.body+'<!-- GET_STAGING_UAT_APPROVED_SHA:not-a-sha -->'},
    {...pr,body:pr.body.replace(sha,'2'.repeat(40))},{...pr,draft:false},
    {...pr,head:{...pr.head,sha:'2'.repeat(40)}},{...pr,head:{...pr.head,ref:'main'}},
    {...pr,number:8},{...pr,base:{...pr.base,ref:'main'}}];
  for(const current of badPr){
    const trace=[];
    await assert.rejects(readerGate.qualifyReaderInvocation({context,loadPr:async()=>{trace.push('pr');return current;},
      loadRuns:async()=>assert.fail('unapproved PR reached CI'),checkProtection:async()=>assert.fail('unapproved PR reached protection')}),/EXACT_OWNER_UAT/);
    assert.deepEqual(trace,['pr']);
  }
  for(const driftAt of [2,3]){
    let calls=0,probes=0;
    await assert.rejects(readerGate.qualifyReaderInvocation({context,loadPr:async()=>++calls===driftAt?{...pr,head:{...pr.head,sha:'2'.repeat(40)}}:pr,
      loadRuns:async()=>greenRuns(),loadRunJobs:sourceJobs,checkProtection:async()=>{probes++;return 401;}}),/PR_CHANGED/);
    assert.equal(probes,driftAt===2?0:1);
  }
});

test('manual qualification requires all four latest exact-SHA PR workflows and fail-closed protection',async()=>{
  assert.equal(typeof readerGate.qualifyReaderInvocation,'function');
  const missing=greenRuns().slice(1),failed=[...greenRuns(),{...greenRuns()[0],id:20,run_number:3,conclusion:'failure'}];
  const laterFederatedFailure=[...greenRuns(),{...greenRuns()[3],id:5,run_number:3,conclusion:'failure'}];
  for(const runs of [[],missing,greenRuns().slice(0,3),failed,laterFederatedFailure,
    greenRuns().map(r=>({...r,head_sha:'2'.repeat(40)})),greenRuns().map(r=>({...r,event:'workflow_dispatch'}))]){
    await assert.rejects(readerGate.qualifyReaderInvocation({context,loadPr:async()=>pr,loadRuns:async()=>runs,loadRunJobs:sourceJobs,
      attempts:1,wait:async()=>assert.fail('final failed attempt must not wait'),
      checkProtection:async()=>assert.fail('failed prerequisites reached protection')}),/REQUIRED_CI_NOT_GREEN/);
  }
  for(const status of [200,302,403,500])await assert.rejects(readerGate.qualifyReaderInvocation({context,loadPr:async()=>pr,
    loadRuns:async()=>greenRuns(),loadRunJobs:sourceJobs,checkProtection:async()=>status}),/EXISTING_NONPRODUCTION_PROTECTION_UNVERIFIED/);
});

test('workflow keeps fixed target, private-search parked, and both guards ahead of the only deploy credential',()=>{
  const browser=workflow.split('  search-contract-and-browser:\n')[1]?.split('  private-reader-draft:\n')[0];
  assert.match(browser,/^    if: github\.event_name == 'pull_request' && \(github\.event\.action == 'opened'.*'synchronize'.*'reopened'\)$/m,
    'manual invocation reuses the four prior exact-SHA PR greens instead of replaying browser CI');
  assert.match(workflow,/candidate_sha:\s*\n\s+description:/);
  assert.match(workflow,/scope:\s*\n\s+description:/);
  assert.match(readerJob,/ref: \$\{\{ env\.SOURCE_SHA \}\}/);
  const first=readerJob.indexOf(' --gate'),second=readerJob.indexOf(' --gate',first+1),credential=readerJob.indexOf('NETLIFY_AUTH_TOKEN:');
  assert.ok(first>0&&second>first&&credential>second);
  assert.equal((readerJob.match(/secrets\./g)||[]).length,1);
  assert.match(readerJob,/--site 5dbcc4a3-5c87-4c75-959f-9a4f9fbc9570/);
  assert.match(readerJob,/--alias get-pr5-reader-uat --no-build/);
  assert.doesNotMatch(readerJob,/--prod\b|inputs\.(?:site|alias|token|target)/);
  assert.match(workflow.split('  private-search-draft:\n')[1],/^    if: github\.event_name == 'pull_request' && github\.event\.action != 'edited' && github\.event\.pull_request\.number == 5 && contains\(github\.event\.pull_request\.body, format\('<!-- GET_SEARCH_UAT_APPROVED_SHA:/);
});
test('protected Reader deploy requires the current single exact SHA approval and original draft scope',()=>{
  assert.equal(approved(pr,sha),true);
  for(const p of [{...pr,body:''},{...pr,body:pr.body+pr.body},{...pr,draft:false},
    {...pr,title:'Reader'},{...pr,head:{...pr.head,sha:'2'.repeat(40)}},
    {...pr,base:{...pr.base,ref:'main'}}])assert.equal(approved(p,sha),false);
});

test('map package pins local Leaflet bytes, serves only finite static assets and permits only OSM images',()=>{
  for(const [ext,sri] of [['js','20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='],
    ['css','p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=']]){
    const path='leaflet-1.9.4.'+ext;
    assert.ok(FILES.includes(path));
    assert.equal(createHash('sha256').update(readFileSync(new URL('../assets/'+path,import.meta.url))).digest('base64'),sri);
  }
  assert.match(readFileSync(new URL('../assets/leaflet-1.9.4-LICENSE.txt',import.meta.url),'utf8'),/Redistribution and use/);
  assert.equal(new Set(FILES).size,FILES.length);
  assert.ok(FILES.every(f=>/^[a-zA-Z0-9.-]+$/.test(f)||/^images\/(?:layers(?:-2x)?|marker-icon(?:-2x)?|marker-shadow)\.png$/.test(f)));
  assert.match(CONTENT_SECURITY_POLICY,/script-src 'self'; style-src 'self';/);
  assert.match(CONTENT_SECURITY_POLICY,/img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/);
  assert.match(CONTENT_SECURITY_POLICY,/connect-src 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY,/unsafe-inline|\*|unpkg|playtomic|racket/);
});

const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
const original=await readStaticPackageInputs(sourceRoot);
function changed(name,text){const files=new Map(original);files.set(name,Buffer.from(text));return files;}
function build(files=original,sourceSha=sha){return createStaticPackage({sourceSha,files});}

test('pure finite bundle closes actual Find HTML, module graph, CSS images and vendor runtime roots',()=>{
  const entries=build();
  assert.deepEqual(FILES,[
    'source-catalog.mjs','federated-search.mjs','court-search-page.mjs',
    'personal-source-observation.js','personal-observation-bridge.mjs','player-search-view.mjs','player-search.css',
    'event-discovery.mjs','event-discovery-view.mjs','event-demo-fixtures.mjs','event-discovery.css',
    'leaflet-1.9.4.js','leaflet-1.9.4.css','leaflet-1.9.4-LICENSE.txt',
    'images/layers.png','images/layers-2x.png','images/marker-icon.png','images/marker-icon-2x.png','images/marker-shadow.png']);
  assert.ok(Object.isFrozen(FILES));
  const proof=JSON.parse(entries.get('asset-integrity.json'));
  assert.equal(proof.source_sha,sha);assert.equal(Object.keys(proof.assets).length,20);
  assert.ok(proof.assets['find.html'].dependencies.includes('assets/event-discovery.css'));
  assert.ok(proof.assets['assets/player-search-view.mjs'].dependencies.includes('assets/event-discovery-view.mjs'));
  assert.ok(proof.assets['assets/court-search-page.mjs'].dependencies.includes('assets/event-demo-fixtures.mjs'));
  assert.deepEqual(proof.assets['assets/leaflet-1.9.4.css'].dependencies,
    ['assets/images/layers-2x.png','assets/images/layers.png','assets/images/marker-icon.png']);
  for(const [name,row] of Object.entries(proof.assets)){
    assert.equal(row.sha256,createHash('sha256').update(entries.get(name)).digest('hex'));
    assert.equal(row.bytes,entries.get(name).length);
    assert.deepEqual(entries.get(name),original.get(name));
  }
  for(const [name,hash] of Object.entries(LEAFLET_HASHES))assert.equal(proof.assets[name].sha256,hash);
  assert.deepEqual(JSON.parse(entries.get('preview-build.json')),
    {kind:'GET_READER_STATIC_UAT',source_sha:sha,site_id:'5dbcc4a3-5c87-4c75-959f-9a4f9fbc9570',functions:0,provider_requests:0});
  assert.match(entries.get('_headers').toString(),/Content-Security-Policy: default-src 'none'/);
  assert.match(entries.get('_headers').toString(),/Cache-Control: private, no-store/);
  assert.match(entries.get('netlify.toml').toString(),/directory = "functions"/);
  assert.equal(entries.size,25);assert.ok([...entries.keys()].every(p=>!p.startsWith('functions/')));
});

test('missing new event module or CSS, extra sensitive input, wrong-case keys and invalid source SHA fail closed',()=>{
  for(const name of ['assets/event-discovery.mjs','assets/event-discovery-view.mjs','assets/event-demo-fixtures.mjs','assets/event-discovery.css']){
    const files=new Map(original);files.delete(name);assert.throws(()=>build(files),/STATIC_PACKAGE_INPUT_SET/);
  }
  for(const name of ['.env','functions/search.mjs','browser-companion/background.js','assets/auth-pkce.js','assets/../.env']){
    const files=new Map(original);files.set(name,Buffer.from('sensitive-sentinel'));assert.throws(()=>build(files),/STATIC_PACKAGE_INPUT_SET/);
  }
  const files=new Map(original);files.set('assets/Event-discovery.mjs',files.get('assets/event-discovery.mjs'));files.delete('assets/event-discovery.mjs');
  assert.throws(()=>build(files),/STATIC_PACKAGE_INPUT_SET/);
  for(const v of ['',sha.toUpperCase(),'latest','../'+sha,'g'.repeat(40)])if(v!==sha)assert.throws(()=>build(original,v),/STATIC_PACKAGE_INPUT/);
});

test('transitive module paths reject traversal, case mismatch, escaped paths, remote, queries and unknown additions',()=>{
  const base=original.get('assets/event-demo-fixtures.mjs').toString();
  for(const ref of ['./Event-discovery.mjs','../assets/event-discovery.mjs','./../assets/event-discovery.mjs',
    './event-discovery.mjs?x=1','./event-discovery.mjs#x','./%65vent-discovery.mjs',
    './event\\u002ddiscovery.mjs','https://provider.invalid/a.mjs','//provider.invalid/x','/assets/event-discovery.mjs',
    './auth-pkce.js','./missing.mjs','./images//layers.png']){
    assert.throws(()=>build(changed('assets/event-demo-fixtures.mjs',`import '${ref}';\n`+base)),/STATIC_PACKAGE_(REFERENCE|UNREVIEWED_DEPENDENCY)/);
  }
});

test('static re-exports close dependencies; comments, regex, strings and template text are not executable imports',()=>{
  const base=original.get('assets/event-demo-fixtures.mjs').toString();
  const files=changed('assets/event-demo-fixtures.mjs',`// import './missing.mjs';
/* export * from './missing.mjs'; */
const fake="import './missing.mjs'"; const pattern=/import\\(['"]missing/;
const template=\`import('./missing.mjs')\`;
export {eventKey} from './event-discovery.mjs';
`+base);
  const proof=JSON.parse(build(files).get('asset-integrity.json'));
  assert.deepEqual(proof.assets['assets/event-demo-fixtures.mjs'].dependencies,['assets/event-discovery.mjs']);
});

test('dynamic or computed imports fail closed including nested template expressions',()=>{
  const base=original.get('assets/event-demo-fixtures.mjs').toString();
  for(const expression of ["import('./event-discovery.mjs')","import(variable)","import /* gap */ ('./event-discovery.mjs')",
    '`value ${import("./missing.mjs")}`','import.meta.url']){
    assert.throws(()=>build(changed('assets/event-demo-fixtures.mjs',base+'\nconst extra='+expression+';')),/STATIC_PACKAGE_DYNAMIC_MODULE/);
  }
});

test('HTML resource references, inline active code, remote CSS and obfuscated CSS cannot widen the bundle',()=>{
  const html=original.get('find.html').toString(),css=original.get('assets/event-discovery.css').toString();
  for(const extra of ['<script src="assets/app.js"></script>','<link rel="stylesheet" href="https://provider.invalid/x.css">',
    '<img src="../secret.png">','<script>alert(1)</script>','<style>body{}</style>','<iframe src="find.html"></iframe>',
    '<img srcset="assets/images/marker-icon.png 2x">','<body onload="alert(1)">']){
    assert.throws(()=>build(changed('find.html',html+extra)),/STATIC_PACKAGE_/);
  }
  for(const extra of ['@import "https://provider.invalid/x.css";','@import url(./missing.css);',
    '.x{background:url(./missing.png)}','.x{background:url(../secret.png)}',
    '.x{background:u\\72l(./missing.png)}']){
    assert.throws(()=>build(changed('assets/event-discovery.css',css+'\n'+extra)),/STATIC_PACKAGE_/);
  }
});

test('unused manifest assets and altered pinned vendor bytes are rejected',()=>{
  const html=original.get('find.html').toString().replace('<link rel="stylesheet" href="assets/event-discovery.css">','');
  assert.throws(()=>build(changed('find.html',html)),/STATIC_PACKAGE_UNREACHABLE_ASSET/);
  for(const name of Object.keys(LEAFLET_HASHES))assert.throws(()=>build(changed(name,'tampered vendor bytes')),/STATIC_PACKAGE_VENDOR_INTEGRITY/);
});

test('local disk writer creates only validated static files and an empty functions directory, refuses a stale destination',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'gac-package-')),output=join(temp,'bundle');
  const result=await writeStaticPackage({sourceRoot,sourceSha:sha,output});assert.equal(result.files,25);
  assert.deepEqual(await readdir(join(output,'functions')),[]);
  assert.deepEqual(JSON.parse(await readFile(join(output,'preview-build.json'),'utf8')).source_sha,sha);
  await writeFile(join(output,'functions','must-not-survive.js'),'synthetic');
  await assert.rejects(writeStaticPackage({sourceRoot,sourceSha:sha,output}),{code:'EEXIST'});
  assert.equal(await readFile(join(output,'functions','must-not-survive.js'),'utf8'),'synthetic');
});

test('filesystem loader detects missing and wrong-case files before writing output',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'gac-missing-'));await mkdir(join(temp,'assets'));
  await writeFile(join(temp,'Find.html'),original.get('find.html'));
  await assert.rejects(readStaticPackageInputs(temp),/STATIC_PACKAGE_EXACT_CASE_OR_MISSING_ASSET/);
});

test('filesystem loader rejects symlink assets on platforms with symlink support',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'gac-symlink-'));await mkdir(join(temp,'assets'));
  await writeFile(join(temp,'find.html'),original.get('find.html'));
  const target=join(temp,'target.txt');await writeFile(target,'synthetic');
  try{await symlink(target,join(temp,'assets','source-catalog.mjs'));}
  catch(e){if(e.code==='EPERM'){t.skip('Windows symlink privilege unavailable; Linux CI exercises this boundary');return;}throw e;}
  await assert.rejects(readStaticPackageInputs(temp),/STATIC_PACKAGE_SYMLINK/);
});

test('CLI prepare remains CI-only and local packaging never spoofs GITHUB_ACTIONS',()=>{
  const script=fileURLToPath(new URL('../qa/private-reader-preview.mjs',import.meta.url));
  const env={...process.env,SOURCE_SHA:sha};delete env.GITHUB_ACTIONS;delete env.GITHUB_TOKEN;
  const result=spawnSync(process.execPath,[script,'--prepare'],{env,encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/CI_STATIC_PACKAGE_ONLY/);
});
test('only latest successful real PR workflows count; stale or later failures cannot inherit success',()=>{
  const paths=['platform-ci','getacourt-a11y-ci','getacourt-offline-safety-ci'];
  const runs=paths.map((name,index)=>({id:index+1,pull_requests:[{number:5}],path:'.github/workflows/'+name+'.yml',head_sha:sha,event:'pull_request',
    head_branch:pr.head.ref,head_repository:repo,run_number:2,run_attempt:1,status:'completed',conclusion:'success'}));
  assert.equal(ciState(runs,sha),true);
  assert.equal(ciState(runs.slice(1),sha),false);
  assert.equal(ciState(runs,'2'.repeat(40)),false);
  assert.equal(ciState([...runs,{...runs[0],id:20,run_number:3,conclusion:'failure'}],sha),false);
  assert.equal(FILES.some(f=>/app\.js|auth|book|checkout|provider-connection/.test(f)),false);
});
