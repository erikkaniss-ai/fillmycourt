import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync("platform/public/fill/app.js","utf8");
// Pinned sanitized CI output, not a newly issued GO or hosted acceptance receipt.
const golden=JSON.parse(readFileSync("platform/tests/fixtures/get-acceptance-79977c8-NOT-RUN.json","utf8"));
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
  const nodes=new Map(),nav=["today","calendar","revenue","provenance"].map(view=>node({view}));
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const storage=new Map(signedIn?[["fill.access","fixture-session"]]:[]),calls=[],controls={deny:false};
  const fixture=path=>path==="/api/me"?{user:{email:"fixture@example.invalid"}}:
    path==="/api/fmc/organizations"?{items:[{id:ORG,name,role},{id:OTHER,name:"SYNTHETIC B",role:"admin"}]}:
    path.includes("/today?")?{summary:{},courts:[],empty_windows:[]}:
    path.endsWith("/connections")?{items:[]}:null;
  vm.runInNewContext(source,{URLSearchParams,Intl,Date:Clock,Map,Set,Number,String,Error,JSON,encodeURIComponent,
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
  return {get,nav,storage,calls,controls,open,select,review,
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
});
test("Complete record snapshots still require human review and cannot clear club gates",async()=>{
  const h=await harness();await h.open();const data=structuredClone(golden);
  data.checks.forEach(c=>{c.blockers=[];c.preflight="READY_FOR_MANUAL_GO_REVIEW";});
  const before=h.get("#clubUatBlockers").innerHTML;await h.select(data);await h.review();
  assert.equal((h.report().match(/Ready for manual GO review only/g)||[]).length,7);
  assert.equal((h.report().match(/No verified GO/g)||[]).length,7);
  assert.equal(h.get("#clubUatBlockers").innerHTML,before);
  assert.doesNotMatch(h.report(),/GO granted|UAT approved|execution enabled/);
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
  if(["club","tab","logout","refresh","401"].includes(action)){
    assert.equal(h.get("#acceptanceSha").value,"");assert.equal(h.get("#acceptanceFile").files.length,0);
  }
  if(["logout","401"].includes(action))assert.equal(h.storage.size,0);
});
test("Late failure cannot erase a newer valid local report; current failure is redacted",async()=>{
  const h=await harness();await h.open();const old=deferred();
  await h.select(golden,SHA,{size:100,text:()=>old.promise});const running=h.review();await settle();
  await h.select();await h.review();const current=h.report();old.reject(Error("SECRET"));await running;
  assert.equal(h.report(),current);
  await h.select(golden,SHA,{size:100,text:async()=>{throw Error("SECRET");}});await h.review();
  assert.equal(h.report(),"");assert.doesNotMatch(h.message(),/SECRET/);
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
