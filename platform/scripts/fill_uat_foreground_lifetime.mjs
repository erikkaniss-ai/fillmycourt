// One awaited caller lifetime. No Auth/SQL/secret/process implementation here.
// Callbacks and ControlRpc are trusted in-memory dependencies, not serialized
// receipts. Execute prepare -> arm/lookup -> admit -> foreground in ONE exec;
// never put a prepared object in store or reconstruct its methods in another.
const STAGES = new Set(['PREPARE', 'ARM', 'ADMISSION', 'FOREGROUND', 'CLOSE']);
const CODES = new Set(['INVALID_LIFETIME', 'PREPARE_FAILED', 'ARM_FAILED', 'ADMISSION_FAILED', 'ADMISSION_TIMEOUT', 'FOREGROUND_FAILED', 'CLOSE_FAILED', 'PENDING_OWNERSHIP']);
const RPC_CODES = new Set(['RPC_TIMEOUT','READ_TIMEOUT','RPC_REMOTE_FAILED','RPC_BAD_ENVELOPE','PREPARE_MISSING','PREPARE_EXPIRED','PREPARE_CLOSED','SCOPE_MISMATCH','NOT_ARMED','CONTROL_FAILED','ABORTED']);
const RPC_STAGES = new Set(['PREPARE_INSTALL','PREPARE_LOOKUP','ARM','BEGIN','COMPLETE','ROOT_RECEIPT','STOP','DIAGNOSTIC_COMPLETE']);
export class LifetimeError extends Error {
  constructor(code, stage) { super('Fill foreground lifetime rejected.'); this.code = CODES.has(code) ? code : 'INVALID_LIFETIME'; this.stage = STAGES.has(stage) ? stage : 'CLOSE'; }
}

export async function runFillLifetime({ scope, rpc, prepare, arm, admit, run, wall = Date.now, admissionMs = 30000, drainMs = 11000 }) {
  let prepared, armed, result = null, failure = null, closed = null, stage = 'PREPARE', admissionOwned, admissionSettled = true, admissionTimer;
  const check = (ok, code = 'INVALID_LIFETIME') => { if (!ok) throw new LifetimeError(code, stage); };
  const safe = error => {
    if(error instanceof LifetimeError)return {code:error.code,stage:error.stage};
    const failure={code:({PREPARE:'PREPARE_FAILED',ARM:'ARM_FAILED',ADMISSION:'ADMISSION_FAILED',FOREGROUND:'FOREGROUND_FAILED',CLOSE:'CLOSE_FAILED'})[stage],stage};
    try {const code=Object.getOwnPropertyDescriptor(error,'code')?.value,rpcStage=Object.getOwnPropertyDescriptor(error,'stage')?.value;if(RPC_CODES.has(code)&&RPC_STAGES.has(rpcStage))failure.rpc={code,stage:rpcStage};}catch{}
    return failure;
  };
  try {
    check(scope && /^[0-9a-f-]{36}$/.test(scope.run_id) && /^[0-9a-f-]{36}$/.test(scope.authorization_id));
    check(rpc && typeof rpc.request === 'function' && typeof rpc.drain === 'function' && [prepare, arm, admit, run, wall].every(f => typeof f === 'function'));
    check(Number.isFinite(admissionMs) && admissionMs > 0 && admissionMs <= 30000 && Number.isFinite(drainMs) && drainMs > 0 && drainMs <= 11000);
    prepared = await prepare();
    check(prepared?.rpc === rpc && typeof prepared.close === 'function' && !rpc.closed, 'PREPARE_FAILED');
    stage = 'ARM'; armed = await arm(prepared);
    check(armed?.rpc === rpc && armed.ready?.live_ready === true && armed.ready.pre_t0 === true &&
      armed.ready.grantsOwnerGo === false && JSON.stringify(armed.scope) === JSON.stringify(scope) && !rpc.closed, 'ARM_FAILED');
    // Caller scheduling prerequisite only. This is NOT independent proof of
    // canonical T0 absence or GO. Genuine owner preflight + canonical admission
    // must be performed by the existing trusted caller before any accounts.
    stage = 'ADMISSION';
    const deadline = Math.min(armed.ready.expires_at, wall() + admissionMs);
    check(Number.isFinite(deadline) && deadline > wall(), 'ADMISSION_TIMEOUT');
    admissionSettled = false;
    const admission = Promise.resolve().then(() => admit());
    admissionOwned = admission.then(() => { admissionSettled = true; }, () => { admissionSettled = true; });
    let release;
    try { release = await Promise.race([admission, new Promise((_, reject) => { admissionTimer = setTimeout(() => reject(new LifetimeError('ADMISSION_TIMEOUT', 'ADMISSION')), Math.max(1, deadline - wall())); })]); }
    finally { clearTimeout(admissionTimer); }
    check(release && Object.keys(release).sort().join(',') === 'authorization_id,released,run_id' && release.released === true &&
      release.run_id === scope.run_id && release.authorization_id === scope.authorization_id && wall() < deadline && !rpc.closed, 'ADMISSION_FAILED');
    // No install/rehydration/model turn after release. The SAME armed instance
    // and RPC enter the actual foreground driver immediately, exactly once.
    stage = 'FOREGROUND'; result = await run(armed);
  } catch (error) { failure = safe(error); }
  finally {
    clearTimeout(admissionTimer); stage = 'CLOSE';
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
  const ownedPending = (drained.pending ?? 0) + (admissionSettled ? 0 : 1);
  if (ownedPending) failure ??= { code: 'PENDING_OWNERSHIP', stage: 'CLOSE' };
  return { result, failure, closed, rpc: drained, ownedPending, grantsOwnerGo: false };
}
