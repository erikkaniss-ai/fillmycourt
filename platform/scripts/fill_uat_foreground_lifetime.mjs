// One awaited caller lifetime. No Auth/SQL/secret/process implementation here.
// Callbacks and ControlRpc are trusted in-memory dependencies, not serialized
// receipts. Execute prepare -> arm/lookup -> admit -> foreground in ONE exec;
// never put a prepared object in store or reconstruct its methods in another.
const STAGES = new Set(['PREPARE', 'ARM', 'ADMISSION', 'FOREGROUND', 'STOP', 'CLOSE']);
const CODES = new Set(['INVALID_LIFETIME', 'PREPARE_FAILED', 'ARM_FAILED', 'ADMISSION_FAILED', 'ADMISSION_TIMEOUT', 'FOREGROUND_FAILED', 'STOP_FAILED', 'CLOSE_FAILED', 'PENDING_OWNERSHIP']);
const RPC_CODES = new Set(['RPC_TIMEOUT','READ_TIMEOUT','RPC_REMOTE_FAILED','RPC_BAD_ENVELOPE','PREPARE_MISSING','PREPARE_EXPIRED','PREPARE_CLOSED','SCOPE_MISMATCH','NOT_ARMED','CONTROL_FAILED','ABORTED']);
const RPC_STAGES = new Set(['PREPARE_INSTALL','PREPARE_LOOKUP','ARM','BEGIN','COMPLETE','ROOT_RECEIPT','STOP','DIAGNOSTIC_COMPLETE']);
export class LifetimeError extends Error {
  constructor(code, stage) { super('Fill foreground lifetime rejected.'); this.code = CODES.has(code) ? code : 'INVALID_LIFETIME'; this.stage = STAGES.has(stage) ? stage : 'CLOSE'; }
}

