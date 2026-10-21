// Offline evidence planner only. No IO, network, credentials, execution or authority.
const HOUR=60*60*1000;
const ref=value=>typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,159}$/.test(value);
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const time=value=>{
  if(typeof value!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value))return NaN;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().replace(".000Z","Z")===value?parsed:NaN;
};
const recordKeys=["kind","sha","origin","deployId","observedAt","expiresAt","receiptRef","reviewerRef","facts"];
const goKeys=["checkId","sha","origin","deployId","approvedAt","expiresAt","receiptRef","approverRef","authorityRef","testerRef","decision","actions"];
const protectedKinds=["source-ci","isolation","perimeter"];
const definitions=[
  ["hosted-perimeter",["source-ci","isolation"],["anonymous-preview-root-get-no-redirect-no-body"]],
  ["hosted-ui",protectedKinds,["team-login","fixture-ui-read-only"]],
  ["ios-safari",[...protectedKinds,"ios-device"],["team-login","fixture-ui-read-only","physical-ios-safari","install-ui-observation"]],
  ["android-chrome",[...protectedKinds,"android-device"],["team-login","fixture-ui-read-only","physical-android-chrome","install-ui-observation"]],
  ["device-location",[...protectedKinds,"location-consent"],["team-login","fixture-ui-read-only","device-location-permission-once"]],
  ["google-oauth",[...protectedKinds,"oauth-config","oauth-consent"],["team-login","staging-google-login","create-test-user-session","refresh-own-test-session","sign-out-own-test-session"]],
  ["human-accessibility",[...protectedKinds,"assistive-device"],["team-login","fixture-ui-read-only","human-keyboard-screen-reader"]]
];
export const CHECKS=Object.freeze(definitions.map(([id,kinds,actions])=>Object.freeze({
  id,kinds:Object.freeze(kinds),actions:Object.freeze(actions),
  requiresStateChangeGO:["device-location","google-oauth"].includes(id)
})));
const factKeys={
  "source-ci":["success"],
  isolation:["syntheticOnly","providersDisabled","bookingDisabled","paymentsDisabled","nonProductionBackend"],
  perimeter:["anonymousStatus","teamAccessVerified"],
  "ios-device":["physical","consent","testerRef","osVersion","browserVersion"],
  "android-device":["physical","consent","testerRef","osVersion","browserVersion"],
  "location-consent":["consent","testerRef","deviceRef","noCoordinatesRetained"],
  "oauth-config":["stagingProjectRef","clientRef","callbackUrl","exactRedirectsReviewed","minimalIdentityScopes","noProductionAuth","noConfigChanges"],
  "oauth-consent":["consent","testerRef","testAccountRef","allowTestUserSessionCreation","allowOwnSessionRefreshSignOut"],
  "assistive-device":["physical","consent","testerRef","deviceRef","screenReaderVersion","browserVersion"]
};
function factsValid(kind,f,origin){
  if(!keys(f,factKeys[kind]||[])||!factKeys[kind]?.every(k=>Object.hasOwn(f,k)))return false;
  switch(kind){
    case "source-ci":return f.success===true;
    case "isolation":return Object.values(f).every(value=>value===true);
    case "perimeter":return f.anonymousStatus===401&&f.teamAccessVerified===true;
    case "ios-device":case "android-device":return f.physical===true&&f.consent===true&&ref(f.testerRef)&&ref(f.osVersion)&&ref(f.browserVersion);
    case "assistive-device":return f.physical===true&&f.consent===true&&ref(f.testerRef)&&ref(f.deviceRef)&&ref(f.screenReaderVersion)&&ref(f.browserVersion);
    case "location-consent":return f.consent===true&&ref(f.testerRef)&&ref(f.deviceRef)&&f.noCoordinatesRetained===true;
    case "oauth-consent":return f.consent===true&&ref(f.testerRef)&&ref(f.testAccountRef)&&f.allowTestUserSessionCreation===true&&f.allowOwnSessionRefreshSignOut===true;
    case "oauth-config":return ref(f.stagingProjectRef)&&ref(f.clientRef)&&f.callbackUrl===origin+"/"&&
      f.exactRedirectsReviewed===true&&f.minimalIdentityScopes===true&&f.noProductionAuth===true&&f.noConfigChanges===true;
    default:return false;
  }
}
function fresh(start,end,now,maxAge){
  const from=time(start),to=time(end);
  return Number.isFinite(from)&&Number.isFinite(to)&&from<=now&&to>now&&to>from&&to-from<=maxAge&&now-from<=maxAge;
}
function bound(record,deployment,sha){
  return record.sha===sha&&record.deployId===deployment.deployId&&record.origin===deployment.origin;
}

