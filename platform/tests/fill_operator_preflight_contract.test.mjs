import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync("platform/public/fill/app.js","utf8");
const ORG="11111111-1111-4111-8111-111111111111", OTHER="22222222-2222-4222-8222-222222222222";
const SHA="a".repeat(40), NEXT="b".repeat(40);
const PC="33333333-3333-4333-8333-333333333333", OTHER_PC="55555555-5555-4555-8555-555555555555";
const BOOK="44444444-4444-4444-8444-444444444444";
const checks=["operations_service","non_production_runtime","runtime_revision_matches",
  "provider_reads_disabled_in_this_api","owner_admin_scope","authenticated_rls_context",
  "repeatable_read_only","schema_rls_select","reader_columns_present","get_routes_present"];
const flags=["hosted_uat_ready","uat_accepted","pilot_ready","provider_requests_allowed",
  "can_display_available_slots","deploy_allowed"];
const ok=body=>({ok:true,status:200,json:async()=>body});
const denied=status=>({ok:false,status,json:async()=>({message:"PRIVATE_INTERNAL_DETAILS"})});
const settle=async()=>{await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));};
function pending(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function result(extra={}) {
  return {mode:"read_only_operations_preflight",contract_version:"provider-provenance-operations-preflight/v1",
    as_of:"2026-10-21T05:00:00Z",operations_runtime_sha:SHA,
    runtime_identity_source:"railway_build_environment_not_independent_attestation",
    status:"operations_checks_passed",checks:Object.fromEntries(checks.map(k=>[k,"pass"])),
    not_assessed:["external_runtime_identity","protected_host","two_org_hosted_uat",
      "worker_provider_read_state","fixture_provisioning","owner_uat_go"],
    ...Object.fromEntries(flags.map(k=>[k,false])),...extra};
}
function receipt(extra={}) {
  const authority={pilot_ready:false,provider_requests_allowed:false,can_display_available_slots:false};
  return {mode:"read_only_source_review",as_of:"2026-10-21T04:00:00Z",max_age_seconds:60,
    status:"needs_review",...authority,items:[{booking_id:BOOK,status:"missing_receipt_reference",...authority}],
    has_more:false,next_after_booking_id:null,...extra};
}
function node(dataset={}) {
  const handlers=new Map();let html="",content="";
  return {dataset,hidden:false,disabled:false,value:"",classList:{toggle(){}},
    get innerHTML(){return html;},set innerHTML(v){html=v;content="";},
    get textContent(){return content;},set textContent(v){content=v;html="";},
    addEventListener:(event,fn)=>handlers.set(event,fn),
    run:event=>handlers.get(event)?.({preventDefault(){}})};
}
async function harness(demo=false,clubName="SYNTHETIC A") {
  const el=new Map(),nav=["today","calendar","revenue","provenance"].map(view=>node({view}));
  const get=id=>{if(!el.has(id))el.set(id,node());return el.get(id);};
  const storage=new Map([["fill.access","fixture-session-only"]]),calls=[];
  const controls={preflight:()=>ok(result()),connections:()=>ok({items:[]}),report:()=>ok(receipt())};
  const fixture=path=>path==="/api/me"?{user:{email:"fixture@example.invalid"}}:
    path==="/api/fmc/organizations"?{items:[{id:ORG,name:clubName,role:"owner"},
      {id:OTHER,name:"SYNTHETIC B",role:"owner"}]}:
    path.includes("/today?")?{summary:{},courts:[],empty_windows:[]}:
    path.endsWith("/connections")?{items:[]}:null;
  const ctx={URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
    document:{querySelector:get,querySelectorAll:()=>nav},
    window:{FillDemo:{get:fixture}},
    location:{hostname:demo?"localhost":"fixture.invalid",hash:"",pathname:"/fill/",search:demo?"?demo=1":""},
    history:{replaceState(){}},localStorage:{removeItem(){}},
    sessionStorage:{getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    fetch:async(path,options={})=>{
      calls.push({path,method:options.method||"GET"});
      if(path.includes("/preflight?"))return controls.preflight(path);
      if(path.endsWith("/connections"))return controls.connections(path);
      if(path.includes("/provider-provenance/"))return controls.report(path);
      const data=fixture(path);if(data)return ok(data);
      throw Error("Unexpected fixture request");
    }};
  vm.runInNewContext(source,ctx);await settle();
  const open=()=>nav[3].run("click");
  const check=async(sha=SHA)=>{get("#operationsSha").value=sha;
    await get("#operationsSha").run("input");return get("#preflightForm").run("submit");};
  const review=async(connection=PC)=>{get("#provenanceConnection").value=connection;
    get("#provenanceAge").value="60";return get("#provenanceForm").run("submit");};
  const summary=()=>get("#clubReviewSummary").innerHTML;
  const blockers=()=>get("#clubUatBlockers").innerHTML;
  return {get,nav,storage,calls,controls,open,check,review,summary,blockers};
}

test("Club next steps keep UAT/pilot GO open after passed Operations and a consistent page",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  assert.match(h.get("#clubNextSteps").innerHTML,/data-club-next="club-operations"/);
  await h.check();
  h.controls.report=()=>ok(receipt({status:"page_consistent",items:[{...receipt().items[0],status:"consistent_internal_evidence"}]}));
  await h.review();
  const steps=h.get("#clubNextSteps").innerHTML;
  assert.doesNotMatch(steps,/data-club-next="club-operations"/);
  assert.match(steps,/data-club-next="club-provenance"/);assert.match(steps,/club-wide provenance coverage/);
  assert.match(steps,/data-club-next="club-uat-go"/);assert.match(steps,/data-club-next="club-pilot-go"/);
  assert.match(steps,/exact Operations SHA/);assert.match(steps,/two authorised synthetic organisations/);
  assert.match(steps,/existing protected deploy ID\/origin/);assert.doesNotMatch(steps,/data-candidate-go=|GO granted/);
});
test("Denied and incompatible club reads produce preparation notes without raw details or action controls",async()=>{
  const h=await harness(false,"PRIVATE<img>");await h.open();const calls=h.calls.length;
  h.controls.preflight=()=>denied(403);await h.check();
  assert.match(h.get("#clubNextSteps").innerHTML,/data-club-next="club-operations"/);
  assert.doesNotMatch(h.get("#clubNextSteps").innerHTML,/PRIVATE|<img|<button|<input|<form/);
  h.controls.preflight=()=>ok(result({private_extra:"PRIVATE"}));await h.check();
  assert.doesNotMatch(h.get("#clubNextSteps").innerHTML,/PRIVATE/);
  assert.equal(h.calls.length,calls+2);assert.ok(h.calls.every(c=>c.method==="GET"));
  h.get("#signOut").run("click");assert.equal(h.get("#clubNextSteps").innerHTML,"");assert.equal(h.get("#clubNextSteps").textContent,"");
});
test("Demo preparation notes never invent real club GO",async()=>{
  const h=await harness(true);await h.open();
  assert.match(h.get("#clubNextSteps").textContent,/Synthetic demo has no club GO/);
  assert.equal(h.get("#clubNextSteps").innerHTML,"");assert.equal(h.calls.length,0);
});

test("Club request uses only last-read scoped Operations SHA as unverified, clears it on edits/errors and never treats a pass as GO",async()=>{
  const h=await harness();await h.open();const draft=()=>h.get("#clubGoRequest").innerHTML;
  assert.doesNotMatch(draft(),new RegExp(SHA));
  await h.check();assert.match(draft(),new RegExp(SHA));assert.match(draft(),/NOT approved or independently attested/);
  assert.match(draft(),/unresolved blockers/);assert.match(draft(),/this draft clears none/);
  h.get("#operationsSha").value=NEXT;await h.get("#operationsSha").run("input");
  assert.doesNotMatch(draft(),new RegExp(SHA));assert.doesNotMatch(draft(),new RegExp(NEXT));
  for(const response of [()=>denied(403),()=>ok(result({extra:"PRIVATE<img>"}))]){
    await h.check();h.controls.preflight=response;await h.check();
    assert.doesNotMatch(draft(),new RegExp(SHA));assert.doesNotMatch(draft(),/PRIVATE|<img/);
  }
  assert.ok(h.calls.every(c=>c.method==="GET"));assert.equal(h.storage.size,1);
});
test("Old Operations responses cannot restore a SHA into a new club request or a closed scope",async()=>{
  for(const action of ["club","tab","logout","edit"]){
    const h=await harness();await h.open();const wait=pending();h.controls.preflight=()=>wait.promise;
    const running=h.check();await settle();
    if(action==="club"){h.get("#orgSelect").value=OTHER;await h.get("#orgSelect").run("change");await settle();}
    if(action==="tab")await h.nav[0].run("click");
    if(action==="logout")await h.get("#signOut").run("click");
    if(action==="edit"){h.get("#operationsSha").value=NEXT;await h.get("#operationsSha").run("input");}
    wait.resolve(ok(result()));await running;const draft=h.get("#clubGoRequest").innerHTML;
    assert.doesNotMatch(draft,new RegExp(SHA));
    if(["tab","logout"].includes(action))assert.equal(draft,"");
    if(action==="club"){assert.match(draft,new RegExp(OTHER));assert.doesNotMatch(draft,new RegExp(ORG));}
  }
  const demo=await harness(true);await demo.open();assert.equal(demo.get("#clubGoRequest").innerHTML,"");
});

test("Explicit Operations SHA and click only; no default, remembered revision, or automatic preflight",async()=>{
  const h=await harness();await h.open();
  assert.equal(h.get("#operationsSha").value,"");
  assert.equal(h.calls.filter(c=>c.path.includes("/preflight")).length,0);
  for(const bad of ["", "97bf92a", SHA.toUpperCase(), SHA+" ", "https://private.invalid", "<img src=x>"])
    await h.check(bad);
  assert.equal(h.calls.length,4);
  await h.check();
  assert.equal(h.calls.at(-1).path,`/api/fmc/${ORG}/provider-provenance/preflight?expected_operations_sha=${SHA}`);
  assert.ok(h.calls.every(c=>c.method==="GET"));
  assert.match(h.get("#preflightMessage").textContent,/passed — not UAT or pilot approval/);
  assert.match(h.get("#preflightReport").innerHTML,/self-reported|not independent/);
  assert.match(h.get("#preflightReport").innerHTML,/Separate worker|Owner UAT GO/);
  assert.equal(h.storage.size,1,"Expected SHA is not persisted");
  h.get("#operationsSha").value=NEXT;await h.get("#operationsSha").run("input");
  assert.equal(h.get("#preflightReport").innerHTML,"");
});

test("Blocked checks and missing runtime are visible, never promoted to readiness",async()=>{
  const h=await harness();await h.open();
  for(const runtime of [null,NEXT]) {
    h.controls.preflight=()=>ok(result({operations_runtime_sha:runtime,status:"blocked",
      checks:{...result().checks,runtime_revision_matches:"blocked"}}));
    await h.check();
    assert.match(h.get("#preflightMessage").textContent,/checks blocked/);
    assert.match(h.get("#preflightReport").innerHTML,/Blocked/);
    assert.match(h.get("#preflightReport").innerHTML,runtime?new RegExp(runtime):/Not reported/);
  }
});

test("Malformed, unsafe, contradictory, or future contracts fail closed without rendering raw values",async()=>{
  const h=await harness();await h.open();
  const invalid=[null,{},result({contract_version:"future/v2"}),result({mode:"write"}),
    result({as_of:"<img src=x>"}),result({as_of:"2026-10-21"}),
    result({operations_runtime_sha:"PRIVATE_INTERNAL_DETAILS"}),
    result({runtime_identity_source:"signed_attestation"}),result({status:"blocked"}),
    result({operations_runtime_sha:NEXT}),result({checks:{}}),
    result({checks:{...result().checks,owner_admin_scope:"yes"}}),
    result({checks:{...result().checks,private_extra:"pass"}}),
    result({checks:{...result().checks,owner_admin_scope:"blocked"}}),
    result({not_assessed:[]}),result({not_assessed:Array(6).fill("protected_host")}),
    result({not_assessed:[...result().not_assessed.slice(1),"<img src=x>"]}),
    result({private_extra:"PRIVATE_INTERNAL_DETAILS"}),
    ...flags.flatMap(flag=>[result({[flag]:true}),result({[flag]:null}),
      Object.fromEntries(Object.entries(result()).filter(([key])=>key!==flag))])];
  for(const data of invalid) {
    h.controls.preflight=()=>ok(result());await h.check();
    h.controls.preflight=()=>ok(data);await h.check();
    assert.equal(h.get("#preflightReport").innerHTML,"");
    assert.match(h.get("#preflightMessage").textContent,/unavailable or incompatible/);
    assert.doesNotMatch(h.get("#preflightMessage").textContent,/PRIVATE|<img/);
  }
});

test("403, old-runtime 404, 422, 503, malformed JSON and network failures clear old results and redact errors",async()=>{
  const h=await harness();await h.open();
  for(const reply of [()=>denied(403),()=>denied(404),()=>denied(422),()=>denied(503),
    ()=>({ok:true,status:200,json:async()=>{throw Error("PRIVATE_INTERNAL_DETAILS");}}),
    ()=>{throw Error("PRIVATE_INTERNAL_DETAILS");}]) {
    h.controls.preflight=()=>ok(result());await h.check();
    h.controls.preflight=reply;await h.check();
    assert.equal(h.get("#preflightReport").innerHTML,"");
    assert.match(h.get("#preflightMessage").textContent,/permission|unavailable/);
    assert.doesNotMatch(h.get("#preflightMessage").textContent,/PRIVATE/);
    assert.equal(h.get("#preflightCheck").disabled,false);
  }
});

for(const outcome of [200,401,403,"network"]) test(`Late ${outcome} from a previous org cannot overwrite or revoke the current scope`,async()=>{
  const h=await harness();await h.open();const old=pending();
  h.controls.preflight=()=>old.promise;const running=h.check();await settle();
  assert.equal(h.get("#preflightCheck").disabled,true);
  h.get("#orgSelect").value=OTHER;h.get("#orgSelect").run("change");await settle();
  assert.equal(h.get("#operationsSha").value,"");
  assert.equal(h.get("#preflightReport").innerHTML,"");
  h.controls.preflight=()=>ok(result({operations_runtime_sha:NEXT}));await h.check(NEXT);
  if(outcome==="network")old.reject(Error("PRIVATE"));
  else old.resolve(outcome===200?ok(result()):denied(outcome));
  await running;
  assert.match(h.get("#preflightReport").innerHTML,new RegExp(NEXT));
  assert.doesNotMatch(h.get("#preflightReport").innerHTML,new RegExp(SHA));
  assert.match(h.get("#preflightMessage").textContent,/checks passed/);
  assert.equal(h.get("#workspace").hidden,false);
  assert.equal(h.storage.size,1);
});

for(const action of ["edit","tab","logout"]) test(`Late response after ${action} cannot rehydrate cleared results`,async()=>{
  const h=await harness();await h.open();const old=pending();
  h.controls.preflight=()=>old.promise;const running=h.check();await settle();
  if(action==="edit") {h.get("#operationsSha").value=NEXT;h.get("#operationsSha").run("input");}
  if(action==="tab")await h.nav[0].run("click");
  if(action==="logout")h.get("#signOut").run("click");
  old.resolve(denied(401));await running;
  assert.equal(h.get("#preflightReport").innerHTML,"");
  assert.equal(h.get("#preflightMessage").textContent,"");
  assert.equal(h.storage.size,action==="logout"?0:1);
  assert.equal(h.get("#operationsSha").value,action==="edit"?NEXT:"");
});

test("Current 401 clears the whole session and all private preflight DOM",async()=>{
  const h=await harness();await h.open();await h.check();
  h.controls.preflight=()=>denied(401);await h.check();
  assert.equal(h.storage.size,0);assert.equal(h.get("#workspace").hidden,true);
  assert.equal(h.get("#operationsSha").value,"");
  assert.equal(h.get("#preflightReport").innerHTML,"");
  assert.equal(h.get("#preflightMessage").textContent,"");
});

test("Synthetic demo never sends a preflight API request or fabricates a pass",async()=>{
  const h=await harness(true);await h.open();await h.check();
  assert.equal(h.calls.length,0);
  assert.equal(h.get("#preflightReport").innerHTML,"");
  assert.match(h.get("#preflightMessage").textContent,/No API request was sent/);
});

test("Preflight controls have labels and permanent no-GO wording; CI runs this suite in both jobs",()=>{
  const html=readFileSync("platform/public/fill/index.html","utf8");
  assert.match(html,/aria-labelledby="preflightHeading"/);
  assert.match(html,/Expected Operations SHA<input[^>]*required[^>]*aria-describedby="operationsShaHelp"/);
  assert.match(html,/id="preflightMessage" role="status" aria-live="polite"/);
  assert.match(html,/No UAT or pilot approval/);
  const ci=readFileSync(".github/workflows/platform-ci.yml","utf8");
  assert.equal(ci.match(/node --test platform\/tests\/fill_operator_preflight_contract.test.mjs/g)?.length,2);
});

test("Club summary is local presentation only, scoped and escaped, with no automatic preflight/report",async()=>{
  const h=await harness(false,"SYNTHETIC <img src=x onerror=alert(1)>");
  assert.equal(h.summary(),"");await h.open();
  assert.equal(h.calls.length,4,"Only existing identity, Today and connection-list reads");
  assert.match(h.summary(),/No supported connections returned/);
  assert.match(h.summary(),/Not checked or reviewed/);
  assert.match(h.summary(),/SYNTHETIC &lt;img/);
  assert.doesNotMatch(h.summary(),/<img|checks passed|internally consistent/);
  assert.equal(h.storage.size,1);
  const html=readFileSync("platform/public/fill/index.html","utf8");
  assert.match(html,/id="clubReviewSummary" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/UAT and pilot not approved/);
  assert.match(html,/Separate snapshots, not a combined assessment or live state/);
  const render=source.slice(source.indexOf("  function renderReviewSummary()"),source.indexOf("  function setReviewSummary("));
  assert.doesNotMatch(render,/\bfetch\(|\bapi\(|Storage|setInterval|setTimeout/);
});

test("Summary preserves two independent snapshots, explicit parameters and latest-page-only counts",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});
  await h.open();await h.check();
  h.controls.report=()=>ok(receipt({has_more:true,next_after_booking_id:BOOK}));
  await h.review();
  assert.match(h.summary(),/Operations checks passed — not UAT approval/);
  assert.match(h.summary(),/2026-10-21T05:00:00Z/);assert.match(h.summary(),/2026-10-21T04:00:00Z/);
  assert.match(h.summary(),/bookings on this page: 1; internally consistent: 0; need review: 1/);
  assert.match(h.summary(),/First page only. More pages remain. Not a complete club report/);
  assert.match(h.summary(),/Maximum receipt age: 60 seconds/);
  assert.match(h.summary(),new RegExp(PC));assert.doesNotMatch(h.summary(),new RegExp(BOOK));
  const consistent={...receipt().items[0],status:"consistent_internal_evidence"};
  h.controls.report=()=>ok(receipt({status:"page_consistent",items:[consistent]}));
  await h.get("#provenanceNext").run("click");
  assert.match(h.summary(),/Continuation page only. No more pages after this snapshot/);
  assert.match(h.summary(),/bookings on this page: 1; internally consistent: 1; need review: 0/);
  assert.doesNotMatch(h.summary(),/bookings on this page: 2|First page|internally consistent: 0; need review: 1/);
  await h.check();assert.match(h.summary(),/Page internally consistent — not pilot approval/);
  assert.ok(h.calls.every(c=>c.method==="GET"));
});

