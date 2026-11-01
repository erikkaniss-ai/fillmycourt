// Actual guarded controller; import is inert. Public model has no network/process/Auth.
export const ROOT = new URL('../../', import.meta.url).href;
export async function installFillNode(scope, offline) {
  const p = offline?.prepared??(typeof fill09Prepared === 'undefined' ? null : fill09Prepared);
  function clearPrivateInputs() {
    if(p&&p.run_id===scope?.run_id&&p.authorization_id===scope?.authorization_id){p.passwords=null;p.client_plan=null;}
  }
  try {
  const root = offline?.moduleRoot??'file:///C:/Users/Thinkpad%20X1%20Gen7/.codex/.chatgpt-projects/g-p-6a942edc77308191bf006821104fda8c/fillmycourt-operator-mvp/';
  const b = await import(root + 'platform/scripts/fill_uat_checkpoint_bridge.mjs');
  const v = await import(root + 'platform/scripts/fill_uat_evidence_verdict.mjs');
  const t = await import(root + 'platform/scripts/fill_uat_process_transport.mjs');
  const { performance } = await import('node:perf_hooks');
  const hash = '694f67cdcd99b30ed2eefabd2e5a377890bd8bceeeecfd28c369176646e82894';
  const must = ok => { if (!ok) throw Error('FILL09_REJECTED'); };
  v.exact(scope,['run_id','authorization_id']);
  // Only the offline exercise supplies argument2. The live foreground below
  // ALWAYS serializes a ONE-argument install. Public mode NEVER selects the
  // real factory and is visibly labelled in every returned status.
  if(offline!==undefined) {
    v.exact(offline,['publicOnly','prepared','wall','monotonic','factory','moduleRoot']);
    must(offline.publicOnly===true&&typeof offline.factory==='function'&&typeof offline.wall==='function'&&typeof offline.monotonic==='function'&&
      /^00000000-0000-0000-0000-/.test(scope.run_id)&&/^00000000-0000-0000-0000-/.test(scope.authorization_id)&&
      Object.values(offline.prepared.passwords).every(x=>typeof x==='string'&&x.startsWith('SYNTHETIC_SENTINEL:')));
  }
  const wall=offline?.wall??Date.now, monotonic=offline?.monotonic??(()=>performance.now());
  const launch=offline===undefined?t.launchReviewedLiveCollector:offline.factory;
  // This private envelope is a TRUSTED executor dependency, not authentication
  // manufactured by booleans. Its real owner receipt/scope must be reviewed
  // outside Node BEFORE any inactive intent/release. No values supplied in09.
  must(p?.trustedOwnerReceiptVerified === true && p.trustedSourceAcceptanceVerified === true && /^[0-9a-f]{40}$/.test(p.source_sha) && p.source_sha === p.accepted_source_sha &&
    p.run_id === scope.run_id && p.authorization_id === scope.authorization_id && p.max_new_accounts === 3 && p.public_go === false && p.consumed === false);
  must(p.latest_authority_expiry === undefined || Number.isFinite(p.latest_authority_expiry));
  v.uuid(scope.run_id); v.uuid(scope.authorization_id);
  must(!v.CONSUMED_RUNS.includes(scope.run_id) && !v.CONSUMED_AUTHORITIES.includes(scope.authorization_id) && scope.run_id!=='4c0cdb3b-c138-479b-9b69-fef96420642b' && scope.authorization_id!=='01a1958f-5bc5-7382-822d-27d4db023a3e');
  const historical = ['057375d4-0d8f-4879-babe-db842630c871','45ef3b07-f811-4e27-b41b-64fe5970d675','46b4b78b-de3c-4e98-a414-941baddd6c95','4d7bbd35-8dc8-42cf-96db-ecfb17d35ad9','4ff65a8d-3d3b-4fd7-a032-a81fd8f51fce','57666863-9cae-4a60-aec1-4db5976ff094','596af5cb-6f58-45cc-a966-cc0266bbafab','af2942da-fab9-419b-8d42-8ecb107c4cd9','b82a8774-839f-4b73-8c4d-5c76c10dd957','bc7a9bbf-ba3f-4e40-9a60-7fe0367c7dc3','c29ba3be-d7ae-4dff-b662-88d1b0504024','cab76dae-5368-4483-85b7-13640e1fd8db','ff7959bf-dd1a-491e-a8fc-49888f1122fc'];
  let binding, authority, owner, plan, relay, cache, child, task, receipt, lastSnapshot, checkpoint, proof, cleanupRelay;
  let phase = 'DISCOVERY', stopped = false, launched = false, currentCommand, next = 0, canarySent = false, cleanupRequested = false;
  historical.push('70e38a5b-a980-4b1a-8a62-e7478fcb8b08','9e30235b-9ddf-4a7f-83dc-1aa95bd56c0b','b3ab3f9d-b94c-456c-84f0-35181e0ec224');
  let cutoff = wall() + 300000, startWall, startMono, closedProof = null, outcome='PENDING', childAbortTask, positiveReady=false,controlFailure=null,operatorAdmissionWaiting=false,operatorsReady=false,rootAccepted=null,clockWait=null;
  const observations = [], canary = [
    { op: 'login', label: 'canary' }, { op: 'get', label: 'canary', route: 'own_today' }, { op: 'get', label: 'canary', route: 'foreign_today' }
  ];
  const operators = ['a','b'].flatMap(label => [{ op: 'login', label }, ...['me','organizations','own_today','foreign_today','own_calendar','foreign_calendar','provider_connections'].map(route => ({ op: 'get', label, route }))]);
  const stamp = expression => `to_char((${expression}) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  // Future pre-binding discovery: only NEW authorized run's private journal,
  // no auth.users or password-bearing digest. Actual09 uses NONE of this SQL.
  const discovery = `select jsonb_build_object('run_id',i.run_id,'authorization_id',i.authorization_id,'candidate_sha',i.candidate_sha,'project_ref',i.project_ref,'deployment_id',i.deployment_id,'starts_at',${stamp('i.starts_at')},'observed_at',${stamp('clock_timestamp()')},'stopped',i.stopped,'reconciliation_required',i.reconciliation_required,'lease_digest',case when r.run_id is null then null else encode(sha256(convert_to(r.spec::text,'UTF8')),'hex') end,'attempts',coalesce((select jsonb_agg(jsonb_build_object('label',a.label,'operation',a.operation,'user_id',a.user_id,'verified',a.verified,'settled',a.settled,'reserved_at',${stamp('a.reserved_at')})) from (select label,operation,user_id,verified,settled,reserved_at from fill_private.uat_bootstrap_attempts where run_id=i.run_id order by label,operation limit 7) a),'[]'::jsonb)) as snapshot from fill_private.uat_bootstrap_intents i left join fill_private.uat_runs r on r.run_id=i.run_id where i.run_id='${scope.run_id}'::uuid and i.authorization_id='${scope.authorization_id}'::uuid limit 1`;
  function kick(command, fn) {
    must(!task && !stopped); currentCommand = command; receipt = null;
    // Owned in-flight Promise, NOT a detached controller/helper/automation.
    // Return immediately so official checkpoint reads continue during the wait.
    task = Promise.resolve().then(fn).then(r => { receipt = r; }, error => { controlFailure={stage:'HELPER_OPERATION',code:'HELPER_OPERATION_FAILED'};receipt = { responseComplete:false }; if(error?.processLaunched)closedProof={processLaunched:true,processClosedObserved:error.processClosedObserved===true}; });
  }
  function kill() {
    clearPrivateInputs();
    if (!stopped) {
      stopped = true; phase = 'CLEANUP_ONLY'; cache?.stop();
      if(outcome==='PENDING')outcome='ABORTED';
      if(plan)cleanupRelay=new b.CheckpointRelay({plan,owner:null,publish:()=>{},wall,monotonic});
    }
    if(child)void closeOwned();
  }
  function closeOwned() {
    if(!child)return Promise.resolve();
    childAbortTask??=Promise.resolve().then(()=>child.collector.abort()).then(
      ()=>{closedProof=child.processEvidence();},
      ()=>{closedProof={processLaunched:true,processClosedObserved:false,stopConfirmed:false};});
    return childAbortTask;
  }
  function adopt(raw) {
    const s = b.decodeReadback(raw); v.exact(s, ['run_id','authorization_id','candidate_sha','project_ref','deployment_id','starts_at','observed_at','stopped','reconciliation_required','lease_digest','attempts']);
    must(s.run_id === scope.run_id && s.authorization_id === scope.authorization_id && s.candidate_sha === v.CANDIDATE && s.project_ref === b.PROJECT);
    const observationAge=wall()-v.instant(s.observed_at);
    must(observationAge>=0&&observationAge<=6000&&!s.stopped&&!s.reconciliation_required);
    if (s.starts_at === null) return;
    cutoff = Math.min(v.instant(s.starts_at) + 1800000, p.latest_authority_expiry ?? Infinity);
    const actionStart=v.instant(s.starts_at),age=wall()-actionStart;
    // Only receipt latency gets at most two allowed6s read roundtrips. The
    // pinned server's reserve/verify/settle actions still MUST be before60s.
    must(age>=0&&age<72000&&s.attempts.length<=6);
    const creates = s.attempts.filter(a => a.operation === 'create');
    const actionOnTime=a=>v.instant(a.reserved_at)>=actionStart&&v.instant(a.reserved_at)<actionStart+60000;
    must(creates.every(actionOnTime));
    if(age>=60000)must(creates.length===3&&creates.every(a=>a.verified&&a.user_id)&&s.attempts.some(a=>a.operation==='activate'&&a.label==='canary'&&a.verified&&a.settled&&a.user_id&&actionOnTime(a)));
    // Brief normal server in-flight admission may be observed; never replay it.
    // A missing identity/verification surviving10s or original60s is fatal.
    must(s.attempts.every(a => a.verified || wall() - v.instant(a.reserved_at) < 10000));
    if (creates.length !== 3 || creates.some(a => !a.verified || !a.user_id) || s.lease_digest === null) return;
    must(new Set(creates.map(a => a.label)).size === 3 && creates.every(a => v.LABELS.includes(a.label) && !historical.includes(a.user_id)));
    const canaryActivation=s.attempts.find(a=>a.operation==='activate'&&a.label==='canary');
    // No positive helper/permit callback before canary activation is known
    // verified AND settled. Empty/pending is a normal bounded pre-ready WAIT.
    if(!canaryActivation?.verified||!canaryActivation.settled||!canaryActivation.user_id)return;
    must(canaryActivation.user_id===creates.find(a=>a.label==='canary').user_id);
    must(actionOnTime(canaryActivation));
    binding = v.validateBinding({ run_id: s.run_id, authorization_id: s.authorization_id, candidate_sha: v.CANDIDATE, helper_sha256: v.HELPER_HASH, t0: s.starts_at,
      identities: Object.fromEntries(creates.map(a => [a.label,a.user_id])), historical_ids: historical,
      pins: { operations_service_id:'c0c6e5e2-0040-48e0-a0af-abfb1ec81b61', operations_sha:v.CANDIDATE, core_service_id:'fc97f78f-d39e-4598-a615-b2413b9b3f76', core_sha:'0134f603445ea7f282ef0cb866d0f3591518cbb9', preview_site_id:'d763b7a1-dccd-4638-8876-ac1670171698', preview_sha:v.CANDIDATE, supabase_project_ref:b.PROJECT } });
    authority = v.validateAuthority({ binding, owner_go_verified:true, consumed:false, max_new_accounts:3, issued_at:p.owner_issued_at, expires_at:new Date(cutoff).toISOString(), public_go:false }, binding, wall());
    owner = { binding, authority, transport_sha256:hash, deployment_id:s.deployment_id, lease_digest:s.lease_digest, trusted_owner_context:true };
    plan = b.buildCheckpointReadPlan({ run_id:binding.run_id, known_ids:[...Object.values(binding.identities),...historical], expected_lease_digest:s.lease_digest });
    cache = new b.CheckpointCache({ binding, transportHash:hash, wall });
    relay = new b.CheckpointRelay({ plan, owner, publish:e=>{
      if(!launched&&wall()>=v.instant(binding.t0)+72000)return;
      operatorAdmissionWaiting=boundedOperatorWait(e.state);
      if(!operatorAdmissionWaiting&&(positiveReady||launched))cache.install(e);
    }, wall, monotonic });
    phase = 'CHECKPOINT';
  }
  function canaryEvidence() {
    if (proof) return proof;
    const obs = observations.filter(o => o.label === 'canary');
    const activation = lastSnapshot.attempts.find(a => a.label === 'canary' && a.operation === 'activate');
    const principal = lastSnapshot.principals.find(a => a.label === 'canary');
    must(obs.length === 5 && activation?.first_ban_readback_at && principal.receipt === true && checkpoint.activeKnownCount === 0 && checkpoint.unknownCreates === 0 && checkpoint.unsettledActivations === 0 && checkpoint.knownBanCount === 19);
    proof = { binding, authority, budget: { binding, source:'guard_readback', independent:true, known_created_ids:Object.values(binding.identities), unknown_create_count:0, active_count:0, pending_activation_count:0, unresolved_nonce_count:0, at:lastSnapshot.observed_at },
      canary: { binding, positive:obs.slice(0,3), ban: { source:'guard_readback', independent:true, user_id:binding.identities.canary, banned:true, at:activation.first_ban_readback_at, readback_at:lastSnapshot.observed_at }, retained_denial:obs[3], auth_denial:obs[4], auth_user_banned_verified:obs[4].verified === true } };
    // Current canonical observation may be AFTER180; ban readback must retain
    // the actual BEFORE180 observation used before sending denied_get.
    proof.canary.ban.readback_at = banObservedAt;
    must(v.reduceEvidence(binding, proof, { at:wall(), trustedInput:true }).canary === 'PASS');
    return proof;
  }
  let banObservedAt = null;
  function boundedOperatorWait(state) {
    const age=wall()-v.instant(binding.t0);
    if(!['WAIT_CTO','WAIT_OPERATORS'].includes(phase)||age>=600000||!lastSnapshot||lastSnapshot.intent.verdict_decision!=='pass'||state.decision!=='DENY'||!state.reasons.length||state.reasons.some(r=>r!=='UNSETTLED_ACTIVATION'))return false;
    const pending=lastSnapshot.attempts.filter(a=>a.operation==='activate'&&(!a.verified||!a.settled||!a.user_id||!a.has_nonce));
    return pending.length>0&&pending.every(a=>['a','b'].includes(a.label)&&b.isBoundedActivationPending(lastSnapshot,a,wall()));
  }
  function operatorActivationReady() {
    return ['a','b'].every(label=>{
      const a=lastSnapshot.attempts.find(a=>a.operation==='activate'&&a.label===label),ban=lastSnapshot.bans.find(x=>x.id===binding.identities[label]);
      return a?.verified&&a.settled&&a.has_nonce&&a.user_id===binding.identities[label]&&ban&&(ban.banned_until===null||v.instant(ban.banned_until)<=v.instant(lastSnapshot.observed_at));
    });
  }
  function tick() {
    if (!binding || stopped) return;
    if(!checkpoint){must(phase==='CHECKPOINT'&&!launched&&!task);return;}
    const age = wall() - v.instant(binding.t0);
    if(wall()>=cutoff){kill();return;}
    if(!launched&&!positiveReady){must(age<60000);return;}
    if(operatorAdmissionWaiting){cache.current();return;}
    if(checkpoint.decision!=='ALLOW'){kill();return;}
    if (task && !receipt) return;
    if (receipt) {
      if (!receipt.responseComplete) { kill(); return; }
      observations.push(...(receipt.observations ?? [])); receipt = null; task = null;
      if (currentCommand === 'launch') phase='READY';
      else if (currentCommand === 'ready') phase='CONFIGURE';
      else if (currentCommand === 'configure') phase='CANARY';
      else if (currentCommand === 'gate') { phase='OPERATORS'; next=0; }
      else if (currentCommand === 'retained') phase='FRESH_DENIAL';
      else if (currentCommand === 'fresh') phase='WAIT_CTO';
    }
    if (phase === 'CHECKPOINT') {
      if (checkpoint.decision !== 'ALLOW') return;
      must(age<72000);
      must(!launched); launched=true;
      const config = { op:'configure', approved_helper_sha256:v.HELPER_HASH, plan:{ ...p.client_plan, candidate_sha:v.CANDIDATE, run_id:binding.run_id, authorization_id:binding.authorization_id, t0:binding.t0,
        principals:Object.fromEntries(v.LABELS.map(label=>[label,{id:binding.identities[label],password:p.passwords[label]}])) } };
      kick('launch', async()=>{
        child=await launch({config,binding,checkCurrentPermit:()=>cache.current()});
        // Stop may have happened while the owned factory promise was pending.
        // Retain ownership and close/read back the LATE child before settling.
        if(stopped){await closeOwned();return {responseComplete:false};}
        return {responseComplete:true};
      });
      clearPrivateInputs(); return;
    }
    if (phase==='READY') return kick('ready',()=>child.collector.ready());
    if (phase==='CONFIGURE') return kick('configure',()=>child.collector.configure());
    if (phase==='CANARY') {
      if (next<canary.length) return kick('canary',()=>child.collector.command(canary[next++]));
      phase='WAIT_BAN';
    }
    if (phase==='WAIT_BAN') {
      must(age<180000);
      const activation=lastSnapshot.attempts.find(a=>a.label==='canary'&&a.operation==='activate');
      if (age<120000 || !activation?.first_ban_readback_at || lastSnapshot.principals.find(p=>p.label==='canary')?.receipt!==true) return;
      must(v.instant(activation.first_ban_readback_at)<v.instant(binding.t0)+180000);
      banObservedAt=lastSnapshot.observed_at;
      return kick('retained',()=>child.collector.command({op:'denied_get',label:'canary',route:'me'}));
    }
    if (phase==='FRESH_DENIAL') { must(age<180000); return kick('fresh',()=>child.collector.command({op:'denied_login',label:'canary'})); }
    if (phase==='WAIT_CTO') { must(age<600000); if(v.instant(lastSnapshot.observed_at)>=v.instant(observations.at(-1).at))canaryEvidence(); return; }
    if (phase==='WAIT_OPERATORS') {
      must(age<600000&&rootAccepted&&wall()<v.instant(rootAccepted.independent.expires_at));
      operatorsReady=operatorActivationReady();if(!operatorsReady)return;
      must(checkpoint.operatorGateEligible);return kick('gate',()=>child.collector.authorizeOperators(rootAccepted,{trustedInput:true}));
    }
    if (phase==='OPERATORS') {
      must(age<1200000);
      if(next<operators.length) return kick('operator',()=>child.collector.command(operators[next++]));
      outcome='READS_COMPLETE'; kill();
    }
  }
  return {
    begin() { must(wall()<cutoff); startWall=wall(); startMono=monotonic(); if(stopped){must(cleanupRelay);return {...cleanupRelay.begin(),cleanupOnly:true};} if(!relay) return {query:discovery,project_id:b.PROJECT,discovery:true}; return relay.begin(); },
    async complete(ticket, raw) {
      try {
        must(monotonic()-startMono<=6000 && Math.abs((wall()-startWall)-(monotonic()-startMono))<=2000);
        const originalObservedAt=b.decodeReadback(raw).observed_at,observed=v.instant(originalObservedAt),gap=observed-wall();
        if(gap>0){
          const requestedMs=Math.ceil(gap)+2,remaining=6000-(monotonic()-startMono);
          clockWait={originalObservedAt,requestedMs,elapsedMs:0,code:gap>200?'FUTURE_WAIT_LIMIT':requestedMs>remaining?'READ_BUDGET':'WAITING'};
          must(gap<=200&&requestedMs<=remaining);
          const started=monotonic();await new Promise(resolve=>setTimeout(resolve,requestedMs));clockWait.elapsedMs=monotonic()-started;
          clockWait.code='CLOCK_NOT_CONFIRMED';
          must(clockWait.elapsedMs>=0&&clockWait.elapsedMs<=250&&wall()>=observed&&monotonic()-startMono<=6000&&Math.abs((wall()-startWall)-(monotonic()-startMono))<=2000);
          clockWait.code='PAST_VERIFIED';
        }
        must(!stopped||ticket.cleanupOnly===true);
        if(ticket.discovery) adopt(raw);
        else {
          lastSnapshot=b.validateSnapshot(raw,plan);
          const activation=lastSnapshot.attempts.find(a=>a.operation==='activate'&&a.label==='canary'), health=lastSnapshot.run?.healthy_at;
          positiveReady=!!(activation?.verified&&activation.settled&&activation.user_id===binding.identities.canary&&lastSnapshot.run?.armed&&health&&wall()>=v.instant(health)&&wall()-v.instant(health)<=45000);
          const result=await (ticket.cleanupOnly?cleanupRelay:relay).complete(ticket.sequence,raw,{tool:b.TOOL,project_id:b.PROJECT,query_sha256:plan.query_sha256,trusted_readback:true});
          must(result); checkpoint=result.state; lastSnapshot=b.validateSnapshot(raw,plan);
          const ordinaryWait=operatorAdmissionWaiting||!launched&&!positiveReady&&wall()<v.instant(binding.t0)+60000&&checkpoint.reasons.every(r=>['GUARD_NOT_HEALTHY','UNSETTLED_ACTIVATION'].includes(r));
          if(!stopped&&checkpoint.decision==='DENY'&&!ordinaryWait)kill();
        }
        tick(); return this.status();
      } catch { controlFailure={stage:ticket.discovery?'DISCOVERY':'CANONICAL_READ',code:'CONTROL_REJECTED'};kill(); return this.status(); }
    },
    async acceptRootReceipt(rawComment) {
      // Root publishes the FINAL JSON and verifies its readback FIRST, then
      // writes the canonical verdict referring to that already-final comment.
      // Independent decision time precedes the DB-stamped release time:
      // {kind:'FILL_F1_ROOT_CANARY_PASS_V1',evidence:{...accepted proof,
      // independent:{binding,source:'cto_checkpoint',decision:'pass',
      // lease_digest,evidence_ref,at,expires_at}}}. No markdown extraction.
      try {
        must(!stopped && phase==='WAIT_CTO' && checkpoint.operatorGateEligible && !task);
        must(typeof rawComment.body==='string'&&rawComment.body.length<=32768&&rawComment.html_url===lastSnapshot.intent.verdict_evidence_ref&&rawComment.author_login==='erikkaniss-ai');
        const body=JSON.parse(rawComment.body); v.exact(body,['kind','evidence']);
        must(body?.kind==='FILL_F1_ROOT_CANARY_PASS_V1' && body.evidence.independent.evidence_ref===lastSnapshot.intent.verdict_evidence_ref && body.evidence.independent.lease_digest===owner.lease_digest);
        const e=body.evidence, decisionAt=v.instant(e.independent.at), canonicalAt=v.instant(lastSnapshot.intent.verdict_at), expires=v.instant(e.independent.expires_at), t0=v.instant(binding.t0);
        must(t0+180000<=decisionAt&&decisionAt<=canonicalAt&&canonicalAt<=wall()&&canonicalAt<t0+600000&&canonicalAt<expires&&wall()<expires&&expires<=t0+600000);
        must(v.bindingMatches(e.canary,proof.canary)&&v.bindingMatches(e.budget,proof.budget));
        must(v.reduceEvidence(binding,e,{at:wall(),trustedInput:true}).operatorEligible);
        rootAccepted=e;phase='WAIT_OPERATORS';tick();
      } catch { controlFailure={stage:'ROOT_RECEIPT',code:'ROOT_GATE_REJECTED'};kill(); }
      return this.status();
    },
    status() { return {phase,outcome,cutoff,positiveReady,operatorsReady,operatorAdmissionWaiting,lastPermitDbObservedAt:cache?.snapshot.lastDbObservedAt??null,clockWait,controlFailure,offlinePublicData:offline!==undefined,grantsOwnerGo:false,discovery:!binding,stopped,taskPending:!!task&&!receipt,canaryRequest:phase==='WAIT_CTO'&&proof&&!canarySent?(canarySent=true,{proof,lease_digest:owner.lease_digest}):null,
      rootEvidenceRef:phase==='WAIT_CTO'&&checkpoint?.operatorGateEligible?lastSnapshot.intent.verdict_evidence_ref:null,
      cleanupRequest:stopped&&!cleanupRequested?(cleanupRequested=true,{run_id:scope.run_id,authorization_id:scope.authorization_id}):null,
      cleanup:checkpoint?.cleanup??'UNKNOWN',lastDbObservedAt:checkpoint?.dbObservedAt??null,knownBanCount:checkpoint?.knownBanCount??null,observations,closedProof}; },
    requestStop() { kill(); return this.status(); },
    async stop() { kill(); const owned=[task,childAbortTask].filter(Boolean); let timer;try{if(owned.length)await Promise.race([Promise.allSettled(owned),new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);}finally{clearTimeout(timer);} await relay?.stop(); await cleanupRelay?.stop(); cache?.stop(); return this.status(); }
  };
  } catch { clearPrivateInputs(); throw Error('FILL09_REJECTED'); }
}

export async function validatePublicTransitions() {
  const assert=(await import('node:assert/strict')).default;
  const {publicFixture}=await import(ROOT+'platform/scripts/fill_uat_synthetic_wire_child.mjs');
  const v=await import(ROOT+'platform/scripts/fill_uat_evidence_verdict.mjs');
  const base=Date.parse('2030-01-01T00:00:00Z'), at=s=>new Date(base+s*1000).toISOString().replace(/(\.\d{3})Z$/,'$1000Z');
  async function model() {
    const f=publicFixture(),scope={run_id:f.binding.run_id,authorization_id:f.binding.authorization_id};
    let release,launches=0,aborts=0,ready=0,closed=false,age=30,gates=0,operatorStage='none';const operatorLogins={a:0,b:0};
    const pending=new Promise(resolve=>{release=resolve;});
    const prepared={trustedOwnerReceiptVerified:true,trustedSourceAcceptanceVerified:true,source_sha:'c3df8f020379acc7054fb6b6deb01c8a7250f7a6',accepted_source_sha:'c3df8f020379acc7054fb6b6deb01c8a7250f7a6',...scope,max_new_accounts:3,public_go:false,consumed:false,owner_issued_at:at(-1),
      client_plan:f.config.plan,passwords:Object.fromEntries(v.LABELS.map(label=>[label,f.config.plan.principals[label].password]))};
    const driver=await installFillNode(scope,{publicOnly:true,moduleRoot:ROOT,prepared,wall:()=>base+age*1000,monotonic:()=>(age-30)*1000,factory:options=>{
      launches++; assert.equal(options.checkCurrentPermit().source,'independent_owner_guard_checkpoint');return pending;
    }});
    const creates=v.LABELS.map(label=>({label,operation:'create',user_id:f.binding.identities[label],verified:true,settled:false,reserved_at:at(5)}));
    const activation={label:'canary',operation:'activate',user_id:f.binding.identities.canary,verified:true,settled:true,reserved_at:at(20)};
    const discovery={...scope,candidate_sha:v.CANDIDATE,project_ref:'yclqnbcrchwieyzkyumx',deployment_id:'00000000-0000-0000-0000-000000009999',starts_at:at(0),observed_at:at(30),stopped:false,reconciliation_required:false,lease_digest:'a'.repeat(64),attempts:[...creates,activation]};
    async function adopt() {
      const first=driver.begin(); assert.equal(first.discovery,true);
      const status=await driver.complete(first,[{snapshot:discovery}]);
      assert.equal(status.phase,'CHECKPOINT');assert.equal(status.stopped,false);assert.equal(launches,0);assert.equal(status.offlinePublicData,true);assert.equal(status.grantsOwnerGo,false);
      return driver.begin();
    }
    function rawSnapshot(ticket) {
      const orgs=['4484cf28-1947-41dd-9b41-14891ac93752','af24d8dd-813f-4919-bd6d-49a6d1169b25'];
      return {version:1,project_ref:'yclqnbcrchwieyzkyumx',run_id:scope.run_id,scope_ids:ticket.plan.scope.known_ids,observed_at:at(age),
        run:{run_id:scope.run_id,spec_run_id:scope.run_id,project_ref:'yclqnbcrchwieyzkyumx',candidate_sha:v.CANDIDATE,organization_ids:orgs,starts_at:at(0),expires_at:at(1800),armed:true,stopped:false,healthy_at:at(age),cleanup_complete:false,receipt_count:3,lease_digest_matches:true},
        intent:{...scope,candidate_sha:v.CANDIDATE,project_ref:'yclqnbcrchwieyzkyumx',organization_ids:orgs,deployment_id:discovery.deployment_id,settled_at:at(-20),created_at:at(-15),request_expires_at:at(20),preflight_at:at(-10),released_at:at(-5),starts_at:at(0),stopped:false,reconciliation_required:false,input_digest_valid:true,
          verdict_decision:null,verdict_run_id:null,verdict_candidate_sha:null,verdict_positive_get:null,verdict_denied_login:null,verdict_denied_api:null,verdict_lease_matches_spec:false,verdict_evidence_ref:null,verdict_at:null},
        principals:v.LABELS.map(label=>({id:f.binding.identities[label],label,ban_at:at(label==='canary'?120:1200),expires_at:at(label==='canary'?180:1800),receipt:label==='canary'&&age>=130,isolated:true})),
        attempts:discovery.attempts.map(a=>({...a,has_nonce:true,first_ban_readback_at:a.operation==='activate'&&age>=130?at(130):null})),
        bans:ticket.plan.scope.known_ids.map(id=>({id,banned_until:id===f.binding.identities.canary&&age<130?null:'2100-01-01T00:00:00.000000Z'}))};
    }
    function snapshot(ticket){const s=rawSnapshot(ticket);if(operatorStage!=='none'){
      const labels=operatorStage==='a-only'?['a']:['a','b'];
      for(const label of labels){const pending=label==='b'&&operatorStage==='b-pending',old=label==='b'&&operatorStage==='b-overdue';s.attempts.push({label,operation:'activate',user_id:pending||old?null:f.binding.identities[label],verified:!pending&&!old,settled:!pending&&!old,has_nonce:true,reserved_at:at(pending?age-1:old?age-11:190),first_ban_readback_at:null});if(!pending&&!old)s.bans.find(x=>x.id===f.binding.identities[label]).banned_until=null;}
    }return s;}
    const lateChild={collector:{ready:async()=>{ready++;return{responseComplete:true};},configure:async()=>({responseComplete:true}),
      command:async c=>{if(c.op==='login'&&c.label!=='canary')operatorLogins[c.label]++;const denied=Boolean(c.op.startsWith('denied_')||c.route?.startsWith('foreign_')||c.route==='provider_connections'&&c.label==='b');return{responseComplete:true,observations:[{label:c.label,user_id:f.binding.identities[c.label],route:c.op==='login'?'login':c.op==='denied_login'?'denied_login':c.route,status:c.op==='denied_login'?400:c.op==='denied_get'?401:denied?403:200,verified:true,denied,at:at(age)}]};},
      authorizeOperators:async e=>{assert.equal(v.reduceEvidence(e.binding,e,{at:base+age*1000,trustedInput:true}).operatorEligible,true);gates++;return{responseComplete:true};},
      abort:async()=>{aborts++;closed=true;}},processEvidence:()=>({processLaunched:false,processClosedObserved:closed,stopConfirmed:closed,actualHelperLaunched:false,publicFakeOnly:true})};
    return{scope,driver,discovery,adopt,snapshot,operatorStage:value=>{operatorStage=value;},operatorLogins:()=>({...operatorLogins}),inputsCleared:()=>prepared.passwords===null&&prepared.client_plan===null,unspentFactsPreserved:()=>prepared.consumed===false&&prepared.max_new_accounts===3,advance:value=>{age=value;discovery.observed_at=at(value);},gateCount:()=>gates,release:()=>release(lateChild),counts:()=>({launches,aborts,ready,closed})};
  }
  const first=await model(),ticket=await first.adopt();
  const launched=await first.driver.complete(ticket,[{snapshot:first.snapshot(ticket)}]);
  assert.equal(launched.stopped,false);assert.equal(launched.taskPending,true);assert.equal(first.counts().launches,1);
  first.driver.requestStop();first.release();await first.driver.stop();
  assert.deepEqual(first.counts(),{launches:1,aborts:1,ready:0,closed:true});assert.equal(first.driver.status().closedProof.processClosedObserved,true);
  const late=await model(),lateTicket=await late.adopt();await late.driver.complete(lateTicket,[{snapshot:late.snapshot(lateTicket)}]);
  const before=Date.now();const stop=await late.driver.stop();assert.ok(Date.now()-before<3000);assert.equal(stop.closedProof,null);
  late.release();await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(late.counts(),{launches:1,aborts:1,ready:0,closed:true});assert.equal(late.driver.status().closedProof.processClosedObserved,true);assert.equal(late.driver.status().stopped,true);
  const denied=await model(),deniedTicket=await denied.adopt(),bad=denied.snapshot(deniedTicket);bad.run.stopped=true;
  const failed=await denied.driver.complete(deniedTicket,[{snapshot:bad}]);assert.equal(failed.stopped,true);assert.equal(denied.counts().launches,0);await denied.driver.stop();assert.equal(denied.inputsCleared(),true);
  const incomplete=await model();incomplete.discovery.attempts=incomplete.discovery.attempts.slice(0,2);
  const waiting=await incomplete.driver.complete(incomplete.driver.begin(),[{snapshot:incomplete.discovery}]);assert.equal(waiting.phase,'DISCOVERY');assert.equal(waiting.stopped,false);assert.equal(incomplete.counts().launches,0);await incomplete.driver.stop();assert.equal(incomplete.inputsCleared(),true);assert.equal(incomplete.unspentFactsPreserved(),true);
  const beforeDiscovery=await model();await beforeDiscovery.driver.stop();assert.equal(beforeDiscovery.inputsCleared(),true);assert.equal(beforeDiscovery.unspentFactsPreserved(),true);assert.equal(beforeDiscovery.counts().launches,0);
  const timedDiscovery=await model(),timedTicket=timedDiscovery.driver.begin();timedDiscovery.advance(37);const timedStatus=await timedDiscovery.driver.complete(timedTicket,[{snapshot:timedDiscovery.discovery}]);assert.equal(timedStatus.stopped,true);assert.equal(timedDiscovery.inputsCleared(),true);assert.equal(timedDiscovery.unspentFactsPreserved(),true);assert.equal(timedDiscovery.counts().launches,0);await timedDiscovery.driver.stop();
  const clockWaitCases=[];
  for(const kind of ['discovery-future55','typed-future55','future201','read-budget','clock-not-advancing','stopped-during-wait']){
    const m=await model();let ticket,s;
    if(kind==='typed-future55')ticket=await m.adopt();else ticket=m.driver.begin();
    // Match the actual connector's JSON DTO boundary, including in Node REPL
    // where structuredClone may return a different realm's Object prototype.
    s=kind==='typed-future55'?m.snapshot(ticket):JSON.parse(JSON.stringify(m.discovery));
    s.observed_at=at(kind==='future201'?30.201:kind==='read-budget'?36.035:30.055);
    const originalObservedAt=s.observed_at;if(kind==='read-budget')m.advance(35.98);
    let timer;if(['discovery-future55','typed-future55','stopped-during-wait'].includes(kind))timer=setTimeout(()=>{m.advance(30.06);if(kind==='stopped-during-wait')m.driver.requestStop();},55);
    let result;try{result=await m.driver.complete(ticket,[{snapshot:s}]);}finally{clearTimeout(timer);}
    assert.equal(s.observed_at,originalObservedAt);
    if(['discovery-future55','typed-future55'].includes(kind)){
      if(result.stopped){const e=Error('PUBLIC_CLOCK_WAIT_FAILED');e.publicClockCase=kind;e.publicClockCode=result.clockWait?.code;e.publicClockElapsed=result.clockWait?.elapsedMs;e.publicClockFailure=result.controlFailure?.code;throw e;}
      assert.equal(result.stopped,false);assert.equal(result.clockWait.code,'PAST_VERIFIED');assert.equal(result.clockWait.originalObservedAt,originalObservedAt);assert.equal(result.clockWait.requestedMs,57);
      if(kind==='typed-future55'){assert.equal(result.lastDbObservedAt,originalObservedAt);m.driver.requestStop();m.release();}
    }else{assert.equal(result.stopped,true);assert.equal(m.counts().launches,0);if(kind!=='stopped-during-wait')assert.notEqual(result.clockWait.code,'PAST_VERIFIED');}
    await m.driver.stop();clockWaitCases.push({kind,result:kind==='discovery-future55'||kind==='typed-future55'?'REAL_WAIT_ORIGINAL_TIMESTAMP':'DENY_NO_FACTORY',originalTimestampUnchanged:true});
  }
  const bindingReceiptTiming=[];
  for(const kind of ['ontime-observed-after60','late-action','late-discovery','late-full-read','pending-after60']){
    const m=await model();m.advance(kind==='late-discovery'?73:61);
    if(kind==='late-action')m.discovery.attempts.at(-1).reserved_at=at(60.1);
    if(kind==='pending-after60')m.discovery.attempts.at(-1).settled=false;
    let discoveryTicket;
    if(kind==='ontime-observed-after60'){m.discovery.attempts.at(-1).reserved_at=at(54);m.advance(55);discoveryTicket=m.driver.begin();m.advance(61);m.discovery.observed_at=at(55);}
    else discoveryTicket=m.driver.begin();
    let s=await m.driver.complete(discoveryTicket,[{snapshot:m.discovery}]);
    if(['ontime-observed-after60','late-full-read'].includes(kind)){assert.equal(s.stopped,false);m.advance(kind==='late-full-read'?73:64);const t=m.driver.begin();s=await m.driver.complete(t,[{snapshot:m.snapshot(t)}]);}
    if(kind==='ontime-observed-after60'){assert.equal(s.stopped,false);assert.equal(m.counts().launches,1);m.driver.requestStop();m.release();await m.driver.stop();}
    else{assert.equal(s.stopped,true);assert.equal(m.counts().launches,0);await m.driver.stop();}
    bindingReceiptTiming.push({kind,result:kind==='ontime-observed-after60'?'BIND_WITH_ORIGINAL_ACTION_WINDOWS':'DENY_NO_FACTORY'});
  }
  const publicData=publicFixture(),authScope={run_id:publicData.binding.run_id,authorization_id:publicData.binding.authorization_id};
  const noGo={publicOnly:true,moduleRoot:ROOT,prepared:{trustedOwnerReceiptVerified:false,trustedSourceAcceptanceVerified:true,source_sha:'c3df8f020379acc7054fb6b6deb01c8a7250f7a6',accepted_source_sha:'c3df8f020379acc7054fb6b6deb01c8a7250f7a6',...authScope,max_new_accounts:3,public_go:false,consumed:false,passwords:Object.fromEntries(v.LABELS.map(label=>[label,publicData.config.plan.principals[label].password]))},wall:()=>base+30000,monotonic:()=>0,factory:()=>{throw Error('Public factory must not run');}};
  await assert.rejects(()=>installFillNode(authScope,noGo),/FILL09_REJECTED/);assert.equal(noGo.prepared.passwords,null);assert.equal(noGo.prepared.client_plan,null);assert.equal(noGo.prepared.consumed,false);
  noGo.prepared.passwords=Object.fromEntries(v.LABELS.map(label=>[label,publicData.config.plan.principals[label].password]));noGo.prepared.trustedOwnerReceiptVerified=true;noGo.prepared.consumed=true;await assert.rejects(()=>installFillNode(authScope,noGo),/FILL09_REJECTED/);assert.equal(noGo.prepared.passwords,null);assert.equal(noGo.prepared.client_plan,null);assert.equal(noGo.prepared.consumed,true);
  const waits=[];
  for(const kind of ['no-activation','pending-activation','unknown-create']){
    const m=await model();
    if(kind==='no-activation')m.discovery.attempts=m.discovery.attempts.filter(a=>a.operation==='create');
    if(kind==='pending-activation'){const a=m.discovery.attempts.at(-1);a.verified=false;a.settled=false;a.reserved_at=at(29);}
    if(kind==='unknown-create'){const a=m.discovery.attempts[0];a.verified=false;a.user_id=null;a.reserved_at=at(29);}
    const result=await m.driver.complete(m.driver.begin(),[{snapshot:m.discovery}]);assert.equal(result.stopped,false);assert.equal(result.discovery,true);assert.equal(result.positiveReady,false);assert.equal(m.counts().launches,0);waits.push(kind);await m.driver.stop();
  }
  const guardWait=await model(),guardTicket=await guardWait.adopt(),withoutHealth=guardWait.snapshot(guardTicket);withoutHealth.run.healthy_at=null;
  const waitingGuard=await guardWait.driver.complete(guardTicket,[{snapshot:withoutHealth}]);assert.equal(waitingGuard.stopped,false);assert.equal(waitingGuard.positiveReady,false);assert.equal(guardWait.counts().launches,0);
  guardWait.advance(33);const healthyTicket=guardWait.driver.begin();await guardWait.driver.complete(healthyTicket,[{snapshot:guardWait.snapshot(healthyTicket)}]);assert.equal(guardWait.counts().launches,1);guardWait.driver.requestStop();guardWait.release();await guardWait.driver.stop();waits.push('missing-guard-until-healthy');
  const chronology=[];
  for(const scenario of ['json-first','reverse','future-decision','future-canonical','expired','lease-mismatch','proof-mismatch','reference-mismatch','before180']) {
    const m=await model(),firstTicket=await m.adopt();await m.driver.complete(firstTicket,[{snapshot:m.snapshot(firstTicket)}]);m.release();await new Promise(r=>setTimeout(r,0));
    let canaryProof;
    for(let age=33;age<=189;age+=3) {
      m.advance(age);const ticket=m.driver.begin(),s=await m.driver.complete(ticket,[{snapshot:m.snapshot(ticket)}]);
      assert.equal(s.stopped,false,scenario+' aborted before root gate at'+age);if(s.canaryRequest)canaryProof=s.canaryRequest.proof;
      await new Promise(r=>setTimeout(r,0));
    }
    assert.ok(canaryProof);
    m.advance(192);m.operatorStage('both');const ticket=m.driver.begin(),snapshot=m.snapshot(ticket),reference='https://github.com/erikkaniss-ai/fillmycourt/pull/8#issuecomment-123';
    Object.assign(snapshot.intent,{verdict_decision:'pass',verdict_run_id:m.scope.run_id,verdict_candidate_sha:v.CANDIDATE,verdict_positive_get:true,verdict_denied_login:true,verdict_denied_api:true,verdict_lease_matches_spec:true,verdict_evidence_ref:reference,verdict_at:at(scenario==='future-canonical'?194:191)});
    const e=structuredClone(canaryProof);e.independent={binding:e.binding,source:'cto_checkpoint',decision:'pass',lease_digest:'a'.repeat(64),evidence_ref:reference,at:at(190),expires_at:at(590)};
    if(scenario==='reverse')e.independent.at=at(191.5);
    if(scenario==='future-decision')e.independent.at=at(194);
    if(scenario==='expired')e.independent.expires_at=at(191.5);
    if(scenario==='lease-mismatch')e.independent.lease_digest='b'.repeat(64);
    if(scenario==='proof-mismatch')e.canary.positive[0].status=201;
    if(scenario==='reference-mismatch')e.independent.evidence_ref=reference+'4';
    if(scenario==='before180')e.independent.at=at(179);
    assert.notEqual(e.independent.at,snapshot.intent.verdict_at); // Old equality would reject the valid JSON-first case.
    await m.driver.complete(ticket,[{snapshot}]);
    const gate=await m.driver.acceptRootReceipt({body:JSON.stringify({kind:'FILL_F1_ROOT_CANARY_PASS_V1',evidence:e}),html_url:reference,author_login:'erikkaniss-ai'});await new Promise(r=>setTimeout(r,0));
    assert.equal(m.gateCount(),scenario==='json-first'?1:0,scenario);assert.equal(gate.stopped,scenario!=='json-first',scenario);
    chronology.push({scenario,result:scenario==='json-first'?'PASS':'DENY',gateCalls:m.gateCount()});await m.driver.stop();
  }
  const operatorReadiness=[];
  for(const scenario of ['staggered-ready','overdue-pending']){
    const m=await model(),firstTicket=await m.adopt();await m.driver.complete(firstTicket,[{snapshot:m.snapshot(firstTicket)}]);m.release();await new Promise(r=>setTimeout(r,0));let canaryProof;
    for(let age=33;age<=189;age+=3){m.advance(age);const t=m.driver.begin(),s=await m.driver.complete(t,[{snapshot:m.snapshot(t)}]);assert.equal(s.stopped,false);if(s.canaryRequest)canaryProof=s.canaryRequest.proof;await new Promise(r=>setTimeout(r,0));}
    const reference='https://github.com/erikkaniss-ai/fillmycourt/pull/8#issuecomment-123';
    const passSnapshot=t=>{const s=m.snapshot(t);Object.assign(s.intent,{verdict_decision:'pass',verdict_run_id:m.scope.run_id,verdict_candidate_sha:v.CANDIDATE,verdict_positive_get:true,verdict_denied_login:true,verdict_denied_api:true,verdict_lease_matches_spec:true,verdict_evidence_ref:reference,verdict_at:at(191)});return s;};
    m.advance(192);let t=m.driver.begin();await m.driver.complete(t,[{snapshot:passSnapshot(t)}]);const e=structuredClone(canaryProof);e.independent={binding:e.binding,source:'cto_checkpoint',decision:'pass',lease_digest:'a'.repeat(64),evidence_ref:reference,at:at(190),expires_at:at(590)};
    let s=await m.driver.acceptRootReceipt({body:JSON.stringify({kind:'FILL_F1_ROOT_CANARY_PASS_V1',evidence:e}),html_url:reference,author_login:'erikkaniss-ai'});assert.equal(s.phase,'WAIT_OPERATORS');assert.equal(m.gateCount(),0);assert.deepEqual(m.operatorLogins(),{a:0,b:0});
    m.operatorStage('a-only');m.advance(195);t=m.driver.begin();s=await m.driver.complete(t,[{snapshot:passSnapshot(t)}]);assert.equal(s.stopped,false);assert.equal(m.gateCount(),0);assert.deepEqual(m.operatorLogins(),{a:0,b:0});const previousPermit=s.lastPermitDbObservedAt;
    m.operatorStage(scenario==='staggered-ready'?'b-pending':'b-overdue');m.advance(198);t=m.driver.begin();s=await m.driver.complete(t,[{snapshot:passSnapshot(t)}]);assert.equal(m.gateCount(),0);assert.deepEqual(m.operatorLogins(),{a:0,b:0});
    if(scenario==='overdue-pending'){assert.equal(s.stopped,true);operatorReadiness.push({scenario,result:'DENY_NO_GATE_OR_LOGIN'});await m.driver.stop();continue;}
    assert.equal(s.stopped,false);assert.equal(s.operatorAdmissionWaiting,true);assert.equal(s.lastPermitDbObservedAt,previousPermit); // No fake ALLOW or timestamp refresh.
    m.operatorStage('both');
    for(let age=201;age<=285;age+=3){m.advance(age);t=m.driver.begin();s=await m.driver.complete(t,[{snapshot:passSnapshot(t)}]);await new Promise(r=>setTimeout(r,0));if(s.stopped)break;}
    assert.equal(m.gateCount(),1);assert.deepEqual(m.operatorLogins(),{a:1,b:1});assert.equal(s.outcome,'READS_COMPLETE');await m.driver.stop();operatorReadiness.push({scenario,result:'ONE_GATE_ONE_LOGIN_EACH',missingAndPendingNoEarlyUse:true,originalWindowPreserved:true});
  }
  return{actualControllerOffline:'PASS',modelDate:'2030-01-01',discoveryToFirstCanonical:'PASS',noLaunchBeforeSnapshot:true,firstCanonicalDenyNoLaunch:true,operatorReadiness,bindingReceiptTiming,clockWaitCases,
    stopDuringFactory:'PASS',factoryAfterFinalStop:'PASS',lateFakeChildrenAborted:2,lateReadyCalls:0,lateCloseObserved:2,incompleteDiscoveryNoLaunch:true,missingRealGoRejected:true,consumedAuthorityRejected:true,
    earlyInputReferencesCleared:['before-discovery-stop','incomplete-discovery-stop','discovery-read-timeout','canonical-deny-before-factory','invalid-authority','consumed-authority'],budgetFactsUnchanged:true,
    preReadyWaitNoFactory:waits,rootPublicationChronology:chronology,realNetworkCalls:0,actualProcessLaunches:0,grantsOwnerGo:false};
}