export async function runFillLifetime({ scope, rpc, prepare, arm, admit, run, stop, wall = Date.now, sleep = ms => new Promise(r => setTimeout(r,ms)), admissionMs = 300000, drainMs = 11000 }) {
  let prepared, armed, result = null, failure = null, closed = null, stage = 'PREPARE', admissionOwned, admissionSettled = true, admissionTimer;
  let admissionOpen=false,enteredAdmission=false,absoluteDeadlineAt=null,releaseCutoffAt=null,stopTask,journalStop=null;
  const stopJournal=()=>stopTask??=Promise.resolve().then(()=>stop({releaseCutoffAt,reason:failure?.code??result?.failure?.code??'READS_DONE'}));
  const check = (ok, code = 'INVALID_LIFETIME') => { if (!ok) throw new LifetimeError(code, stage); };
  const safe = error => {
    if(error instanceof LifetimeError)return {code:error.code,stage:error.stage};
    const failure={code:({PREPARE:'PREPARE_FAILED',ARM:'ARM_FAILED',ADMISSION:'ADMISSION_FAILED',FOREGROUND:'FOREGROUND_FAILED',CLOSE:'CLOSE_FAILED'})[stage],stage};
    try {const code=Object.getOwnPropertyDescriptor(error,'code')?.value,rpcStage=Object.getOwnPropertyDescriptor(error,'stage')?.value;if(RPC_CODES.has(code)&&RPC_STAGES.has(rpcStage))failure.rpc={code,stage:rpcStage};}catch{}
    return failure;
  };
  try {
    check(scope && /^[0-9a-f-]{36}$/.test(scope.run_id) && /^[0-9a-f-]{36}$/.test(scope.authorization_id));
    check(rpc && typeof rpc.request === 'function' && typeof rpc.drain === 'function' && [prepare, arm, admit, run, stop, wall, sleep].every(f => typeof f === 'function'));
    check(Number.isFinite(admissionMs) && admissionMs > 0 && admissionMs <= 300000 && Number.isFinite(drainMs) && drainMs > 0 && drainMs <= 11000);
    prepared = await prepare();
    check(prepared?.rpc === rpc && typeof prepared.close === 'function' && !rpc.closed, 'PREPARE_FAILED');
    stage = 'ARM'; armed = await arm(prepared);
    check(armed?.rpc === rpc && armed.ready?.live_ready === true && armed.ready.pre_t0 === true &&
      armed.ready.grantsOwnerGo === false && JSON.stringify(armed.scope) === JSON.stringify(scope) && !rpc.closed, 'ARM_FAILED');
    // Caller scheduling prerequisite only. This is NOT independent proof of
    // canonical T0 absence or GO. Genuine owner preflight + canonical admission
    // must be performed by the existing trusted caller before any accounts.
    stage = 'ADMISSION';
    // Reserve60s action +two6s first-binding receipt rounds before the prepared
    // host expires, plus10s response margin before the local fence.
    // This pre-T0 wait is separate from server preflight freshness <=30s.
    absoluteDeadlineAt = Math.min(armed.ready.expires_at-72000, wall()+admissionMs);
    releaseCutoffAt = absoluteDeadlineAt-10000;
    check(Number.isFinite(releaseCutoffAt)&&releaseCutoffAt>wall(),'ADMISSION_TIMEOUT');
    admissionOpen=true;enteredAdmission=true;
    const control=Object.freeze({absoluteDeadlineAt,releaseCutoffAt,
      isOpen:()=>admissionOpen&&!rpc.closed&&wall()<releaseCutoffAt,
      assertOpen:()=>check(admissionOpen&&!rpc.closed&&wall()<releaseCutoffAt,'ADMISSION_TIMEOUT')});
    admissionSettled = false;
    const admission = Promise.resolve().then(() => {control.assertOpen();return admit(control);});
    admissionOwned = admission.then(() => { admissionSettled = true; }, () => { admissionSettled = true; });
    let release;
    try { release = await Promise.race([admission, new Promise((_, reject) => { admissionTimer = setTimeout(() => {admissionOpen=false;reject(new LifetimeError('ADMISSION_TIMEOUT','ADMISSION'));},Math.max(1,absoluteDeadlineAt-wall())); })]); }
    finally { clearTimeout(admissionTimer); }
    check(release && Object.keys(release).sort().join(',') === 'authorization_id,released,run_id' && release.released === true &&
      release.run_id === scope.run_id && release.authorization_id === scope.authorization_id && wall() < absoluteDeadlineAt && !rpc.closed, 'ADMISSION_FAILED');
    // No install/rehydration/model turn after release. The SAME armed instance
    // and RPC enter the actual foreground driver immediately, exactly once.
    admissionOpen=false;stage = 'FOREGROUND'; result = await run(armed,{stopJournal});
  } catch (error) { failure = safe(error); }
  finally {
    admissionOpen=false;clearTimeout(admissionTimer);
    if(enteredAdmission){stage='STOP';try{journalStop=await stopJournal();if(journalStop?.confirmed!==true)failure??={code:'STOP_FAILED',stage};}catch{failure??={code:'STOP_FAILED',stage};}}
    // A confirmed DB stop fences queued release under the same row lock.
    // Otherwise do NOT close the controller before the earlier DB cutoff has
    // expired (2s verified clock margin); ambiguity remains a terminal failure.
    if(enteredAdmission&&journalStop?.confirmed!==true){while(wall()<releaseCutoffAt+2000)await sleep(Math.min(25000,releaseCutoffAt+2000-wall()));}
    stage = 'CLOSE';
    try { if (prepared?.close) { closed = await prepared.close(); if (closed?.closed !== true) failure ??= { code: 'CLOSE_FAILED', stage }; } }
    catch { failure ??= { code: 'CLOSE_FAILED', stage }; }
    if (rpc) rpc.closed = true;
    // A timeout is not cancellation. Retain late admission ownership; no
    // response can restart foreground. Durable server guard handles cleanup.
    if (admissionOwned && !admissionSettled) {
      let timer; try { await Promise.race([admissionOwned, new Promise(r => { timer = setTimeout(r, drainMs); })]); } finally { clearTimeout(timer); }
    }
  }
  let drained = { pending: 0, closed: true };
  try { if (typeof rpc?.drain === 'function') drained = await rpc.drain(drainMs); } catch { failure ??= { code: 'CLOSE_FAILED', stage: 'CLOSE' }; }
  const ownedPending = (drained.pending ?? 0) + (admissionSettled ? 0 : 1) + (journalStop?.pending??0);
  if (ownedPending) failure ??= { code: 'PENDING_OWNERSHIP', stage: 'CLOSE' };
  return { result, failure, closed, journalStop, admission:{entered:enteredAdmission,absoluteDeadlineAt,releaseCutoffAt},rpc: drained, ownedPending, grantsOwnerGo: false };
}