test("Blocked Operations and empty receipt page do not create a readiness result",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  h.controls.preflight=()=>ok(result({operations_runtime_sha:null,status:"blocked",
    checks:{...result().checks,runtime_revision_matches:"blocked"}}));
  await h.check();
  h.controls.report=()=>ok(receipt({status:"no_shadow_bookings",items:[]}));await h.review();
  assert.match(h.summary(),/Operations checks blocked/);assert.match(h.summary(),/1 of 10 checks blocked; 6 gates not assessed/);
  assert.match(h.summary(),/Not reported/);assert.match(h.summary(),/No stored shadow bookings on this page/);
  assert.match(h.summary(),/bookings on this page: 0/);assert.match(h.summary(),/Not a complete club report/);
  assert.doesNotMatch(h.summary(),/checks passed|Page internally consistent/);
});

test("Repeated reads drop old summary immediately; concurrent components update independently",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});
  await h.open();await h.check();await h.review();
  const preflight=pending(),page=pending();
  h.controls.preflight=()=>preflight.promise;h.controls.report=()=>page.promise;
  const checking=h.check(),reviewing=h.review();await settle();
  assert.doesNotMatch(h.summary(),/Snapshot:|bookings on this page|Reported runtime SHA/);
  assert.equal((h.summary().match(/Read in progress/g)||[]).length,2);
  page.resolve(ok(receipt()));await reviewing;
  assert.match(h.summary(),/bookings on this page/);assert.match(h.summary(),/Read in progress/);
  preflight.resolve(ok(result()));await checking;
  assert.match(h.summary(),/Operations checks passed/);assert.match(h.summary(),/bookings on this page/);
});

