import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync("platform/public/fill/app.js","utf8");
const ORG="11111111-1111-4111-8111-111111111111", OTHER="22222222-2222-4222-8222-222222222222";
const SHA="a".repeat(40), NEXT="b".repeat(40);
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
function node(dataset={}) {
  const handlers=new Map();let html="",content="";
  return {dataset,hidden:false,disabled:false,value:"",classList:{toggle(){}},
    get innerHTML(){return html;},set innerHTML(v){html=v;content="";},
    get textContent(){return content;},set textContent(v){content=v;html="";},
    addEventListener:(event,fn)=>handlers.set(event,fn),
    run:event=>handlers.get(event)?.({preventDefault(){}})};
}
async function harness(demo=false) {
  const el=new Map(),nav=["today","calendar","revenue","provenance"].map(view=>node({view}));
  const get=id=>{if(!el.has(id))el.set(id,node());return el.get(id);};
  const storage=new Map([["fill.access","fixture-session-only"]]),calls=[];
  const controls={preflight:()=>ok(result())};
  const fixture=path=>path==="/api/me"?{user:{email:"fixture@example.invalid"}}:
    path==="/api/fmc/organizations"?{items:[{id:ORG,name:"SYNTHETIC A",role:"owner"},
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
      const data=fixture(path);if(data)return ok(data);
      throw Error("Unexpected fixture request");
    }};
  vm.runInNewContext(source,ctx);await settle();
  const open=()=>nav[3].run("click");
  const check=async(sha=SHA)=>{get("#operationsSha").value=sha;
    await get("#operationsSha").run("input");return get("#preflightForm").run("submit");};
  return {get,nav,storage,calls,controls,open,check};
}

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
