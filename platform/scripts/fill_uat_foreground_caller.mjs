// Canonical V8 caller and Node host; import performs no I/O.
import { installFillNode } from './fill_uat_foreground_controller.mjs';
export const CTO = '01a18ac7-4188-7b50-9c7e-4287626118c9';
export const STARTUP_RPC_MS=10000, ACTIVE_RPC_MS=2000, PREPARED_TTL_MS=300000;
const RPC_CODES=new Set(['RPC_TIMEOUT','READ_TIMEOUT','RPC_REMOTE_FAILED','RPC_BAD_ENVELOPE','PREPARE_MISSING','PREPARE_EXPIRED','PREPARE_CLOSED','SCOPE_MISMATCH','NOT_ARMED','CONTROL_FAILED','ABORTED']);
const RPC_STAGES=new Set(['PREPARE_INSTALL','PREPARE_LOOKUP','ARM','BEGIN','COMPLETE','ROOT_RECEIPT','STOP','DIAGNOSTIC_COMPLETE']);
export class SafeRpcError extends Error {
  constructor(code,stage){super('Fill control boundary rejected.');this.code=RPC_CODES.has(code)?code:'CONTROL_FAILED';this.stage=RPC_STAGES.has(stage)?stage:'STOP';}
}
export class ControlRpc {
  constructor(tools,{wall=Date.now,startupMs=STARTUP_RPC_MS,activeMs=ACTIVE_RPC_MS,signal=null}={}) {
    if(startupMs>10000||startupMs<1||activeMs>2000||activeMs<1)throw new SafeRpcError('CONTROL_FAILED','PREPARE_INSTALL');
    this.tools=tools;this.wall=wall;this.startupMs=startupMs;this.activeMs=activeMs;this.signal=signal;this.closed=false;this.records=[];this.pending=new Set();this.lateClosed=0;
  }
  async request(stage,code,{startup=false,lateClose}={}) {
    if(this.closed&&stage!=='STOP')throw new SafeRpcError('PREPARE_CLOSED',stage);
    if(!RPC_STAGES.has(stage))throw new SafeRpcError('CONTROL_FAILED','STOP');
    const start=this.wall(),limit=startup?this.startupMs:this.activeMs,signal=stage==='STOP'?null:this.signal;let timer,expired=false,abort;
    if(signal?.aborted){this.closed=true;this.records.push({stage,durationMs:0,code:'ABORTED',startup});throw new SafeRpcError('ABORTED',stage);}
    const record={stage,durationMs:0,code:'PENDING',startup,dispatchedAt:start,deadlineAt:start+limit,settledAt:null,nodeExecutionMs:null,lateSettlement:false};this.records.push(record);
    const operation=Promise.resolve().then(()=>this.tools.mcp__node_repl__js({code,title:'Fill bounded control RPC'}));
    // Only finite timing survives. Never retain tool arguments, raw response,
    // exception text, config or credentials. Timeout is NOT cancellation.
    const settle=raw=>{record.settledAt=this.wall();record.lateSettlement=expired;const n=raw?._meta?.['codex/nodeReplExecutionDurationMs'];if(typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=60000)record.nodeExecutionMs=n;
      try{if(stage==='COMPLETE'){const value=unwrap(raw),trace=value?.readTrace;for(const key of ['nodeEntryAt','nodeReturnAt','nodeElapsedMs']){const d=Object.getOwnPropertyDescriptor(trace??{},key);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='number'&&Number.isFinite(d.value)&&d.value>=0)record[key]=d.value;}}}catch{}
    };
    const owned=operation.then(async raw=>{settle(raw);if(expired&&lateClose){try{await lateClose(raw);this.lateClosed++;}catch{}}},()=>{settle(null);});
    this.pending.add(owned);owned.finally(()=>this.pending.delete(owned));
    try {
      const raw=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;this.closed=true;reject(new SafeRpcError('RPC_TIMEOUT',stage));},limit);abort=()=>{expired=true;this.closed=true;reject(new SafeRpcError('ABORTED',stage));};signal?.addEventListener('abort',abort,{once:true});})]);
      let value;try{if(raw?.isError===true)throw 0;value=unwrap(raw);}catch{throw new SafeRpcError('RPC_BAD_ENVELOPE',stage);}
      Object.assign(record,{durationMs:this.wall()-start,code:'PASS'});return value;
    }catch(error){this.closed=true;const safe=error instanceof SafeRpcError?error:new SafeRpcError('RPC_REMOTE_FAILED',stage);Object.assign(record,{durationMs:this.wall()-start,code:safe.code});throw safe;}
    finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);if(!expired){await owned;this.pending.delete(owned);}}
  }
  async drain(ms=11000){let timer;try{await Promise.race([Promise.allSettled([...this.pending]),new Promise(r=>{timer=setTimeout(r,ms);})]);}finally{clearTimeout(timer);}return{pending:this.pending.size,lateClosed:this.lateClosed,closed:this.closed,records:this.records};}
}