test("Current denied, unavailable and malformed reads replace, never reuse, prior component summaries",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  for(const bad of [()=>denied(403),()=>denied(404),()=>denied(503),
    ()=>{throw Error("PRIVATE_INTERNAL_DETAILS");},()=>ok({pilot_ready:true,PRIVATE_INTERNAL_DETAILS:"x"})]) {
    h.controls.preflight=()=>ok(result());h.controls.report=()=>ok(receipt());await h.check();await h.review();
    h.controls.preflight=bad;await h.check();
    assert.doesNotMatch(h.summary(),/Operations checks passed|Reported runtime SHA|PRIVATE_INTERNAL/);
    assert.match(h.summary(),/bookings on this page/);
    h.controls.report=bad;await h.review();
    assert.doesNotMatch(h.summary(),/Snapshot:|bookings on this page|PRIVATE_INTERNAL/);
    assert.match(h.summary(),/Access denied|Unavailable or incompatible/);
  }
});

test("Editing one set of review parameters clears only that summary; leaving the tab clears hidden summary DOM",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});
  await h.open();await h.check();await h.review();
  h.get("#operationsSha").value=NEXT;h.get("#operationsSha").run("input");
  assert.doesNotMatch(h.summary(),/Reported runtime SHA/);assert.match(h.summary(),/bookings on this page/);
  await h.check();h.get("#provenanceAge").value="61";h.get("#provenanceAge").run("input");
  assert.doesNotMatch(h.summary(),/bookings on this page/);assert.match(h.summary(),/Operations checks passed/);
  await h.review();h.get("#provenanceConnection").run("change");
  assert.doesNotMatch(h.summary(),/bookings on this page/);assert.match(h.summary(),/Operations checks passed/);
  await h.nav[0].run("click");assert.equal(h.summary(),"");assert.equal(h.blockers(),"");
  await h.open();assert.doesNotMatch(h.summary(),/Operations checks passed|Snapshot:/);
  h.get("#orgSelect").value="";h.get("#orgSelect").run("change");await settle();assert.equal(h.summary(),"");assert.equal(h.blockers(),"");
});