// sha/now are supplied independently by the reviewer/CI, not trusted from input.
// A complete record only becomes a MANUAL_REVIEW candidate: JSON cannot grant GO.
export function evaluatePreflight(input,{sha,now}={}){
  const common=[];const clock=time(now);
  const add=reason=>common.push(reason);
  if(!/^[a-f0-9]{40}$/.test(sha||"")||!Number.isFinite(clock))add("INVALID_REVIEW_CONTEXT");
  if(!keys(input,["schemaVersion","candidate","deployment","evidence","goRecords"])||input?.schemaVersion!==1)add("INVALID_INPUT");
  const c=input?.candidate,d=input?.deployment;
  if(!keys(c,["sha","pr","branch","state","draft","merged"])||c.sha!==sha||c.pr!==5||c.branch!=="get/release-candidate-mvp-qa-04"||c.state!=="open"||c.draft!==true||c.merged!==false)add("CANDIDATE_NOT_EXACT_OPEN_DRAFT");
  const deploymentValid=keys(d,["sha","origin","deployId","nonProduction","observedAt","expiresAt","receiptRef","reviewerRef"])&&
    d.sha===sha&&d.nonProduction===true&&ref(d.deployId)&&ref(d.receiptRef)&&ref(d.reviewerRef)&&
    /^https:\/\/(?:deploy-preview-5|[a-f0-9]{24})--getacourt-preview\.netlify\.app$/.test(d.origin)&&
    fresh(d.observedAt,d.expiresAt,clock,24*HOUR);
  if(!deploymentValid)add("MISSING_INVALID_STALE_OR_FOREIGN_DEPLOYMENT");
  if(!Array.isArray(input?.evidence)||input.evidence.length>50||!Array.isArray(input?.goRecords)||input.goRecords.length>20)add("INVALID_RECORD_COLLECTION");
  const evidence=Array.isArray(input?.evidence)?input.evidence:[];
  const gos=Array.isArray(input?.goRecords)?input.goRecords:[];
  if(evidence.some(r=>!keys(r,recordKeys)||!Object.hasOwn(factKeys,r.kind))||gos.some(r=>!keys(r,goKeys)||!CHECKS.some(c=>c.id===r.checkId)))add("UNKNOWN_OR_MALFORMED_RECORD");
  // Reject conflicting duplicates, rather than select whichever looks successful.
  if(new Set(evidence.map(r=>r?.kind)).size!==evidence.length||new Set(gos.map(r=>r?.checkId)).size!==gos.length)add("DUPLICATE_RECORD");
  const checks=CHECKS.map(check=>{
    const blockers=[...common];
    const receipts=[];
    for(const kind of check.kinds){
      const r=evidence.find(r=>r?.kind===kind);
      if(!r||!keys(r,recordKeys)||!deploymentValid||!bound(r,d,sha)||!ref(r.receiptRef)||!ref(r.reviewerRef)||
        !fresh(r.observedAt,r.expiresAt,clock,24*HOUR)||!factsValid(kind,r.facts,d.origin))blockers.push("EVIDENCE_REQUIRED:"+kind);
      else receipts.push(r);
    }
    const go=gos.find(r=>r?.checkId===check.id);
    if(!go||!keys(go,goKeys)||!deploymentValid||!bound(go,d,sha)||go.decision!=="GO"||
      !ref(go.receiptRef)||!ref(go.approverRef)||!ref(go.authorityRef)||!ref(go.testerRef)||
      !fresh(go.approvedAt,go.expiresAt,clock,8*HOUR)||!Array.isArray(go.actions)||
      go.actions.length!==check.actions.length||new Set(go.actions).size!==go.actions.length||
      !check.actions.every(action=>go.actions.includes(action)))blockers.push("EXACT_SCOPED_GO_REQUIRED");
    if(go&&receipts.some(r=>r.facts.testerRef&&r.facts.testerRef!==go.testerRef))blockers.push("TESTER_CONSENT_MISMATCH");
    return {id:check.id,preflight:blockers.length?"BLOCKED":"READY_FOR_MANUAL_GO_REVIEW",execution:"NOT_RUN",
      executionEnabled:false,requiresStateChangeGO:check.requiresStateChangeGO,
      requiredEvidence:[...check.kinds],requiredGoActions:[...check.actions],blockers};
  });
  // Never echo arbitrary receipt contents, account identifiers, URLs or credentials.
  return {schemaVersion:1,mode:"READ_ONLY_OFFLINE_PREFLIGHT",reviewedSha:/^[a-f0-9]{40}$/.test(sha||"")?sha:null,
    asOf:Number.isFinite(clock)?now:null,executionEnabled:false,
    authorityVerified:false,releaseReady:false,workerActivation:"NOT_AUTHORISED",checks};
}