// HARD READONLY host install: no private envelope, authority or factory import/
// call. Preparation is NOT an owner permit. Diagnostic scope is closed-run only.
export async function installFillHost(input) {
  const root='file:///C:/Users/Thinkpad%20X1%20Gen7/.codex/.chatgpt-projects/g-p-6a942edc77308191bf006821104fda8c/fillmycourt-operator-mvp/';
  const b=await import(root+'platform/scripts/fill_uat_checkpoint_bridge.mjs');
  const v=await import(root+'platform/scripts/fill_uat_evidence_verdict.mjs');
  v.exact(input,['prepare_id','install_deadline_at','expires_at','diagnostic_scope']);
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(input.prepare_id)||!Number.isFinite(input.install_deadline_at)||input.install_deadline_at>Date.now()+10000||!Number.isFinite(input.expires_at)||input.expires_at>Date.now()+300000||input.expires_at<input.install_deadline_at)throw Error('FILL10_HOST_REJECTED');
  const preparedAt=Date.now();
  let closed=Date.now()>input.install_deadline_at,armed=false,controller=null,armScope=null,timer,activeCutoff=null;
  let plan=null,cache=null,sequence=0,last=null;
  // The one permitted closed16 probe is consumed. Never turn its obsolete
  // query/hash into a new diagnostic authorization after CONTROL-12.
  if(input.diagnostic_scope!==null)throw Error('FILL12_DIAGNOSTIC_CONSUMED');
  const stop=async()=>{closed=true;clearTimeout(timer);cache?.stop();const controllerState=controller?await controller.stop():null;return{prepare_id:input.prepare_id,closed,armed,ownedTimers:0,controller:controllerState,cache:cache?.snapshot??null,grantsOwnerGo:false};};
  if(!closed)timer=setTimeout(()=>{void stop();},Math.max(1,input.expires_at-Date.now()));
  return {
    receipt(){return{protocol:10,prepare_id:input.prepare_id,prepared_at:preparedAt,expires_at:input.expires_at,closed,armed,mode:plan?'READONLY_CLOSED_DIAGNOSTIC':'NO_AUTHORITY_HOST',query:plan,grantsOwnerGo:false};},
    lookup(id){if(closed||id!==input.prepare_id||Date.now()>=input.expires_at)throw Error('FILL10_HOST_REJECTED');return this.receipt();},
    // Called only BEFORE a future intent/release. installFillNode still requires
    // genuine fresh private owner authority; this host receipt supplies none.
    async arm(id,scope,installer){
      if(plan||closed||armed||id!==input.prepare_id||Date.now()>=input.expires_at)throw Error('FILL10_HOST_REJECTED');
      const value=await installer(scope);
      if(closed||Date.now()>=input.expires_at){await value.stop();throw Error('FILL10_HOST_REJECTED');}
      controller=value;armScope=JSON.stringify(scope);armed=true;
      return{...this.receipt(),scope,live_ready:true,pre_t0:true};
    },
    live(id,scope){
      if(closed||!armed||id!==input.prepare_id||JSON.stringify(scope)!==armScope)throw Error('FILL10_HOST_REJECTED');
      const state=controller.status();
      if(!state.discovery&&!state.stopped){
        if(activeCutoff!==null&&activeCutoff!==state.cutoff){void stop();throw Error('FILL10_HOST_REJECTED');}
        if(activeCutoff===null){activeCutoff=state.cutoff;clearTimeout(timer);timer=setTimeout(()=>{void stop();},Math.max(1,activeCutoff-Date.now()));}
      }
      if(Date.now()>=(activeCutoff??input.expires_at)){void stop();throw Error('FILL10_HOST_REJECTED');}
      return controller;
    },
    async diagnosticComplete(raw,provenance,timing){
      if(closed||armed||!plan||Date.now()>=input.expires_at||!Number.isFinite(timing.readDurationMs)||timing.readDurationMs<0||timing.readDurationMs>6000)throw Error('FILL10_HOST_REJECTED');
      last=b.assembleCheckpoint(plan,raw,provenance,null,Date.now());if(last.decision!=='DENY'||last.permit!==null||last.grantsOwnerGo!==false)throw Error('FILL10_HOST_REJECTED');
      cache.install({sequence:++sequence,state:last});return{state:last,cache:cache.snapshot,readDurationMs:timing.readDurationMs,grantsOwnerGo:false};
    },stop
  };
}