for(const outcome of [200,401,403,"network"]) test(`Late ${outcome} for both reads cannot contaminate the next club summary`,async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  const preflight=pending(),page=pending();h.controls.preflight=()=>preflight.promise;h.controls.report=()=>page.promise;
  const checking=h.check(),reviewing=h.review();await settle();
  h.controls.connections=()=>ok({items:[{id:OTHER_PC,provider:"playtomic"}]});
  h.get("#orgSelect").value=OTHER;h.get("#orgSelect").run("change");await settle();
  assert.match(h.summary(),/SYNTHETIC B/);assert.doesNotMatch(h.summary(),/SYNTHETIC A|Snapshot:/);
  h.controls.preflight=()=>ok(result({operations_runtime_sha:NEXT}));h.controls.report=()=>ok(receipt());
  await h.check(NEXT);await h.review(OTHER_PC);
  if(outcome==="network") {preflight.reject(Error("PRIVATE"));page.reject(Error("PRIVATE"));}
  else {preflight.resolve(outcome===200?ok(result({status:"blocked",checks:{...result().checks,non_production_runtime:"blocked"}})):denied(outcome));
    page.resolve(outcome===200?ok(receipt({items:[{...receipt().items[0],status:"stale_receipt"}]})):denied(outcome));}
  await Promise.all([checking,reviewing]);
  assert.match(h.summary(),/SYNTHETIC B/);assert.match(h.summary(),new RegExp(NEXT));
  assert.match(h.summary(),new RegExp(OTHER_PC));
  for(const former of [ORG,PC,SHA,"SYNTHETIC A","PRIVATE"])assert.doesNotMatch(h.summary(),new RegExp(former));
  assert.match(h.blockers(),/data-blocker="provenance-missing_receipt_reference"/);
  assert.doesNotMatch(h.blockers(),/data-blocker="operations-non_production_runtime"|data-blocker="provenance-stale_receipt"|PRIVATE/);
  assert.equal(h.get("#workspace").hidden,false);assert.equal(h.storage.size,1);
});

