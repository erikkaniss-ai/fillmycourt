import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync("platform/public/fill/app.js","utf8");
// Pinned sanitized CI output, not a newly issued GO or hosted acceptance receipt.
const golden=JSON.parse(readFileSync("platform/tests/fixtures/get-acceptance-79977c8-NOT-RUN.json","utf8"));
const clubPackage=JSON.parse(readFileSync("platform/tests/fixtures/club-go-package-INCOMPLETE-FIXTURE-ONLY.json","utf8"));
const getPackage=JSON.parse(readFileSync("platform/tests/fixtures/get-go-package-DECLARED-FIXTURE-ONLY.json","utf8"));
function operationsRead(){return {mode:"read_only_operations_preflight",contract_version:"provider-provenance-operations-preflight/v1",
  as_of:"2026-10-21T10:00:00Z",operations_runtime_sha:"a".repeat(40),runtime_identity_source:"railway_build_environment_not_independent_attestation",
  status:"operations_checks_passed",checks:Object.fromEntries(["operations_service","non_production_runtime","runtime_revision_matches",
    "provider_reads_disabled_in_this_api","owner_admin_scope","authenticated_rls_context","repeatable_read_only","schema_rls_select","reader_columns_present","get_routes_present"].map(k=>[k,"pass"])),
  not_assessed:["external_runtime_identity","protected_host","two_org_hosted_uat","worker_provider_read_state","fixture_provisioning","owner_uat_go"],
  ...Object.fromEntries(["hosted_uat_ready","uat_accepted","pilot_ready","provider_requests_allowed","can_display_available_slots","deploy_allowed"].map(k=>[k,false]))};}
const SHA="79977c8672db84e6c062a804268dd9123e04f480";
const ORG="11111111-1111-4111-8111-111111111111",OTHER="22222222-2222-4222-8222-222222222222";
const NOW=Date.parse("2026-10-21T10:30:00Z");
class Clock extends Date {constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
const settle=async()=>{await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));};
const ok=data=>({ok:true,status:200,json:async()=>data});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function node(dataset={}){
  let value="",html="",text="";const handlers=new Map();
  return {dataset,hidden:false,disabled:false,files:[],classList:{toggle(){}},
    get value(){return value;},set value(v){value=v;if(v==="")this.files=[];},
    get innerHTML(){return html;},set innerHTML(v){html=v;text="";},
    get textContent(){return text;},set textContent(v){text=v;html="";},
    addEventListener:(event,fn)=>handlers.set(event,fn),run:event=>handlers.get(event)?.({preventDefault(){}})};
}
async function harness({role="owner",signedIn=true,demo=false,name="SYNTHETIC A"}={}){
  let clockNow=NOW;
  class ReviewClock extends Clock {static now(){return clockNow;}}
  const nodes=new Map(),nav=["today","calendar","revenue","provenance"].map(view=>node({view}));
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const storage=new Map(signedIn?[["fill.access","fixture-session"]]:[]),calls=[],controls={deny:false};
  const fixture=path=>path==="/api/me"?{user:{email:"fixture@example.invalid"}}:
    path==="/api/fmc/organizations"?{items:[{id:ORG,name,role},{id:OTHER,name:"SYNTHETIC B",role:"admin"}]}:
    path.includes("/today?")?{summary:{},courts:[],empty_windows:[]}:
    path.includes("/preflight?")?(controls.preflight||operationsRead()):
    path.endsWith("/connections")?{items:[]}:null;
  vm.runInNewContext(source,{URLSearchParams,Intl,Date:ReviewClock,Map,Set,Number,String,Error,JSON,encodeURIComponent,
    document:{querySelector:get,querySelectorAll:()=>nav},window:{FillDemo:{get:fixture}},
    location:{hostname:demo?"localhost":"fixture.invalid",search:demo?"?demo=1":"",hash:"",pathname:"/fill/"},
    history:{replaceState(){}},localStorage:{removeItem(){}},
    sessionStorage:{getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    fetch:async(path,options={})=>{calls.push({path,method:options.method||"GET"});
      if(controls.deny)return {ok:false,status:401,json:async()=>({message:"SECRET"})};
      const data=fixture(path);if(data)return ok(data);throw Error("Unexpected request");}
  });
  await settle();
  const open=()=>nav[3].run("click");
  const select=async(data=structuredClone(golden),expected=SHA,customFile)=>{
    get("#acceptanceSha").value=expected;await get("#acceptanceSha").run("input");
    const text=typeof data==="string"?data:JSON.stringify(data);
    get("#acceptanceFile").files=[customFile||{size:Buffer.byteLength(text),text:async()=>text}];
    await get("#acceptanceFile").run("change");
  };
  const review=()=>get("#acceptanceForm").run("submit");
  const ops=async()=>{get("#operationsSha").value="a".repeat(40);await get("#operationsSha").run("input");await get("#preflightForm").run("submit");};
  const check=async(id="google-oauth")=>{get("#getPackageCheck").value=id;await get("#getPackageCheck").run("change");};
  const selectPackage=async(domain,data,customFile)=>{const text=typeof data==="string"?data:JSON.stringify(data);
    get("#"+domain+"PackageFile").files=[customFile||{size:Buffer.byteLength(text),text:async()=>text}];
    await get("#"+domain+"PackageFile").run("change");};
  return {get,nav,storage,calls,controls,open,select,review,ops,check,selectPackage,setNow:value=>{clockNow=value;},
    packageReview:domain=>get("#"+domain+"PackageForm").run("submit"),
    packageResult:domain=>get("#"+domain+"PackageResult").innerHTML||get("#"+domain+"PackageResult").textContent,
    packageSummary:domain=>get("#"+domain+"PackageSummary").innerHTML||get("#"+domain+"PackageSummary").textContent,
    packageMissing:domain=>get("#"+domain+"PackageMissing").innerHTML||get("#"+domain+"PackageMissing").textContent,
    packageSteps:domain=>get("#"+domain+"PackageSteps").innerHTML||get("#"+domain+"PackageSteps").textContent,
    packageStepsSummary:domain=>get("#"+domain+"PackageStepsSummary").innerHTML||get("#"+domain+"PackageStepsSummary").textContent,
    clubSteps:()=>get("#clubNextSteps").innerHTML||get("#clubNextSteps").textContent,
    candidateSteps:()=>get("#candidateNextSteps").innerHTML||get("#candidateNextSteps").textContent,
    clubDraft:()=>get("#clubGoRequest").innerHTML||get("#clubGoRequest").textContent,
    candidateDrafts:()=>get("#candidateGoRequests").innerHTML||get("#candidateGoRequests").textContent,
    summary:()=>get("#acceptanceSummary").innerHTML||get("#acceptanceSummary").textContent,
    report:()=>get("#acceptanceReport").innerHTML,message:()=>get("#acceptanceMessage").textContent};
}

test("Pinned Get79977c8 report renders seven NOT_RUN checks and missing GO, never fetches or persists",async()=>{
  assert.equal(golden.reviewedSha,SHA);assert.equal(golden.asOf,"2026-10-21T10:22:52Z");
  const h=await harness({name:"SYNTHETIC <img src=x>"});await h.open();
  assert.equal(h.report(),"");assert.equal(h.get("#acceptanceSha").value,"");
  const count=h.calls.length;await h.select();assert.equal(h.report(),"");await h.review();
  assert.equal(h.calls.length,count);assert.equal(h.storage.size,1);
  assert.equal((h.report().match(/· NOT_RUN/g)||[]).length,7);
  assert.equal((h.report().match(/Missing \/ invalid exact scoped GO/g)||[]).length,7);
  assert.match(h.report(),/SYNTHETIC &lt;img/);assert.doesNotMatch(h.report(),/<img/);
  assert.match(h.report(),/not a club-specific report or club GO/);
  assert.match(h.report(),/create-test-user-session/);assert.match(h.message(),/No verified GO/);
  assert.equal(h.get("#clubUatBlockers").innerHTML.includes("Owner UAT GO"),true);
  assert.match(h.summary(),/7 checks: <strong>7 blocked/);
  assert.match(h.summary(),/GO records flagged missing \/ invalid: 7 of 7/);
  assert.match(h.summary(),/Verified GO: none/);
});
test("Complete record snapshots still require human review and cannot clear club gates",async()=>{
  const h=await harness();await h.open();const data=structuredClone(golden);
  data.checks.forEach(c=>{c.blockers=[];c.preflight="READY_FOR_MANUAL_GO_REVIEW";});
  const before=h.get("#clubUatBlockers").innerHTML;await h.select(data);await h.review();
  assert.equal((h.report().match(/Ready for manual GO review only/g)||[]).length,7);
  assert.equal((h.report().match(/No verified GO/g)||[]).length,7);
  assert.equal(h.get("#clubUatBlockers").innerHTML,before);
  assert.doesNotMatch(h.report(),/GO granted|UAT approved|execution enabled/);
  assert.match(h.summary(),/0 blocked/);assert.match(h.summary(),/0 of 7/);
  assert.match(h.summary(),/Verified GO: none/);assert.match(h.summary(),/not club readiness/);
});
test("Unsafe, stale, foreign, contradictory, secret-bearing or malformed reports clear prior DOM",async()=>{
  const mutations=[d=>d.schemaVersion=2,d=>d.mode="RUN",d=>d.reviewedSha="b".repeat(40),
    d=>d.asOf="2026-10-20T10:29:59Z",d=>d.asOf="2026-10-21T10:30:01Z",d=>d.asOf="2026-02-30T10:00:00Z",
    d=>d.asOf="SECRET<img>",d=>d.executionEnabled=true,d=>d.authorityVerified=true,d=>d.releaseReady=true,
    d=>d.workerActivation="AUTHORISED",d=>d.token="SECRET",d=>d.checks.pop(),d=>d.checks.push(d.checks[0]),
    d=>d.checks.reverse(),d=>d.checks[0].id="SECRET",d=>d.checks[0].execution="PASS",
    d=>d.checks[0].executionEnabled=true,d=>d.checks[0].requiresStateChangeGO=true,
    d=>d.checks[0].preflight="READY_FOR_MANUAL_GO_REVIEW",d=>d.checks[0].blockers=[],
    d=>d.checks[0].blockers.push("SECRET<img>"),d=>d.checks[0].blockers.push(d.checks[0].blockers[0]),
    d=>d.checks[0].requiredGoActions.push("production-deploy"),d=>d.checks[0].requiredEvidence.push("SECRET"),
    d=>d.checks[0].private="SECRET",d=>d.checks[0].blockers=null];
  const h=await harness();await h.open();
  for(const mutate of mutations){
    await h.select();await h.review();assert.notEqual(h.report(),"");
    const d=structuredClone(golden);mutate(d);await h.select(d);await h.review();
    assert.equal(h.report(),"");assert.match(h.message(),/unavailable, incompatible, stale or for another SHA/);
    assert.doesNotMatch(h.message(),/SECRET|<img/);
    assert.match(h.summary(),/rejected or unavailable/);assert.doesNotMatch(h.summary(),/SECRET|<img|7 checks:/);
    assert.doesNotMatch(h.candidateSteps(),/SECRET|<img|data-candidate-go=/);
    assert.doesNotMatch(h.candidateDrafts(),/SECRET|<img|data-go-template=|79977c8/);
  }
  for(const bad of ["{", "null", "[]", "{}"]){await h.select(bad);await h.review();assert.equal(h.report(),"");}
  for(const value of [null, " ".repeat(65537)]){
    await h.select(golden,SHA,{size:100,text:async()=>value});await h.review();assert.equal(h.report(),"");
  }
});
test("Explicit full SHA, one bounded file, no URL/default/automatic read",async()=>{
  const h=await harness();await h.open();let reads=0;
  for(const expected of ["", "79977c8", SHA.toUpperCase(),SHA+" ","https://private.invalid"]){
    await h.select(golden,expected,{size:100,text:async()=>{reads++;return JSON.stringify(golden);}});await h.review();
  }
  for(const size of [-1,0,65537,NaN]){await h.select(golden,SHA,{size,text:async()=>{reads++;return "{}";}});await h.review();}
  assert.equal(reads,0);assert.equal(h.report(),"");assert.equal(h.calls.length,4);
});
for(const options of [{role:"manager"},{role:"viewer"},{role:"unknown"},{signedIn:false},{demo:true}])
test(`No file read without owner/admin authenticated scope: ${JSON.stringify(options)}`,async()=>{
  const h=await harness(options);await h.open();let reads=0;
  await h.select(golden,SHA,{size:100,text:async()=>{reads++;return JSON.stringify(golden);}});
  assert.equal(h.get("#acceptanceReview").disabled,true);await h.review();
  assert.equal(reads,0);assert.equal(h.report(),"");
  assert.doesNotMatch(h.summary(),new RegExp(SHA));assert.doesNotMatch(h.summary(),/7 checks:/);
  assert.doesNotMatch(h.candidateSteps(),new RegExp(SHA));assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=/);
  for(const html of [h.clubDraft(),h.candidateDrafts()])assert.doesNotMatch(html,/data-go-template=/);
});
for(const action of ["club","tab","logout","sha","file","refresh","401"])
test(`Late file completion after ${action} cannot restore stale scope`,async()=>{
  const h=await harness();await h.open();const pending=deferred();
  await h.select(golden,SHA,{size:100,text:()=>pending.promise});const running=h.review();await settle();
  if(action==="club"){h.get("#orgSelect").value=OTHER;await h.get("#orgSelect").run("change");await settle();}
  if(action==="tab")await h.nav[0].run("click");
  if(action==="logout")await h.get("#signOut").run("click");
  if(action==="sha"){h.get("#acceptanceSha").value="b".repeat(40);await h.get("#acceptanceSha").run("input");}
  if(action==="file")await h.select();
  if(action==="refresh"){await h.get("#refreshButton").run("click");await settle();}
  if(action==="401"){h.controls.deny=true;await h.get("#refreshButton").run("click");await settle();}
  pending.resolve(JSON.stringify(golden));await running;
  assert.equal(h.report(),"");assert.equal(h.message(),"");
  assert.doesNotMatch(h.summary(),new RegExp(SHA));assert.doesNotMatch(h.summary(),/7 checks:/);
  assert.doesNotMatch(h.candidateSteps(),new RegExp(SHA));assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=/);
  assert.doesNotMatch(h.candidateDrafts(),new RegExp(SHA));assert.doesNotMatch(h.candidateDrafts(),/data-go-template=/);
  if(["logout","401","tab"].includes(action))assert.equal(h.clubDraft(),"");
  if(["club","tab","logout","refresh","401"].includes(action)){
    assert.equal(h.get("#acceptanceSha").value,"");assert.equal(h.get("#acceptanceFile").files.length,0);
  }
  if(["logout","401"].includes(action))assert.equal(h.storage.size,0);
});
test("Late failure cannot erase a newer valid local report; current failure is redacted",async()=>{
  const h=await harness();await h.open();const old=deferred();
  await h.select(golden,SHA,{size:100,text:()=>old.promise});const running=h.review();await settle();
  await h.select();await h.review();const current=h.report(),summary=h.summary(),steps=h.candidateSteps(),drafts=h.candidateDrafts();old.reject(Error("SECRET"));await running;
  assert.equal(h.report(),current);
  assert.equal(h.summary(),summary);
  assert.equal(h.candidateSteps(),steps);
  assert.equal(h.candidateDrafts(),drafts);
  await h.select(golden,SHA,{size:100,text:async()=>{throw Error("SECRET");}});await h.review();
  assert.equal(h.report(),"");assert.doesNotMatch(h.message(),/SECRET/);
  assert.match(h.summary(),/rejected or unavailable/);
});