export async function prepareFillForeground(tools,{prepare_id,diagnostic_scope=null},rpc=new ControlRpc(tools)) {
  const now=rpc.wall(),input={prepare_id,diagnostic_scope,install_deadline_at:now+rpc.startupMs,expires_at:now+(diagnostic_scope?60000:300000)};
  const close=()=>{rpc.closed=true;return rpc.request('STOP',`var target=typeof fill10Hosts==='undefined'?null:fill10Hosts.get(${JSON.stringify(prepare_id)});nodeRepl.write(JSON.stringify(target?await target.stop():{closed:true,notInstalled:true,grantsOwnerGo:false}));`,{startup:true});};
  try {
    const receipt=await rpc.request('PREPARE_INSTALL',`var fill10Hosts=typeof fill10Hosts==='undefined'?new Map():fill10Hosts;var fill10Host=await (${installFillHost.toString()})(${JSON.stringify(input)});fill10Hosts.set(${JSON.stringify(prepare_id)},fill10Host);nodeRepl.write(JSON.stringify(fill10Host.receipt()));`,{startup:true,lateClose:close});
    const keys=['protocol','prepare_id','prepared_at','expires_at','closed','armed','mode','query','grantsOwnerGo'];
    if(!receipt||Object.keys(receipt).sort().join(',')!==keys.sort().join(',')||receipt.protocol!==10||receipt.prepare_id!==prepare_id||receipt.grantsOwnerGo!==false||receipt.armed!==false||!Number.isFinite(receipt.prepared_at)||!Number.isFinite(receipt.expires_at))throw new SafeRpcError('RPC_BAD_ENVELOPE','PREPARE_INSTALL');
    if(receipt.closed||rpc.wall()>=receipt.expires_at)throw new SafeRpcError('PREPARE_CLOSED','PREPARE_INSTALL');
    const lookup=await rpc.request('PREPARE_LOOKUP',`nodeRepl.write(JSON.stringify(fill10Hosts.get(${JSON.stringify(prepare_id)}).lookup(${JSON.stringify(prepare_id)})));`,{startup:true});
    if(lookup.prepare_id!==receipt.prepare_id||lookup.prepared_at!==receipt.prepared_at||lookup.expires_at!==receipt.expires_at||lookup.closed)throw new SafeRpcError('PREPARE_CLOSED','PREPARE_LOOKUP');
    return{receipt,rpc,close};
  }catch(error){rpc.closed=true;try{await close();}catch{}throw error instanceof SafeRpcError?error:new SafeRpcError('CONTROL_FAILED','PREPARE_INSTALL');}
}