for(const component of ["preflight","provenance"]) test(`Current ${component} 401 erases the complete summary, not just one card`,async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});
  await h.open();await h.check();await h.review();
  if(component==="preflight") {h.controls.preflight=()=>denied(401);await h.check();}
  else {h.controls.report=()=>denied(401);await h.review();}
  assert.equal(h.summary(),"");assert.equal(h.blockers(),"");assert.equal(h.storage.size,0);assert.equal(h.get("#workspace").hidden,true);
});

test("Logout cannot be followed by late summary rehydration; demo never fabricates component results",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  const preflight=pending(),page=pending();h.controls.preflight=()=>preflight.promise;h.controls.report=()=>page.promise;
  const checking=h.check(),reviewing=h.review();await settle();h.get("#signOut").run("click");
  preflight.resolve(ok(result()));page.resolve(ok(receipt()));await Promise.all([checking,reviewing]);
  assert.equal(h.summary(),"");assert.equal(h.blockers(),"");assert.equal(h.storage.size,0);
  const demo=await harness(true);await demo.open();await demo.check();
  assert.equal(demo.calls.length,0);assert.equal((demo.summary().match(/Absent in the synthetic demo/g)||[]).length,2);
  assert.doesNotMatch(demo.summary(),/Snapshot:|checks passed|bookings on this page/);
  assert.equal((demo.blockers().match(/no real evidence established/g)||[]).length,2);
});