test("Adjacent summary is opt-in presentation only; selection/loading never retains prior counts",async()=>{
  const h=await harness();await h.open();const calls=h.calls.length;
  assert.match(h.summary(),/No local report reviewed/);assert.doesNotMatch(h.summary(),/0 of 7|7 checks:/);
  await h.select();assert.match(h.summary(),/No local report reviewed/);await h.review();
  const club=h.get("#clubUatBlockers").innerHTML,old=deferred();
  await h.select(golden,SHA,{size:100,text:()=>old.promise});const running=h.review();await settle();
  assert.match(h.summary(),/read in progress/);assert.doesNotMatch(h.summary(),/7 checks:|7 of 7/);
  old.resolve(JSON.stringify(golden));await running;
  assert.match(h.summary(),/7 checks:/);assert.equal(h.calls.length,calls);
  assert.equal(h.get("#clubUatBlockers").innerHTML,club);assert.equal(h.storage.size,1);
});
test("Mixed candidate snapshot counts exact flags only, never combines club and candidate GO",async()=>{
  const h=await harness();await h.open();const club=h.get("#clubUatBlockers").innerHTML;
  const data=structuredClone(golden);
  data.checks[2].blockers=["EVIDENCE_REQUIRED:source-ci"];
  data.checks.slice(3).forEach(c=>{c.blockers=[];c.preflight="READY_FOR_MANUAL_GO_REVIEW";});
  await h.select(data);await h.review();
  assert.match(h.summary(),/3 blocked/);assert.match(h.summary(),/4 complete for manual GO review only/);
  assert.match(h.summary(),/missing \/ invalid: 2 of 7/);
  assert.equal((h.summary().match(/GO record missing \/ invalid/g)||[]).length,2);
  assert.equal((h.summary().match(/NOT_RUN\./g)||[]).length,7);
  assert.match(h.summary(),/Verified GO: none/);assert.match(h.summary(),/Club UAT\/pilot GO, provider rights and deployment authority stay separate/);
  assert.equal(h.get("#clubUatBlockers").innerHTML,club);
});
test("Operations parameter edits leave candidate snapshot independent; expiry is not refreshed by rerender",async()=>{
  const h=await harness();await h.open();await h.select();await h.review();const summary=h.summary(),calls=h.calls.length;
  h.get("#operationsSha").value="a".repeat(40);await h.get("#operationsSha").run("input");
  assert.equal(h.summary(),summary);assert.equal(h.calls.length,calls);
  h.setNow(NOW+25*60*60*1000);await h.get("#operationsSha").run("input");
  assert.match(h.summary(),/report expired/);assert.doesNotMatch(h.summary(),/7 checks:|7 of 7/);
  assert.doesNotMatch(h.candidateSteps(),new RegExp(SHA));assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=/);
  assert.doesNotMatch(h.candidateDrafts(),new RegExp(SHA));assert.doesNotMatch(h.candidateDrafts(),/data-go-template=/);
  assert.match(h.get("#clubUatBlockers").innerHTML,/Owner UAT GO/);
});
test("New club summary starts unreviewed; reimport cannot reuse the previous club's counts",async()=>{
  const h=await harness();await h.open();await h.select();await h.review();
  h.get("#orgSelect").value=OTHER;await h.get("#orgSelect").run("change");await settle();
  assert.match(h.summary(),/No local report reviewed/);assert.doesNotMatch(h.summary(),/7 checks:/);
  const data=structuredClone(golden);data.checks.forEach(c=>{c.blockers=[];c.preflight="READY_FOR_MANUAL_GO_REVIEW";});
  await h.select(data);await h.review();assert.match(h.summary(),/0 blocked/);
  assert.doesNotMatch(h.summary(),/7 blocked|7 of 7/);assert.match(h.summary(),/Verified GO: none/);
  assert.match(h.get("#clubUatBlockers").innerHTML,/Owner UAT GO/);
});
test("Adjacent candidate scope has its own accessible region and never writes club assessment state",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  assert.match(html,/<div class="review-gate-columns">/);
  assert.match(html,/aria-labelledby="acceptanceSummaryHeading"/);
  assert.match(html,/id="acceptanceSummary" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/candidate-wide evidence cannot grant club UAT\/pilot GO/);
  const section=source.slice(source.indexOf("  function renderAcceptanceSummary()"),source.indexOf("  function resetAcceptance("));
  assert.doesNotMatch(section,/\bapi\(|\bfetch\(|state\.reviewSummary|uatBlockers|Storage|setInterval|setTimeout/);
  const css=readFileSync("platform/public/fill/styles.css","utf8");
  assert.match(css,/\.review-gate-columns \{ display:grid;/);
});
test("Separate GO next-step lists start as unverified planning, never initiate reads or expose a plan from a selected file",async()=>{
  const h=await harness();await h.open();const calls=h.calls.length;
  assert.match(h.clubSteps(),/Club-only planning scope/);assert.match(h.clubSteps(),new RegExp(ORG));
  assert.match(h.clubSteps(),/data-club-next="club-uat-go"/);assert.match(h.clubSteps(),/data-club-next="club-pilot-go"/);
  assert.match(h.candidateSteps(),/No current candidate-specific plan/);
  assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=/);
  await h.select();assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=/);
  assert.equal(h.calls.length,calls);assert.equal(h.storage.size,1);
});
test("Only candidate missing flags select exact Get GO scopes; club planning is unchanged",async()=>{
  const h=await harness();await h.open();const club=h.clubSteps(),blockers=h.get("#clubUatBlockers").innerHTML;
  const data=structuredClone(golden);data.checks.slice(2).forEach(c=>{c.blockers=[];c.preflight="READY_FOR_MANUAL_GO_REVIEW";});
  await h.select(data);await h.review();
  assert.deepEqual([...h.candidateSteps().matchAll(/data-candidate-go="([^"]+)"/g)].map(m=>m[1]),["hosted-perimeter","hosted-ui"]);
  assert.match(h.candidateSteps(),/anonymous-preview-root-get-no-redirect-no-body/);
  assert.match(h.candidateSteps(),/exact SHA\/deploy\/action scope/);
  assert.match(h.candidateSteps(),/separate deployment GO first; do not deploy/);
  assert.match(h.candidateSteps(),/OAuth and device-location permissions need separate explicit state-change GO/);
  assert.equal(h.clubSteps(),club);assert.equal(h.get("#clubUatBlockers").innerHTML,blockers);
  assert.doesNotMatch(h.clubSteps(),new RegExp(SHA));assert.doesNotMatch(h.clubSteps(),/data-candidate-go=/);
});
test("Complete records with no missing flags still require independent Get GO review and club/pilot GO",async()=>{
  const h=await harness();await h.open();const data=structuredClone(golden);
  data.checks.forEach(c=>{c.blockers=[];c.preflight="READY_FOR_MANUAL_GO_REVIEW";});
  await h.select(data);await h.review();assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=/);
  assert.match(h.candidateSteps(),/data-candidate-next="candidate-unverified-go"/);
  assert.match(h.candidateSteps(),/no GO is verified/);assert.match(h.candidateSteps(),/do not execute/);
  assert.match(h.clubSteps(),/separate club UAT GO/);assert.match(h.clubSteps(),/separate pilot GO/);
  for(const html of [h.clubSteps(),h.candidateSteps()])assert.doesNotMatch(html,/<(?:button|input|form|a)\b|GO granted|approved for execution/);
});
test("Loading and stale-file failure cannot keep old GO steps; a new club starts without candidate-specific actions",async()=>{
  const h=await harness();await h.open();await h.select();await h.review();const old=deferred();
  await h.select(golden,SHA,{size:100,text:()=>old.promise});const running=h.review();await settle();
  assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=/);assert.doesNotMatch(h.candidateSteps(),new RegExp(SHA));
  h.get("#orgSelect").value=OTHER;await h.get("#orgSelect").run("change");await settle();
  old.reject(Error("SECRET"));await running;
  assert.match(h.clubSteps(),new RegExp(OTHER));assert.doesNotMatch(h.clubSteps(),new RegExp(ORG));
  assert.doesNotMatch(h.candidateSteps(),/data-candidate-go=|SECRET/);
  await h.get("#signOut").run("click");assert.equal(h.clubSteps(),"");assert.equal(h.candidateSteps(),"");
});
test("GO planning has distinct accessible sections, fixed role labels and no shared authorization state",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  for(const [heading,id] of [["clubNextHeading","clubNextSteps"],["candidateNextHeading","candidateNextSteps"]]){
    assert.match(html,new RegExp('aria-labelledby="'+heading+'"'));
    assert.match(html,new RegExp('id="'+id+'" role="status" aria-live="polite" aria-atomic="true"'));
  }
  const club=source.slice(source.indexOf("  function renderClubNextSteps("),source.indexOf("  function setReviewSummary("));
  const candidate=source.slice(source.indexOf("  function renderCandidateNextSteps("),source.indexOf("  // Independent candidate-wide presentation"));
  assert.doesNotMatch(club,/acceptanceSnapshot|acceptanceCatalog|candidateNextSteps|\bapi\(|\bfetch\(/);
  assert.doesNotMatch(candidate,/state\.reviewSummary|clubNextSteps|uatBlockers|\bapi\(|\bfetch\(/);
  for(const segment of [club,candidate])assert.doesNotMatch(segment,/Storage|setInterval|setTimeout|\.addEventListener|\.submit\(|<button|<form|<input/);
});

test("Local viewer has labels/no transport/storage/runner, remains in both mandatory CI jobs",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  assert.match(html,/aria-labelledby="acceptanceHeading"/);assert.match(html,/id="acceptanceMessage" role="status" aria-live="polite"/);
  assert.match(html,/type="file" accept="application\/json,.json"/);assert.match(html,/No verified GO; all real checks remain NOT_RUN/);
  const segment=source.slice(source.indexOf("  const acceptanceCatalog ="),source.indexOf("  const preflightChecks ="));
  assert.doesNotMatch(segment,/\bfetch\s*\(|\bapi\s*\(|Storage\.|setInterval|setTimeout|FormData|serviceWorker|\.submit\(/);
  const ci=readFileSync(".github/workflows/platform-ci.yml","utf8");
  assert.equal((ci.match(/node --test platform\/tests\/fill_operator_acceptance_contract.test.mjs/g)||[]).length,2);
});

test("Unsent club template has explicit unknowns, no candidate template before opt-in review and no side effects",async()=>{
  const h=await harness({name:"PRIVATE<img>"});await h.open();const count=h.calls.length;
  assert.match(h.clubDraft(),/data-go-template="club-uat"/);assert.match(h.clubDraft(),new RegExp(ORG));
  assert.match(h.clubDraft(),/UNSENT DRAFT · NOT GO/);assert.match(h.clubDraft(),/REQUIRED: exact approved Operations SHA/);
  assert.match(h.clubDraft(),/Two authorised synthetic organisations/);assert.match(h.clubDraft(),/wrong-role\/cross-org access-denial/);
  assert.match(h.clubDraft(),/pilot execution or pilot GO/);assert.match(h.clubDraft(),/expiry \/ revocation/);
  assert.doesNotMatch(h.clubDraft(),/PRIVATE|<img|79977c8/);assert.doesNotMatch(h.candidateDrafts(),/data-go-template=/);
  await h.select();assert.doesNotMatch(h.candidateDrafts(),/data-go-template=/);
  assert.equal(h.calls.length,count);assert.equal(h.storage.size,1);
});
test("Each missing Get GO selects an unsent per-check template with exact SHA/actions, not a combined request",async()=>{
  const h=await harness();await h.open();const club=h.clubDraft(),count=h.calls.length;
  await h.select();await h.review();const drafts=h.candidateDrafts();
  assert.deepEqual([...drafts.matchAll(/data-go-template="([^"]+)"/g)].map(m=>m[1]),golden.checks.map(c=>c.id));
  for(const check of golden.checks){
    const block=drafts.split('data-go-template="'+check.id+'"')[1].split("</details>")[0];
    assert.match(block,new RegExp(SHA));assert.ok(block.includes(check.requiredGoActions.join(", ")));
    assert.ok(block.includes(check.requiredEvidence.join(", ")));assert.match(block,/one check per separate GO/);
    assert.match(block,/UNSENT REQUEST DRAFT/);assert.match(block,/verified GO NONE/);
    assert.match(block,/Approver \/ delegation: \[REQUIRED/);assert.match(block,/any new deploy needs separate deployment GO/);
    assert.match(block,/expiry \/ revocation/);assert.match(block,/neither sends this draft nor verifies or records GO/);
    assert.match(block,check.requiresStateChangeGO?/Separate explicit state-change GO REQUIRED/:/OAuth and device-location state changes are excluded/);
  }
  assert.doesNotMatch(drafts,new RegExp(ORG));assert.equal(h.clubDraft(),club);
  assert.equal(h.calls.length,count);assert.equal(h.storage.size,1);
});
test("Mixed and zero missing flags select only missing-GO drafts and never turn complete records into authority",async()=>{
  const h=await harness();await h.open();const data=structuredClone(golden);
  data.checks[1].blockers=["EVIDENCE_REQUIRED:source-ci"];
  data.checks.slice(2).forEach(c=>{c.blockers=[];c.preflight="READY_FOR_MANUAL_GO_REVIEW";});
  await h.select(data);await h.review();
  assert.deepEqual([...h.candidateDrafts().matchAll(/data-go-template="([^"]+)"/g)].map(m=>m[1]),["hosted-perimeter"]);
  data.checks[0].blockers=[];data.checks[0].preflight="READY_FOR_MANUAL_GO_REVIEW";
  await h.select(data);await h.review();assert.doesNotMatch(h.candidateDrafts(),/data-go-template=/);
  assert.match(h.candidateDrafts(),/existing original approvals still need independent review/);
  assert.match(h.candidateDrafts(),/No verified GO; do not execute/);
});
test("Completed request templates clear on a new club, tab, logout and current session expiry",async()=>{
  for(const action of ["club","tab","logout","401"]){
    const h=await harness();await h.open();await h.select();await h.review();
    if(action==="club"){h.get("#orgSelect").value=OTHER;await h.get("#orgSelect").run("change");await settle();}
    if(action==="tab")await h.nav[0].run("click");
    if(action==="logout")await h.get("#signOut").run("click");
    if(action==="401"){h.controls.deny=true;await h.get("#refreshButton").run("click");await settle();}
    assert.doesNotMatch(h.candidateDrafts(),/data-go-template=/);assert.doesNotMatch(h.candidateDrafts(),new RegExp(SHA));
    if(action==="club"){assert.match(h.clubDraft(),new RegExp(OTHER));assert.doesNotMatch(h.clubDraft(),new RegExp(ORG));}
    else assert.equal(h.clubDraft(),"");
  }
});
test("Templates are escaped selectable disclosures, not editable approvals, send controls or a shared authority surface",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8"),css=readFileSync("platform/public/fill/styles.css","utf8");
  for(const id of ["clubGoRequestHeading","candidateGoRequestsHeading"])assert.match(html,new RegExp('aria-labelledby="'+id+'"'));
  const helper=source.slice(source.indexOf("  function goRequestText("),source.indexOf("  // Club-only planning"));
  assert.match(helper,/esc\(lines.join/);assert.match(helper,/<summary>/);assert.match(helper,/tabindex="0" aria-label=/);
  const club=source.slice(source.indexOf("  function renderClubGoRequest("),source.indexOf("  function setReviewSummary("));
  const candidate=source.slice(source.indexOf("  function renderCandidateGoRequests("),source.indexOf("  // Independent candidate-wide presentation"));
  assert.doesNotMatch(club,/acceptanceSnapshot|acceptanceCatalog|acceptanceSha|candidateGoRequests/);
  assert.doesNotMatch(candidate,/state\.reviewSummary|clubGoRequest|operationsSha|uatBlockers/);
  for(const segment of [helper,club,candidate])assert.doesNotMatch(segment,/<(?:button|input|textarea|form|a)\b|contenteditable|mailto:|clipboard|Storage|\.addEventListener|\bapi\(|\bfetch\(|\.submit\(/);
  assert.match(css,/\.go-request-text \{ white-space:pre-wrap; overflow-wrap:anywhere/);
  assert.match(css,/summary:focus-visible/);
});

async function packageHarness(){const h=await harness();await h.open();await h.ops();await h.select();await h.review();await h.check();return h;}
test("Local manifest check is explicit and scoped; no context or denied/demo role cannot read files",async()=>{
  for(const options of [{},{role:"manager"},{signedIn:false},{demo:true}]){
    const h=await harness(options);await h.open();let reads=0;
    for(const domain of ["club","get"]){
      await h.selectPackage(domain,{}, {size:100,text:async()=>{reads++;return "{}";}});await h.packageReview(domain);
      assert.match(h.packageResult(domain),/No current owner\/admin source context/);
      assert.doesNotMatch(h.packageSummary(domain),/of \d+ PRESENT|MISSING;|UNKNOWN\.|79977c8/);
      assert.doesNotMatch(h.packageMissing(domain),/data-package-component=|data-package-part=/);
      assert.doesNotMatch(h.packageSteps(domain),/data-package-step=/);
      assert.doesNotMatch(h.packageStepsSummary(domain),/Preparation notes:|data-package-preparation-group=|Operations SHA:|Get SHA:/);
    }
    assert.equal(reads,0);
  }
  const h=await packageHarness();const count=h.calls.length;
  await h.selectPackage("club",clubPackage);await h.selectPackage("get",getPackage);
  assert.equal(h.packageResult("club"),"");assert.equal(h.packageResult("get"),"");assert.equal(h.calls.length,count);
});
test("Club manifest reports absent/unknown items and cannot grant UAT or pilot; Get remains independent",async()=>{
  const h=await packageHarness(),candidate=h.summary(),drafts=h.candidateDrafts(),blockers=h.get("#clubUatBlockers").innerHTML,count=h.calls.length;
  await h.selectPackage("club",clubPackage);await h.packageReview("club");
  assert.match(h.packageResult("club"),/Manifest incomplete/);assert.match(h.packageResult("club"),/1 of 13/);
  assert.match(h.packageResult("club"),/original-authority: UNKNOWN/);assert.match(h.packageResult("club"),/protected-deploy: MISSING/);
  assert.match(h.packageResult("club"),new RegExp(ORG));assert.match(h.packageResult("club"),/Verified GO: none/);
  assert.equal(h.summary(),candidate);assert.equal(h.candidateDrafts(),drafts);assert.equal(h.get("#clubUatBlockers").innerHTML,blockers);
  assert.equal(h.calls.length,count);assert.equal(h.storage.size,1);
  const empty=structuredClone(clubPackage);empty.items=[];await h.selectPackage("club",empty);await h.packageReview("club");assert.match(h.packageResult("club"),/0 of 13/);
  empty.items=[...getPackage.items.slice(0,10),...['two-synthetic-orgs','connection-freshness','club-wide-coverage'].map(id=>({id,state:"PRESENT"}))];
  await h.selectPackage("club",empty);await h.packageReview("club");assert.match(h.packageResult("club"),/All required items declared present/);
  assert.match(h.packageResult("club"),/Existing blockers stay open/);assert.match(h.packageResult("club"),/Verified GO: none/);
});
test("A blocked Operations source with native fractional timestamp supplies context only; source expiry clears both packages",async()=>{
  const h=await packageHarness();h.controls.preflight=operationsRead();h.controls.preflight.as_of="2026-10-21T10:00:00.123456Z";
  h.controls.preflight.status="blocked";h.controls.preflight.operations_runtime_sha=null;h.controls.preflight.checks.runtime_revision_matches="blocked";
  await h.ops();await h.selectPackage("club",clubPackage);await h.packageReview("club");assert.match(h.packageResult("club"),/1 of 13/);
  assert.match(h.get("#clubUatBlockers").innerHTML,/Runtime revision matches/);
  await h.selectPackage("get",getPackage);await h.packageReview("get");
  h.setNow(NOW+25*60*60*1000);await h.get("#operationsSha").run("input");
  for(const domain of ["club","get"]){assert.equal(h.packageResult(domain),"");assert.equal(h.get("#"+domain+"PackageFile").files.length,0);}
  assert.equal(h.get("#getPackageCheck").value,"");
});
test("All seven Get package scopes require exact actions and check-specific components, never claim verified GO",async()=>{
  const h=await packageHarness();await h.selectPackage("club",clubPackage);await h.packageReview("club");const club=h.packageResult("club"),count=h.calls.length;
  for(const c of golden.checks){
    const d=structuredClone(getPackage);d.checkId=c.id;d.actions=c.requiredGoActions;
    d.items=[...new Set([...getPackage.items.slice(0,10).map(x=>x.id),...c.requiredEvidence,...(c.requiresStateChangeGO?["separate-state-change-go"]:[])])].map(id=>({id,state:"PRESENT"}));
    await h.check(c.id);await h.selectPackage("get",d);await h.packageReview("get");
    assert.match(h.packageResult("get"),/All required items declared present/);assert.match(h.packageResult("get"),/NOT document or authority validation/);
    assert.match(h.packageResult("get"),/Execution NOT_RUN/);assert.match(h.packageResult("get"),/Verified GO: none/);
    assert.doesNotMatch(h.packageResult("get"),new RegExp(ORG));assert.equal(h.packageResult("club"),club);
  }
  assert.equal(h.calls.length,count);assert.equal(h.storage.size,1);
});
test("Manifest rejects foreign domains/orgs/SHA/check/actions, expiry, unknown or duplicate components and unsafe flags without raw data",async()=>{
  const h=await packageHarness();const mutations=[d=>d.schemaVersion=2,d=>d.mode="RUN",d=>d.domain="club",d=>d.organisationId=ORG,
    d=>d.sourceSha="a".repeat(40),d=>d.checkId="hosted-ui",d=>d.authorityVerified=true,d=>d.executionEnabled=true,
    d=>d.asOf="2026-10-20T10:29:59Z",d=>d.asOf="2026-10-21T10:30:01Z",d=>d.asOf="2026-02-30T10:00:00Z",
    d=>d.reviewUntil="2026-10-21T10:30:00Z",d=>d.reviewUntil="2026-10-22T10:20:01Z",d=>d.reviewUntil="SECRET",
    d=>d.actions.push("production-deploy"),d=>d.actions.reverse(),d=>d.items.push(d.items[0]),d=>d.items[0].id="SECRET<img>",
    d=>d.items[0].state="APPROVED",d=>d.items[0].url="SECRET",d=>d.token="SECRET",d=>d.items=null,d=>d.items[0]=null];
  for(const mutate of mutations){
    await h.selectPackage("get",getPackage);await h.packageReview("get");assert.match(h.packageResult("get"),/All required/);
    const d=structuredClone(getPackage);mutate(d);await h.selectPackage("get",d);await h.packageReview("get");
    assert.match(h.packageResult("get"),/Manifest rejected/);assert.doesNotMatch(h.packageResult("get"),/SECRET|<img|All required/);
    assert.match(h.packageSummary("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageSummary("get"),/SECRET|<img|of \d+ PRESENT/);
    assert.match(h.packageMissing("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageMissing("get"),/SECRET|<img|data-package-component=/);
    assert.match(h.packageSteps("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageSteps("get"),/SECRET|<img|data-package-step=/);
    assert.match(h.packageStepsSummary("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageStepsSummary("get"),/SECRET|<img|Preparation notes:|data-package-preparation-group=|Get SHA:/);
  }
  for(const change of [d=>d.organisationId=OTHER,d=>d.sourceSha=SHA,d=>d.checkId="club-pilot",d=>d.actions.push("provider-fetch")]){
    const d=structuredClone(clubPackage);change(d);await h.selectPackage("club",d);await h.packageReview("club");assert.match(h.packageResult("club"),/Manifest rejected/);
  }
  for(const value of ["{","null","[]","{}"]){await h.selectPackage("get",value);await h.packageReview("get");assert.match(h.packageResult("get"),/Manifest rejected/);}
  assert.ok(h.calls.every(c=>c.method==="GET"));
});
test("Bounded files only, no automatic read; file exceptions are redacted and manifest expiry clears results",async()=>{
  const h=await packageHarness();let reads=0;
  for(const size of [0,-1,32769,NaN]){await h.selectPackage("get",{}, {size,text:async()=>{reads++;return "{}";}});await h.packageReview("get");}
  assert.equal(reads,0);
  for(const value of [null," ".repeat(32769)]){await h.selectPackage("get",{}, {size:100,text:async()=>value});await h.packageReview("get");assert.match(h.packageResult("get"),/Manifest rejected/);}
  await h.selectPackage("get",{}, {size:100,text:async()=>{throw Error("SECRET");}});await h.packageReview("get");assert.doesNotMatch(h.packageResult("get"),/SECRET/);
  await h.selectPackage("get",getPackage);await h.packageReview("get");h.setNow(NOW+60*60*1000);
  await h.get("#operationsSha").run("input");assert.match(h.packageResult("get"),/review window expired/);
  assert.match(h.packageSummary("get"),/review expired/);assert.doesNotMatch(h.packageSummary("get"),/of \d+ PRESENT/);
  assert.match(h.packageMissing("get"),/review expired/);assert.doesNotMatch(h.packageMissing("get"),/data-package-component=/);
  assert.match(h.packageSteps("get"),/review expired/);assert.doesNotMatch(h.packageSteps("get"),/data-package-step=/);
  assert.match(h.packageStepsSummary("get"),/review expired/);assert.doesNotMatch(h.packageStepsSummary("get"),/Preparation notes:|data-package-preparation-group=|Get SHA:/);
  assert.equal(h.get("#getPackageFile").files.length,0);
});
for(const action of ["club","tab","logout","401","get-sha","get-file","check","ops-sha","refresh"])
test(`Late manifest completion cannot rehydrate a superseded package: ${action}`,async()=>{
  const h=await packageHarness(),domain=action==="ops-sha"?"club":"get",wait=deferred();
  await h.selectPackage(domain,{}, {size:100,text:()=>wait.promise});const running=h.packageReview(domain);await settle();
  if(action==="club"){h.get("#orgSelect").value=OTHER;await h.get("#orgSelect").run("change");await settle();}
  if(action==="tab")await h.nav[0].run("click");if(action==="logout")await h.get("#signOut").run("click");
  if(action==="401"){h.controls.deny=true;await h.get("#refreshButton").run("click");await settle();}
  if(action==="get-sha"){h.get("#acceptanceSha").value="b".repeat(40);await h.get("#acceptanceSha").run("input");}
  if(action==="get-file")await h.select();if(action==="check")await h.check("hosted-ui");
  if(action==="ops-sha"){h.get("#operationsSha").value="b".repeat(40);await h.get("#operationsSha").run("input");}
  if(action==="refresh"){await h.get("#refreshButton").run("click");await settle();}
  wait.resolve(JSON.stringify(domain==="club"?clubPackage:getPackage));await running;
  assert.equal(h.packageResult(domain),"");assert.equal(h.get("#"+domain+"PackageFile").files.length,0);
  assert.doesNotMatch(h.packageSummary(domain),/of \d+ PRESENT|MISSING;|UNKNOWN\./);
  assert.doesNotMatch(h.packageMissing(domain),/data-package-component=/);
  assert.doesNotMatch(h.packageSteps(domain),/data-package-step=/);
  assert.doesNotMatch(h.packageStepsSummary(domain),/Preparation notes:|data-package-preparation-group=|Operations SHA:|Get SHA:/);
  if(["tab","logout","401"].includes(action))assert.equal(h.packageSummary(domain),"");
  if(["tab","logout","401"].includes(action))assert.equal(h.packageMissing(domain),"");
  if(["tab","logout","401"].includes(action))assert.equal(h.packageSteps(domain),"");
  if(["tab","logout","401"].includes(action))assert.equal(h.packageStepsSummary(domain),"");
});
test("Late manifest failure cannot erase a newer result; Get edits do not erase club package",async()=>{
  const h=await packageHarness();await h.selectPackage("club",clubPackage);await h.packageReview("club");const club=h.packageResult("club"),old=deferred();
  await h.selectPackage("get",{}, {size:100,text:()=>old.promise});const running=h.packageReview("get");await settle();
  await h.selectPackage("get",getPackage);await h.packageReview("get");const current=h.packageResult("get"),summary=h.packageSummary("get"),clubSummary=h.packageSummary("club"),missing=h.packageMissing("get"),clubMissing=h.packageMissing("club"),steps=h.packageSteps("get"),clubSteps=h.packageSteps("club");
  const prepSummary=h.packageStepsSummary("get"),clubPrepSummary=h.packageStepsSummary("club");old.reject(Error("SECRET"));await running;
  assert.equal(h.packageResult("get"),current);assert.equal(h.packageSummary("get"),summary);
  assert.equal(h.packageMissing("get"),missing);
  assert.equal(h.packageSteps("get"),steps);
  assert.equal(h.packageStepsSummary("get"),prepSummary);
  await h.select();assert.equal(h.packageResult("club"),club);assert.equal(h.packageSummary("club"),clubSummary);assert.equal(h.packageResult("get"),"");
  assert.equal(h.packageMissing("club"),clubMissing);assert.doesNotMatch(h.packageMissing("get"),/data-package-component=/);
  assert.equal(h.packageSteps("club"),clubSteps);assert.doesNotMatch(h.packageSteps("get"),/data-package-step=/);
  assert.equal(h.packageStepsSummary("club"),clubPrepSummary);assert.doesNotMatch(h.packageStepsSummary("get"),/Preparation notes:|data-package-preparation-group=|Get SHA:/);
});
test("Manifest inspection stays local, has labelled independent regions and no network, credential, clipboard or approval transport",()=>{
  const segment=source.slice(source.indexOf("  const goPackageCommon ="),source.indexOf("  async function load()"));
  assert.doesNotMatch(segment,/\bfetch\(|\bapi\(|Storage|FormData|clipboard|mailto:|setInterval|setTimeout|serviceWorker|\.submit\(/);
  const html=readFileSync("platform/public/fill/index.html","utf8");
  for(const domain of ["club","get"]){assert.match(html,new RegExp('aria-labelledby="'+domain+'PackageHeading"'));assert.match(html,new RegExp('id="'+domain+'PackageResult" role="status" aria-live="polite"'));}
  assert.match(html,/Declared completeness is not permission/);
  assert.match(html,/<span id="getPackageCheckLabel">GetACourt package check<\/span>/);
  assert.match(html,/id="getPackageCheck"[^>]*aria-labelledby="getPackageCheckLabel"/);
});

test("Package summaries start without invented counts and selection alone never reads a manifest",async()=>{
  const h=await harness();await h.open();
  for(const d of ["club","get"])assert.match(h.packageSummary(d),/No current source\/check context/);
  await h.ops();await h.select();await h.review();await h.check();
  for(const d of ["club","get"])assert.match(h.packageSummary(d),/No local package reviewed/);
  let reads=0;const calls=h.calls.length;
  await h.selectPackage("get",{}, {size:100,text:async()=>{reads++;return JSON.stringify(getPackage);}});
  assert.equal(reads,0);assert.doesNotMatch(h.packageSummary("get"),/of \d+ PRESENT/);
  await h.packageReview("get");assert.equal(reads,1);assert.equal(h.calls.length,calls);
  await h.get("#provenanceAge").run("input");assert.equal(reads,1);assert.equal(h.calls.length,calls);
});
test("Adjacent summaries preserve exact separate counts, source/check/time and blockers without combined authority",async()=>{
  const h=await packageHarness(),blockers=h.get("#clubUatBlockers").innerHTML,candidate=h.summary(),calls=h.calls.length;
  await h.selectPackage("club",clubPackage);await h.packageReview("club");const club=h.packageSummary("club");
  assert.match(club,/1 of 13 PRESENT/);assert.match(club,/11 MISSING; 1 UNKNOWN/);assert.match(club,/Incomplete declarations/);
  assert.match(club,new RegExp(ORG));assert.match(club,/Operations SHA/);assert.doesNotMatch(club,new RegExp(SHA));
  await h.selectPackage("get",getPackage);await h.packageReview("get");const get=h.packageSummary("get");
  assert.match(get,/15 of 15 PRESENT/);assert.match(get,/0 MISSING; 0 UNKNOWN/);assert.match(get,/check google-oauth/);
  assert.match(get,new RegExp(SHA));assert.doesNotMatch(get,new RegExp(ORG));assert.match(get,/2026-10-21T10:20:00Z/);
  for(const summary of [club,get]){assert.match(summary,/Verified GO: none/);assert.match(summary,/Execution NOT_RUN/);assert.match(summary,/Existing blockers stay open/);assert.doesNotMatch(summary,/<(?:button|form|input|a)\b/);}
  assert.match(get,/All declared — independent manual review still required/);
  assert.equal(h.packageSummary("club"),club);assert.equal(h.get("#clubUatBlockers").innerHTML,blockers);assert.equal(h.summary(),candidate);
  assert.equal(h.calls.length,calls);assert.equal(h.storage.size,1);
});
test("Mixed package items are counted independently of report missing-GO flags; missing inventory is not clearance",async()=>{
  const h=await packageHarness(),d=structuredClone(getPackage);d.items[0].state="UNKNOWN";d.items[1].state="MISSING";d.items.pop();
  await h.selectPackage("get",d);await h.packageReview("get");assert.match(h.packageSummary("get"),/12 of 15 PRESENT/);
  assert.match(h.packageSummary("get"),/2 MISSING; 1 UNKNOWN/);assert.match(h.summary(),/missing \/ invalid: 7 of 7/);
  assert.match(h.get("#clubUatBlockers").innerHTML,/Owner UAT GO/);
});
test("Loading and failed local files drop summary counts immediately; late completion cannot keep old metadata",async()=>{
  const h=await packageHarness();await h.selectPackage("get",getPackage);await h.packageReview("get");const old=deferred();
  await h.selectPackage("get",{}, {size:100,text:()=>old.promise});const run=h.packageReview("get");await settle();
  assert.match(h.packageSummary("get"),/read in progress/);assert.doesNotMatch(h.packageSummary("get"),/of \d+ PRESENT|79977c8/);
  old.reject(Error("SECRET"));await run;assert.match(h.packageSummary("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageSummary("get"),/SECRET|of \d+ PRESENT/);
});
test("Completed summaries and files clear on scope loss; a new club has no carried-over package counts",async()=>{
  for(const action of ["club","tab","logout","401"]){
    const h=await packageHarness();await h.selectPackage("club",clubPackage);await h.packageReview("club");await h.selectPackage("get",getPackage);await h.packageReview("get");
    if(action==="club"){h.get("#orgSelect").value=OTHER;await h.get("#orgSelect").run("change");await settle();}
    if(action==="tab")await h.nav[0].run("click");if(action==="logout")await h.get("#signOut").run("click");
    if(action==="401"){h.controls.deny=true;await h.get("#refreshButton").run("click");await settle();}
    for(const d of ["club","get"]){assert.doesNotMatch(h.packageSummary(d),/of \d+ PRESENT|79977c8/);assert.doesNotMatch(h.packageMissing(d),/data-package-component=/);assert.doesNotMatch(h.packageSteps(d),/data-package-step=/);assert.doesNotMatch(h.packageStepsSummary(d),/Preparation notes:|data-package-preparation-group=|Operations SHA:|Get SHA:/);if(action!=="club"){assert.equal(h.packageSummary(d),"");assert.equal(h.packageMissing(d),"");assert.equal(h.packageSteps(d),"");assert.equal(h.packageStepsSummary(d),"");}}
  }
});

const partIDs=(html,status)=>[...html.matchAll(new RegExp('data-package-part="'+status+'" data-package-component="([^"]+)"','g'))].map(m=>m[1]);
test("Missing-part lists are opt-in only, exact per-domain groups; PRESENT is never listed or treated as GO",async()=>{
  const h=await packageHarness(),calls=h.calls.length,blockers=h.get("#clubUatBlockers").innerHTML,candidate=h.summary();
  for(const d of ["club","get"])assert.match(h.packageMissing(d),/No local package reviewed/);
  await h.selectPackage("club",clubPackage);assert.doesNotMatch(h.packageMissing("club"),/data-package-component=/);await h.packageReview("club");
  assert.deepEqual(partIDs(h.packageMissing("club"),"UNKNOWN"),["original-authority"]);
  assert.deepEqual(partIDs(h.packageMissing("club"),"MISSING"),["protected-deploy","independent-runtime","isolation","tester-consent","scope-allowlist","current-evidence","unresolved-blockers","expiry-revocation-stop","two-synthetic-orgs","connection-freshness","club-wide-coverage"]);
  assert.doesNotMatch(h.packageMissing("club"),/data-package-component="source-binding"/);
  assert.match(h.packageMissing("club"),/Original approval and delegation/);assert.match(h.packageMissing("club"),/Declared UNKNOWN \(1\)/);
  const club=h.packageMissing("club"),clubSummary=h.packageSummary("club");await h.selectPackage("get",getPackage);await h.packageReview("get");
  assert.doesNotMatch(h.packageMissing("get"),/data-package-component=/);assert.match(h.packageMissing("get"),/No components declared MISSING or UNKNOWN/);
  assert.match(h.packageMissing("get"),/Original evidence and GO remain unverified; do not execute/);
  assert.equal(h.packageMissing("club"),club);assert.equal(h.packageSummary("club"),clubSummary);
  assert.equal(h.get("#clubUatBlockers").innerHTML,blockers);assert.equal(h.summary(),candidate);assert.equal(h.calls.length,calls);assert.equal(h.storage.size,1);
});
test("Mixed Get list identifies exact missing/unknown parts only, including separate state-change GO, without club parts",async()=>{
  const h=await packageHarness(),d=structuredClone(getPackage);d.items[0].state="UNKNOWN";d.items[1].state="MISSING";d.items.pop();
  await h.selectPackage("get",d);await h.packageReview("get");
  assert.deepEqual(partIDs(h.packageMissing("get"),"MISSING"),["source-binding","separate-state-change-go"]);
  assert.deepEqual(partIDs(h.packageMissing("get"),"UNKNOWN"),["original-authority"]);
  assert.doesNotMatch(h.packageMissing("get"),/data-package-component="(?:two-synthetic-orgs|connection-freshness|club-wide-coverage)"/);
  assert.match(h.packageSummary("get"),/2 MISSING; 1 UNKNOWN/);
});
test("All seven Get types retain only their own unresolved component catalog and no club evidence",async()=>{
  const h=await packageHarness();
  for(const c of golden.checks){const d=structuredClone(getPackage);d.checkId=c.id;d.actions=c.requiredGoActions;
    const ids=[...new Set([...getPackage.items.slice(0,10).map(x=>x.id),...c.requiredEvidence,...(c.requiresStateChangeGO?["separate-state-change-go"]:[])])];
    d.items=ids.map(id=>({id,state:"UNKNOWN"}));await h.check(c.id);await h.selectPackage("get",d);await h.packageReview("get");
    assert.deepEqual(partIDs(h.packageMissing("get"),"UNKNOWN"),ids);assert.deepEqual(partIDs(h.packageMissing("get"),"MISSING"),[]);
    assert.doesNotMatch(h.packageMissing("get"),/undefined|data-package-component="club-wide-coverage"/);
  }
});
test("New file/loading/error cannot keep previous missing-item identities; source expiry clears the list",async()=>{
  const h=await packageHarness(),d=structuredClone(getPackage);d.items=[];await h.selectPackage("get",d);await h.packageReview("get");
  assert.equal(partIDs(h.packageMissing("get"),"MISSING").length,15);
  const wait=deferred();await h.selectPackage("get",{}, {size:100,text:()=>wait.promise});const run=h.packageReview("get");await settle();
  assert.match(h.packageMissing("get"),/read in progress/);assert.doesNotMatch(h.packageMissing("get"),/data-package-component=/);
  wait.reject(Error("SECRET"));await run;assert.match(h.packageMissing("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageMissing("get"),/SECRET|data-package-component=/);
  await h.selectPackage("get",d);await h.packageReview("get");h.setNow(NOW+25*60*60*1000);await h.get("#operationsSha").run("input");
  assert.doesNotMatch(h.packageMissing("get"),/data-package-component=/);
});
test("Missing-part panels are labelled read-only siblings of summaries; helper is escaped and has no transport or decision side effects",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  for(const d of ["club","get"]){assert.match(html,new RegExp('aria-labelledby="'+d+'PackageMissingHeading"'));assert.match(html,new RegExp('id="'+d+'PackageMissing" role="status" aria-live="polite" aria-atomic="true"'));assert.ok(html.indexOf('id="'+d+'PackageMissing"')>html.indexOf('id="'+d+'PackageSummary"'));}
  const helper=source.slice(source.indexOf("  function goPackageMissingHTML("),source.indexOf("  // Presentation only of one domain"));
  assert.match(helper,/esc\(row.id\)/);assert.match(helper,/esc\(goPackagePartLabels/);
  assert.doesNotMatch(helper,/\.text\(|\.files|\bapi\(|\bfetch\(|Storage|clipboard|setTimeout|setInterval|state\.|goPackageState|<button|<form|<input|<a /);
});
test("Package summary presentation has distinct accessible regions by blockers and no reads, side effects or shared decision",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  for(const d of ["club","get"]){assert.match(html,new RegExp('aria-labelledby="'+d+'PackageSummaryHeading"'));assert.match(html,new RegExp('id="'+d+'PackageSummary" role="status" aria-live="polite" aria-atomic="true"'));}
  assert.ok(html.indexOf('id="clubPackageSummary"')>html.indexOf('id="clubUatBlockers"'));
  assert.ok(html.indexOf('id="clubPackageSummary"')<html.indexOf('id="clubNextSteps"'));
  assert.ok(html.indexOf('id="getPackageSummary"')>html.indexOf('id="acceptanceSummary"'));
  assert.ok(html.indexOf('id="getPackageSummary"')<html.indexOf('id="candidateNextSteps"'));
  const segment=source.slice(source.indexOf("  function renderGoPackageSummary("),source.indexOf("  function clearGoPackage("));
  assert.doesNotMatch(segment,/\.text\(|\.files|\bapi\(|\bfetch\(|Storage|clipboard|\.addEventListener|setTimeout|setInterval|uatBlockers|acceptanceSummary|reviewSummary\s*=/);
});

const stepIDs=(html,status)=>[...html.matchAll(/data-package-step="([^"]+)" data-package-step-state="([^"]+)"/g)].filter(m=>m[2]===status).map(m=>m[1]);

test("Preparation is explicit local presentation of unresolved club parts only; PRESENT and no context infer no steps",async()=>{
  const h=await harness();await h.open();
  for(const d of ["club","get"])assert.match(h.packageSteps(d),/No current source\/check context/);
  await h.ops();await h.select();await h.review();await h.check();
  const calls=h.calls.length,blockers=h.get("#clubUatBlockers").innerHTML,candidate=h.summary();let reads=0;
  for(const d of ["club","get"])assert.match(h.packageSteps(d),/No local package reviewed/);
  await h.selectPackage("club",{}, {size:100,text:async()=>{reads++;return JSON.stringify(clubPackage);}});
  assert.equal(reads,0);assert.doesNotMatch(h.packageSteps("club"),/data-package-step=/);
  await h.packageReview("club");assert.equal(reads,1);
  assert.deepEqual(stepIDs(h.packageSteps("club"),"MISSING"),partIDs(h.packageMissing("club"),"MISSING"));
  assert.deepEqual(stepIDs(h.packageSteps("club"),"UNKNOWN"),["original-authority"]);
  assert.doesNotMatch(h.packageSteps("club"),/data-package-step="source-binding"|data-package-step-state="PRESENT"/);
  assert.match(h.packageSteps("club"),/Uncertainty is unresolved; independent review is needed/);
  assert.match(h.packageSteps("club"),/two already authorised synthetic organisations/);
  assert.match(h.packageSteps("club"),/Do not infer a provider SLA/);
  const club=h.packageSteps("club");await h.selectPackage("get",getPackage);await h.packageReview("get");
  assert.doesNotMatch(h.packageSteps("get"),/data-package-step=/);assert.match(h.packageSteps("get"),/Independent original-evidence and authority review is still required/);
  for(const d of ["club","get"]){assert.match(h.packageSteps(d),/Verified GO: none\. Execution NOT_RUN/);assert.doesNotMatch(h.packageSteps(d),/<(?:button|input|form|a)\b/);}
  assert.equal(h.packageSteps("club"),club);assert.equal(h.calls.length,calls);assert.equal(h.storage.size,1);
  assert.equal(h.get("#clubUatBlockers").innerHTML,blockers);assert.equal(h.summary(),candidate);
});

test("Preparation keeps club Operations/org binding separate from Get SHA/single-check and state-change GO",async()=>{
  const h=await packageHarness(),c=structuredClone(clubPackage),g=structuredClone(getPackage);
  c.items.find(x=>x.id==="source-binding").state="MISSING";await h.selectPackage("club",c);await h.packageReview("club");
  assert.match(h.packageSteps("club"),/selected organisation and exact Operations SHA/);
  assert.match(h.packageSteps("club"),/exact club read-only GET routes/);
  const club=h.packageSteps("club");g.items[0].state="UNKNOWN";g.items[1].state="MISSING";g.items.pop();
  await h.selectPackage("get",g);await h.packageReview("get");
  assert.deepEqual(stepIDs(h.packageSteps("get"),"MISSING"),["source-binding","separate-state-change-go"]);
  assert.deepEqual(stepIDs(h.packageSteps("get"),"UNKNOWN"),["original-authority"]);
  assert.match(h.packageSteps("get"),/exact Get SHA and this single selected check/);
  assert.match(h.packageSteps("get"),/separate original GO for this exact OAuth or location state change/);
  assert.doesNotMatch(h.packageSteps("get"),/data-package-step="(?:two-synthetic-orgs|connection-freshness|club-wide-coverage)"/);
  assert.equal(h.packageSteps("club"),club);assert.match(h.summary(),/missing \/ invalid: 7 of 7/);
});

test("All seven Get checks have exact component-specific preparation, not a combined GO or a collection workflow",async()=>{
  const h=await packageHarness();
  for(const c of golden.checks){const d=structuredClone(getPackage);d.checkId=c.id;d.actions=c.requiredGoActions;
    const ids=[...new Set([...getPackage.items.slice(0,10).map(x=>x.id),...c.requiredEvidence,...(c.requiresStateChangeGO?["separate-state-change-go"]:[])])];
    d.items=ids.map(id=>({id,state:"UNKNOWN"}));await h.check(c.id);await h.selectPackage("get",d);await h.packageReview("get");
    const html=h.packageSteps("get");assert.deepEqual(stepIDs(html,"UNKNOWN"),ids);assert.deepEqual(stepIDs(html,"MISSING"),[]);
    assert.doesNotMatch(html,/undefined|no preparation action inferred|data-package-step="club-wide-coverage"/);
    assert.match(html,/this selected Get check and its exact local action allowlist/);
    assert.match(html,/not an execution order, assignment or evidence collection/);
    assert.equal(html.includes('data-package-step="separate-state-change-go"'),c.requiresStateChangeGO);
  }
});

test("Previous preparation identities clear before new local read, on failure and source expiry",async()=>{
  const h=await packageHarness(),d=structuredClone(getPackage);d.items=[];
  await h.selectPackage("get",d);await h.packageReview("get");assert.equal(stepIDs(h.packageSteps("get"),"MISSING").length,15);
  const wait=deferred();await h.selectPackage("get",{}, {size:100,text:()=>wait.promise});assert.doesNotMatch(h.packageSteps("get"),/data-package-step=/);
  const run=h.packageReview("get");await settle();assert.match(h.packageSteps("get"),/read in progress/);
  wait.reject(Error("SECRET"));await run;assert.match(h.packageSteps("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageSteps("get"),/SECRET|data-package-step=/);
  await h.selectPackage("get",d);await h.packageReview("get");h.setNow(NOW+25*60*60*1000);await h.get("#operationsSha").run("input");
  assert.doesNotMatch(h.packageSteps("get"),/data-package-step=/);
});

test("Preparation panels are accessible separate read-only regions; fixed escaped helper has no transport or authority side effects",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  for(const d of ["club","get"]){assert.match(html,new RegExp('aria-labelledby="'+d+'PackageStepsHeading"'));assert.match(html,new RegExp('id="'+d+'PackageSteps" role="status" aria-live="polite" aria-atomic="true"'));assert.ok(html.indexOf('id="'+d+'PackageSteps"')>html.indexOf('id="'+d+'PackageMissing"'));}
  const helper=source.slice(source.indexOf("  function goPackageStepsHTML("),source.indexOf("  // Presentation only of one domain"));
  for(const literal of ["esc(row.id)","esc(row.status)","esc(goPackagePartLabels","esc(notes[row.id]"])assert.ok(helper.includes(literal));
  assert.doesNotMatch(helper,/\.text\(|\.files|\bapi\(|\bfetch\(|Storage|clipboard|setTimeout|setInterval|state\.|goPackageState|<button|<form|<input|<a /);
});

const preparationGroups=html=>[...html.matchAll(/data-package-preparation-group="([^"]+)">[^<]*: (\d+) MISSING; (\d+) UNKNOWN\./g)].map(m=>({id:m[1],missing:Number(m[2]),unknown:Number(m[3])}));

test("Preparation snapshots never infer counts before explicit review; club notes retain exact scope and separate theme counts",async()=>{
  const h=await harness();await h.open();
  for(const d of ["club","get"])assert.match(h.packageStepsSummary(d),/No current source\/check context/);
  await h.ops();await h.select();await h.review();await h.check();let reads=0;
  const calls=h.calls.length,blockers=h.get("#clubUatBlockers").innerHTML,candidate=h.summary();
  for(const d of ["club","get"])assert.match(h.packageStepsSummary(d),/No local package reviewed/);
  await h.selectPackage("club",{}, {size:100,text:async()=>{reads++;return JSON.stringify(clubPackage);}});
  assert.equal(reads,0);assert.doesNotMatch(h.packageStepsSummary("club"),/Preparation notes:|data-package-preparation-group=/);
  await h.packageReview("club");const result=h.packageStepsSummary("club");assert.equal(reads,1);
  assert.match(result,/Preparation notes: <strong>12<\/strong>; 11 MISSING; 1 UNKNOWN/);
  assert.match(result,new RegExp(ORG));assert.match(result,new RegExp("a".repeat(40)));assert.match(result,/Operations SHA:/);assert.doesNotMatch(result,new RegExp(SHA));
  assert.deepEqual(preparationGroups(result),[{id:"authority-source",missing:0,unknown:1},{id:"runtime-isolation",missing:4,unknown:0},{id:"consent-device",missing:1,unknown:0},{id:"evidence-scope-stop",missing:6,unknown:0}]);
  assert.match(result,/UNKNOWN remains unresolved, not proven absence/);assert.match(result,/not work completed, verified evidence or readiness/);
  assert.match(result,/Not pilot or GetACourt GO/);assert.match(result,/Verified GO: none\. Execution NOT_RUN/);
  assert.equal(h.calls.length,calls);assert.equal(h.storage.size,1);assert.equal(h.summary(),candidate);assert.equal(h.get("#clubUatBlockers").innerHTML,blockers);
});

test("Mixed Get preparation snapshot summarises only its check, never club counts or an execution order",async()=>{
  const h=await packageHarness();await h.selectPackage("club",clubPackage);await h.packageReview("club");
  const club=h.packageStepsSummary("club"),notes=h.packageSteps("club"),summary=h.packageSummary("club"),missing=h.packageMissing("club"),blockers=h.get("#clubUatBlockers").innerHTML,candidate=h.summary(),calls=h.calls.length;
  const d=structuredClone(getPackage);d.items[0].state="UNKNOWN";d.items[1].state="MISSING";d.items.pop();await h.selectPackage("get",d);await h.packageReview("get");
  const result=h.packageStepsSummary("get");assert.match(result,/Preparation notes: <strong>3<\/strong>; 2 MISSING; 1 UNKNOWN/);
  assert.deepEqual(preparationGroups(result),[{id:"authority-source",missing:1,unknown:1},{id:"consent-device",missing:1,unknown:0}]);
  assert.match(result,new RegExp(SHA));assert.match(result,/check google-oauth/);assert.doesNotMatch(result,new RegExp(ORG));assert.doesNotMatch(result,/Operations SHA/);
  assert.match(result,/Not club UAT or pilot GO/);assert.match(result,/not an execution order, assignment or evidence collection/);
  assert.equal(h.packageStepsSummary("club"),club);assert.equal(h.packageSteps("club"),notes);assert.equal(h.packageSummary("club"),summary);assert.equal(h.packageMissing("club"),missing);
  assert.equal(h.summary(),candidate);assert.equal(h.get("#clubUatBlockers").innerHTML,blockers);assert.equal(h.calls.length,calls);
});

test("All-declared packages infer no preparation themes and never imply acceptance or GO",async()=>{
  const h=await packageHarness();
  for(const [domain,fixture] of [["club",clubPackage],["get",getPackage]]){
    const d=structuredClone(fixture);
    if(domain==="club")d.items=[...getPackage.items.slice(0,10).map(x=>x.id),"two-synthetic-orgs","connection-freshness","club-wide-coverage"].map(id=>({id,state:"PRESENT"}));
    else d.items.forEach(x=>x.state="PRESENT");await h.selectPackage(domain,d);await h.packageReview(domain);
    const result=h.packageStepsSummary(domain);assert.equal(preparationGroups(result).length,0);assert.doesNotMatch(result,/Preparation notes:|\d+ MISSING|\d+ UNKNOWN/);
    assert.match(result,/Absence of notes is not approval/);assert.match(result,/Independent original-evidence and authority review still required/);assert.match(result,/Existing blockers stay open; do not execute/);
    assert.match(result,/Verified GO: none\. Execution NOT_RUN/);assert.doesNotMatch(result,/<(?:button|input|form|a)\b/);
  }
});

test("Every unresolved component in all seven Get catalogs appears in exactly one preparation theme",async()=>{
  const h=await packageHarness();
  for(const c of golden.checks){const d=structuredClone(getPackage);d.checkId=c.id;d.actions=c.requiredGoActions;
    const ids=[...new Set([...getPackage.items.slice(0,10).map(x=>x.id),...c.requiredEvidence,...(c.requiresStateChangeGO?["separate-state-change-go"]:[])])];
    for(const status of ["MISSING","UNKNOWN"]){d.items=ids.map(id=>({id,state:status}));await h.check(c.id);await h.selectPackage("get",d);await h.packageReview("get");
      const result=h.packageStepsSummary("get"),groups=preparationGroups(result);assert.equal(groups.length,4);assert.equal(new Set(groups.map(x=>x.id)).size,4);
      assert.equal(groups.reduce((n,g)=>n+g.missing,0),status==="MISSING"?ids.length:0);assert.equal(groups.reduce((n,g)=>n+g.unknown,0),status==="UNKNOWN"?ids.length:0);
      assert.match(result,new RegExp("check "+c.id));assert.doesNotMatch(result,/undefined|Operations SHA:|organisation <code>/);
      assert.equal(stepIDs(h.packageSteps("get"),status).length,ids.length);
    }
    for(const unresolved of ids){d.items=ids.map(id=>({id,state:id===unresolved?"UNKNOWN":"PRESENT"}));await h.selectPackage("get",d);await h.packageReview("get");
      const groups=preparationGroups(h.packageStepsSummary("get"));assert.equal(groups.length,1,unresolved);assert.equal(groups[0].missing,0);assert.equal(groups[0].unknown,1);
    }
  }
});

test("Loading/failure/source expiry remove previous preparation summary counts and identity",async()=>{
  const h=await packageHarness(),d=structuredClone(getPackage);d.items=[];await h.selectPackage("get",d);await h.packageReview("get");assert.match(h.packageStepsSummary("get"),/Preparation notes: <strong>15/);
  const wait=deferred();await h.selectPackage("get",{}, {size:100,text:()=>wait.promise});assert.doesNotMatch(h.packageStepsSummary("get"),/Preparation notes:|Get SHA:|data-package-preparation-group=/);
  const run=h.packageReview("get");await settle();assert.match(h.packageStepsSummary("get"),/read in progress/);
  wait.reject(Error("SECRET"));await run;assert.match(h.packageStepsSummary("get"),/rejected or unavailable/);assert.doesNotMatch(h.packageStepsSummary("get"),/SECRET|Preparation notes:|Get SHA:|data-package-preparation-group=/);
  await h.selectPackage("get",d);await h.packageReview("get");h.setNow(NOW+25*60*60*1000);await h.get("#operationsSha").run("input");assert.doesNotMatch(h.packageStepsSummary("get"),/Preparation notes:|Get SHA:|data-package-preparation-group=/);
});

test("Preparation snapshot regions are labelled, escaped and pure presentation of the same guarded local result",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  for(const d of ["club","get"]){assert.match(html,new RegExp('aria-labelledby="'+d+'PackageStepsSummaryHeading"'));assert.match(html,new RegExp('id="'+d+'PackageStepsSummary" role="status" aria-live="polite" aria-atomic="true"'));assert.ok(html.indexOf('id="'+d+'PackageStepsSummary"')<html.indexOf('id="'+d+'PackageSteps"'));}
  const helper=source.slice(source.indexOf("  function goPackageStepsSummaryHTML("),source.indexOf("  // Presentation only of one domain"));
  for(const literal of ["esc(organisation)","esc(ctx.sha)","esc(ctx.check)","esc(label)"])assert.ok(helper.includes(literal));
  assert.doesNotMatch(helper,/\.text\(|\.files|\bapi\(|\bfetch\(|Storage|clipboard|setTimeout|setInterval|state\.|goPackageState|<button|<form|<input|<a |\.addEventListener|\.submit\(/);
});