export async function armFillForeground(prepared,scope) {
  try {
    if(!prepared?.receipt||!prepared.rpc||prepared.rpc.closed)throw new SafeRpcError('PREPARE_MISSING','ARM');
    const {receipt,rpc}=prepared;
    if(receipt.closed||receipt.armed||receipt.mode!=='NO_AUTHORITY_HOST')throw new SafeRpcError('NOT_ARMED','ARM');
    if(rpc.wall()>=receipt.expires_at)throw new SafeRpcError('PREPARE_EXPIRED','ARM');
    const ready=await rpc.request('ARM',`var fill10Host=fill10Hosts.get(${JSON.stringify(receipt.prepare_id)});var fill10ArmedReceipt=await fill10Host.arm(${JSON.stringify(receipt.prepare_id)},${JSON.stringify(scope)},${installFillNode.toString()});nodeRepl.write(JSON.stringify(fill10ArmedReceipt));`,{startup:true,lateClose:prepared.close});
    const keys=['protocol','prepare_id','prepared_at','expires_at','closed','armed','mode','query','grantsOwnerGo','scope','live_ready','pre_t0'];
    if(!ready||Object.keys(ready).sort().join(',')!==keys.sort().join(',')||ready.protocol!==10||ready.prepare_id!==receipt.prepare_id||ready.prepared_at!==receipt.prepared_at||ready.expires_at!==receipt.expires_at||ready.closed!==false||ready.armed!==true||ready.mode!=='NO_AUTHORITY_HOST'||ready.query!==null||ready.grantsOwnerGo!==false||ready.live_ready!==true||ready.pre_t0!==true)throw new SafeRpcError('RPC_BAD_ENVELOPE','ARM');
    if(JSON.stringify(ready.scope)!==JSON.stringify(scope))throw new SafeRpcError('SCOPE_MISMATCH','ARM');
    // Scheduling prerequisite only: no independent canonical T0/GO assertion.
    const status=await rpc.request('PREPARE_LOOKUP',`nodeRepl.write(JSON.stringify(fill10Hosts.get(${JSON.stringify(receipt.prepare_id)}).live(${JSON.stringify(receipt.prepare_id)},${JSON.stringify(scope)}).status()));`,{startup:true});
    if(status?.stopped!==false||status.discovery!==true||status.offlinePublicData!==false||status.grantsOwnerGo!==false)throw new SafeRpcError('RPC_BAD_ENVELOPE','PREPARE_LOOKUP');
    if(rpc.wall()>=ready.expires_at)throw new SafeRpcError('PREPARE_EXPIRED','ARM');
    return{...prepared,ready,scope};
  } catch(error) {
    const safe=error instanceof SafeRpcError?error:new SafeRpcError('CONTROL_FAILED','ARM');
    safe.cleanup={attempted:typeof prepared?.close==='function',closed:false,code:null};
    if(prepared?.rpc)prepared.rpc.closed=true;
    if(safe.cleanup.attempted){try{const result=await prepared.close();safe.cleanup.closed=result?.closed===true;if(!safe.cleanup.closed)safe.cleanup.code='CONTROL_FAILED';}catch(e){safe.cleanup.code=e instanceof SafeRpcError?e.code:'CONTROL_FAILED';}}
    throw safe;
  }
}

function unwrap(result) {
  let v=result;
  for(let n=0;n<12;n++) {
    if(typeof v==='string'){v=JSON.parse(v);continue;}
    if(v?.structuredContent?.content!==undefined){v=v.structuredContent.content;continue;}
    if(v?.content?.length===1&&v.content[0].type==='text'){v=v.content[0].text;continue;}
    return v;
  }
  throw Error('FILL09_ENVELOPE');
}
async function bounded(promise,ms) {let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new SafeRpcError('READ_TIMEOUT','COMPLETE')),ms);})]);}finally{clearTimeout(timer);}}