test("UAT blockers are scoped presentation only, initially unresolved and without authority or automatic reads",async()=>{
  const h=await harness();assert.equal(h.blockers(),"");await h.open();
  assert.equal(h.calls.length,4);
  assert.match(h.blockers(),/Operations: Not read with explicit parameters/);
  assert.match(h.blockers(),/Provenance: No supported connections returned/);
  assert.equal((h.blockers().match(/data-unassessed=/g)||[]).length,7);
  const html=readFileSync("platform/public/fill/index.html","utf8");
  assert.match(html,/id="clubUatBlockers" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/not a complete UAT checklist, a live assessment or permission to start UAT/);
  const render=source.slice(source.indexOf("  function renderUatBlockers("),source.indexOf("  function setReviewSummary("));
  assert.doesNotMatch(render,/\bfetch\(|\bapi\(|Storage|setInterval|setTimeout|<button|<a /);
});

test("All ten failed Operations checks are listed by fixed labels, without raw fields or a readiness score",async()=>{
  const h=await harness();await h.open();
  for(const key of checks) {
    h.controls.preflight=()=>ok(result({status:"blocked",operations_runtime_sha:key==="runtime_revision_matches"?null:SHA,
      checks:{...result().checks,[key]:"blocked"}}));await h.check();
    assert.match(h.blockers(),new RegExp(`data-blocker="operations-${key}"`));
    assert.equal((h.blockers().match(/data-blocker="operations-/g)||[]).length,1);
    assert.equal((h.blockers().match(/data-unassessed=/g)||[]).length,7);
    assert.doesNotMatch(h.blockers(),/data-blocker="operations-read"|UAT ready|UAT approved|PRIVATE/);
  }
});

test("Each provenance problem is counted only on the latest page and never reveals booking or foreign receipt details",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  for(const status of ["foreign_booking","missing_receipt_reference","receipt_unavailable","foreign_receipt",
    "invalid_receipt","stale_receipt","permission_not_current","permission_changed","record_not_linked"]) {
    h.controls.report=()=>ok(receipt({items:[{...receipt().items[0],status}]}));await h.review();
    assert.match(h.blockers(),new RegExp(`data-blocker="provenance-${status}"`));
    assert.match(h.blockers(),/1 on the latest page only/);
    assert.equal((h.blockers().match(/data-blocker="provenance-/g)||[]).length,1);
    for(const privateValue of [BOOK,PC,ORG])assert.doesNotMatch(h.blockers(),new RegExp(privateValue));
  }
});

test("Pass plus an internally consistent page still leaves every unverified gate open",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();await h.check();
  h.controls.report=()=>ok(receipt({status:"page_consistent",items:[{...receipt().items[0],status:"consistent_internal_evidence"}]}));
  await h.review();
  assert.match(h.blockers(),/No failing check or receipt issue in these two last-read snapshots/);
  assert.match(h.blockers(),/Unverified gates remain open; this is not UAT clearance/);
  assert.equal((h.blockers().match(/data-unassessed=/g)||[]).length,7);
  for(const gate of [...result().not_assessed,"club_provenance_coverage"])
    assert.match(h.blockers(),new RegExp(`data-unassessed="${gate}"`));
  assert.doesNotMatch(h.blockers(),/data-blocker=|UAT ready|pilot ready|approved=true|<button|<a /);
});

test("More pages and empty pages remain unresolved; pagination replaces rather than accumulates old issues",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();await h.check();
  h.controls.report=()=>ok(receipt({has_more:true,next_after_booking_id:BOOK}));await h.review();
  assert.match(h.blockers(),/data-blocker="provenance-more-pages"/);
  assert.match(h.blockers(),/data-blocker="provenance-missing_receipt_reference"/);
  h.controls.report=()=>ok(receipt({status:"page_consistent",items:[{...receipt().items[0],status:"consistent_internal_evidence"}]}));
  await h.get("#provenanceNext").run("click");
  assert.doesNotMatch(h.blockers(),/data-blocker="provenance-more-pages"|data-blocker="provenance-missing_receipt_reference"/);
  assert.match(h.blockers(),/data-unassessed="club_provenance_coverage"/);
  h.controls.report=()=>ok(receipt({status:"no_shadow_bookings",items:[]}));await h.review();
  assert.match(h.blockers(),/data-blocker="provenance-empty"/);
  assert.doesNotMatch(h.blockers(),/No failing check or receipt issue/);
});

test("A page still labelled needs_review never becomes a clear result just because counted issues are zero",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();await h.check();
  h.controls.report=()=>ok(receipt({items:[{...receipt().items[0],status:"consistent_internal_evidence"}]}));await h.review();
  assert.match(h.blockers(),/data-blocker="provenance-unresolved"/);
  assert.doesNotMatch(h.blockers(),/No failing check or receipt issue/);
});

test("Denied, unavailable and incompatible reads replace old failures with unresolved reads without raw details",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  for(const bad of [()=>denied(403),()=>denied(404),()=>denied(503),()=>{throw Error("PRIVATE");},
    ()=>ok({...result(),pilot_ready:true,private_extra:"PRIVATE"})]) {
    h.controls.preflight=()=>ok(result({status:"blocked",checks:{...result().checks,operations_service:"blocked"}}));
    h.controls.report=()=>ok(receipt());await h.check();await h.review();
    h.controls.preflight=bad;await h.check();h.controls.report=bad;await h.review();
    assert.match(h.blockers(),/data-blocker="operations-read"/);
    assert.match(h.blockers(),/data-blocker="provenance-read"/);
    assert.match(h.blockers(),/Access denied|unavailable or incompatible/);
    assert.doesNotMatch(h.blockers(),/PRIVATE|data-blocker="operations-operations_service"|data-blocker="provenance-missing_receipt_reference"/);
  }
});

test("Loading and parameter edits remove observed failures until their own component is explicitly read again",async()=>{
  const h=await harness();h.controls.connections=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  h.controls.preflight=()=>ok(result({status:"blocked",checks:{...result().checks,operations_service:"blocked"}}));
  await h.check();await h.review();const old=pending();h.controls.preflight=()=>old.promise;
  const checking=h.check();await settle();
  assert.doesNotMatch(h.blockers(),/data-blocker="operations-operations_service"/);
  assert.match(h.blockers(),/Operations: Read in progress/);
  assert.match(h.blockers(),/data-blocker="provenance-missing_receipt_reference"/);
  h.get("#operationsSha").value=NEXT;h.get("#operationsSha").run("input");
  old.resolve(ok(result({status:"blocked",checks:{...result().checks,operations_service:"blocked"}})));await checking;
  assert.match(h.blockers(),/Operations: Not read with explicit parameters/);
  h.get("#provenanceAge").value="61";h.get("#provenanceAge").run("input");
  assert.match(h.blockers(),/data-blocker="provenance-read"/);
  assert.doesNotMatch(h.blockers(),/data-blocker="provenance-missing_receipt_reference"/);
});