export async function runFillForeground(tools, scope, prepared, io={wall:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))}) {
  // Functions.exec owns and awaits this entire scope. Never detach this call.
  // Only public run/auth IDs cross here; no passwords/Admin keys in this file.
  if(!prepared?.ready?.live_ready||!prepared.ready.pre_t0||!prepared.rpc)throw new SafeRpcError('PREPARE_MISSING','BEGIN');
  if(JSON.stringify(prepared.scope)!==JSON.stringify(scope))throw new SafeRpcError('SCOPE_MISMATCH','BEGIN');
  if(prepared.rpc.closed||io.wall()>=prepared.ready.expires_at)throw new SafeRpcError('PREPARE_EXPIRED','BEGIN');
  if(typeof io.stopJournal!=='function')throw new SafeRpcError('CONTROL_FAILED','STOP');
  const rpc=prepared.rpc,ref=`fill10Hosts.get(${JSON.stringify(prepared.ready.prepare_id)}).live(${JSON.stringify(prepared.ready.prepare_id)},${JSON.stringify(scope)})`;
  const node=(stage,code)=>rpc.request(stage,code);
  const jobs=new Set(); let state, failure=null,lastStart=-Infinity, decisionPending=null, decisionConsumed=false, notifyPending=null,journalStop=null;
  function own(p){jobs.add(p);p.then(()=>jobs.delete(p),()=>jobs.delete(p));return p;}
  try {
    // No INSTALL or ownership lookup after release. Both were completed in
    // prepare+arm before intent/T0; every active method uses the same host ID.
    while(true) {
      const delay=Math.max(0,lastStart+2500-io.wall()); if(delay)await io.sleep(delay); lastStart=io.wall();
      const ticket=await node('BEGIN',`nodeRepl.write(JSON.stringify(${ref}.begin()));`);
      let raw;
      try {
        const p=ticket.discovery?ticket:ticket.plan;
        // THE actual supported MCP read. Deliberately OUTSIDE Node callbacks.
        raw=await bounded(tools.mcp__codex_apps__supabase_execute_sql({project_id:p.project_id,query:p.query}),6000);
        // The host already owns its plan/query. Return only the operation key,
        // not another copy of the SQL/plan on the 2s critical RPC path.
        const completion=ticket.discovery?{discovery:true}:{sequence:ticket.sequence,...(ticket.cleanupOnly?{cleanupOnly:true}:{})};
        state=await node('COMPLETE',`nodeRepl.write(JSON.stringify(await ${ref}.complete(${JSON.stringify(completion)},${JSON.stringify(raw)})));`);
      } catch(error) {failure={code:error instanceof SafeRpcError?error.code:'CONTROL_FAILED',stage:error instanceof SafeRpcError?error.stage:'COMPLETE'};rpc.closed=true;state=await node('STOP',`nodeRepl.write(JSON.stringify(${ref}.requestStop()));`);break;}
      // Root send/fetch waits are owned concurrently, so they NEVER pause the
      // canonical read cadence. No model turn is needed while CTO is pending.
      if(state.canaryRequest&&!notifyPending) {
        notifyPending=own(tools.mcp__codex_app__send_message_to_thread({threadId:CTO,prompt:JSON.stringify({kind:'FILL_F1_CANARY_REVIEW_REQUIRED',source_sha:state.source_sha,...state.canaryRequest})}));
        notifyPending.catch(()=>{});
      }
      if(state.rootEvidenceRef&&!decisionPending&&!decisionConsumed) {
        const match=/^https:\/\/github\.com\/erikkaniss-ai\/fillmycourt\/pull\/8#issuecomment-([0-9]+)$/.exec(state.rootEvidenceRef);
        if(!match)throw new SafeRpcError('CONTROL_FAILED','ROOT_RECEIPT');
        const slot={done:false,result:null,error:false}; decisionPending=slot;
        own(bounded(tools.mcp__codex_apps__github_fetch({url:'https://api.github.com/repos/erikkaniss-ai/fillmycourt/issues/comments/'+match[1]}),2000)).then(r=>{const c=unwrap(r);slot.result={body:c.body,html_url:c.html_url,author_login:c.user?.login};slot.done=true;},()=>{slot.error=true;slot.done=true;});
      }
      if(decisionPending?.done) {
        if(decisionPending.error)throw new SafeRpcError('RPC_REMOTE_FAILED','ROOT_RECEIPT');
        state=await node('ROOT_RECEIPT',`nodeRepl.write(JSON.stringify(await ${ref}.acceptRootReceipt(${JSON.stringify(decisionPending.result)})));`); decisionPending=null; decisionConsumed=true;
      }
      if(state.cleanupRequest) {
        journalStop=await io.stopJournal();
        if(journalStop?.confirmed!==true){failure={code:'CONTROL_FAILED',stage:'STOP'};break;}
      }
      // Readiness09 does not invoke this driver. For eventual runtime, helper
      // activity stops on any failure; cleanup observations remain readonly.
      if((state.stopped&&(state.cleanup==='PASS'||state.discovery)) || io.wall()>=state.cutoff) break;
    }
  }catch(error){failure??={code:error instanceof SafeRpcError?error.code:'CONTROL_FAILED',stage:error instanceof SafeRpcError?error.stage:'BEGIN'};rpc.closed=true;}
  finally {
    if(!journalStop){try{journalStop=await io.stopJournal();if(journalStop?.confirmed!==true)failure??={code:'CONTROL_FAILED',stage:'STOP'};}catch{failure??={code:'CONTROL_FAILED',stage:'STOP'};}}
    try {state=await rpc.request('STOP',`nodeRepl.write(JSON.stringify(await fill10Hosts.get(${JSON.stringify(prepared.ready.prepare_id)}).stop()));`,{startup:true});}catch{failure??={code:'RPC_REMOTE_FAILED',stage:'STOP'};}
    // Tool RPC cancellation is unavailable; bounded wait is NOT cancellation.
    // No late readonly response can reopen the closed cache/owned child.
    await Promise.race([Promise.allSettled([...jobs]),io.sleep(500)]);
  }
  return{state,failure,journalStop,rpc:await rpc.drain(500)};
}
