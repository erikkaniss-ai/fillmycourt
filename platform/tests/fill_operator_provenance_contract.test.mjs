import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync("platform/public/fill/app.js","utf8");
const ORG="11111111-1111-4111-8111-111111111111";
const OTHER="22222222-2222-4222-8222-222222222222";
const PC="33333333-3333-4333-8333-333333333333";
const BOOK="44444444-4444-4444-8444-444444444444";
const flags={pilot_ready:false,provider_requests_allowed:false,can_display_available_slots:false};
const ok=body=>({ok:true,status:200,json:async()=>body});
const denied=status=>({ok:false,status,json:async()=>({message:"PRIVATE_INTERNAL_DETAILS"})});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const settle=async()=>{await tick();await tick();};
function pending(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function report(status="missing_receipt_reference",extra={}) {
  return {mode:"read_only_source_review",as_of:"2026-10-21T05:00:00Z",
    max_age_seconds:60,items:[{booking_id:BOOK,status,...flags}],...flags,
    status:"needs_review",has_more:false,next_after_booking_id:null,...extra};
}
function node(dataset={}){
  const handlers=new Map();let html="",content="";
  return {dataset,hidden:false,disabled:false,value:"",
    get innerHTML(){return html;},set innerHTML(v){html=v;content="";},
    get textContent(){return content;},set textContent(v){content=v;html="";},
    classList:{toggle(){}},addEventListener:(event,fn)=>handlers.set(event,fn),
    run:(event)=>handlers.get(event)?.({preventDefault(){}})};
}
async function harness() {
  const el=new Map(),nav=["today","calendar","revenue","provenance"].map(view=>node({view}));
  const get=id=>{if(!el.has(id))el.set(id,node());return el.get(id);};
  const storage=new Map([["fill.access","fixture-staging-session"]]),calls=[];
  const controls={list:()=>ok({items:[{id:PC,provider:"playtomic"}]}),page:()=>ok(report())};
  const ctx={URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
    document:{querySelector:get,querySelectorAll:()=>nav},
    location:{hostname:"fixture.invalid",hash:"",pathname:"/fill/",search:""},
    history:{replaceState(){}},
    localStorage:{removeItem(){}},
    sessionStorage:{getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    fetch:async(path,options={})=>{
      calls.push({path,method:options.method||"GET"});
      if(path==="/api/me")return ok({user:{email:"fixture@example.invalid"}});
      if(path==="/api/fmc/organizations")return ok({items:[
        {id:ORG,name:"SYNTHETIC A",role:"owner"},{id:OTHER,name:"SYNTHETIC B",role:"owner"}]});
      if(path.includes("/today?"))return ok({summary:{},courts:[],empty_windows:[]});
      if(path.endsWith("/provider-provenance/connections"))return controls.list(path);
      if(path.includes("/provider-provenance/"))return controls.page(path);
      throw Error("Unexpected fixture GET");
    }};
  vm.runInNewContext(source,ctx);
  await settle();
  const open=async()=>{await nav[3].run("click");};
  const review=async()=>{get("#provenanceConnection").value=PC;get("#provenanceAge").value="60";
    await get("#provenanceForm").run("submit");};
  return {get,nav,storage,calls,controls,open,review};
}

test("Viewer is opt-in, explicit-age, escaped, bounded and strictly GET-only",async()=>{
  const h=await harness();
  assert.equal(h.calls.length,3,"No report request during Today");
  await h.open();
  assert.equal(h.calls.length,4);
  assert.equal(h.get("#provenanceAge").value,"");
  await h.get("#provenanceForm").run("submit");
  assert.equal(h.calls.length,4,"No inferred freshness threshold");
  await h.review();
  assert.match(h.get("#provenanceReport").innerHTML,/Receipt reference missing/);
  assert.match(h.get("#provenanceMessage").textContent,/Pilot remains unapproved/);
  assert.ok(h.calls.every(c=>c.method==="GET"));
  assert.ok(h.calls.at(-1).path.endsWith("?max_age_seconds=60&limit=50"));
  assert.equal(h.get("#dateToolbar").hidden,true);
});

test("Page scope and next cursor are explicit; a new threshold clears old results",async()=>{
  const h=await harness();await h.open();
  h.controls.page=()=>ok(report("stale_receipt",{has_more:true,next_after_booking_id:BOOK}));
  await h.review();
  assert.match(h.get("#provenanceReport").innerHTML,/More bookings remain/);
  assert.equal(h.get("#provenanceNext").hidden,false);
  h.controls.page=()=>ok(report("foreign_receipt"));
  await h.get("#provenanceNext").run("click");
  assert.ok(h.calls.at(-1).path.endsWith("&after_booking_id="+BOOK));
  assert.match(h.get("#provenanceReport").innerHTML,/different connection or organisation/);
  h.get("#provenanceAge").value="61";
  await h.get("#provenanceAge").run("input");
  assert.equal(h.get("#provenanceReport").innerHTML,"");
  assert.equal(h.get("#provenanceNext").hidden,true);
});

test("Unsupported/unsafe report and HTTP failures never retain prior evidence or leak details",async()=>{
  const h=await harness();await h.open();await h.review();
  for(const response of [ok(report("consistent_internal_evidence",{pilot_ready:true})),
    ok(report("<img src=x onerror=alert(1)>")),ok(report("foreign_receipt",{items:new Array(51).fill({})})),
    denied(403),denied(404),denied(502)]){
    h.controls.page=()=>response;await h.review();
    assert.equal(h.get("#provenanceReport").innerHTML,"");
    assert.equal(h.get("#provenanceNext").hidden,true);
    assert.match(h.get("#provenanceMessage").textContent,/permission|unavailable/);
    assert.doesNotMatch(h.get("#provenanceMessage").textContent,/PRIVATE_INTERNAL/);
  }
});

test("No connections and empty booking page do not imply readiness",async()=>{
  const h=await harness();
  h.controls.list=()=>ok({items:[]});await h.open();
  assert.equal(h.get("#provenanceReview").disabled,true);
  assert.match(h.get("#provenanceMessage").textContent,/No supported connection/);
  h.controls.list=()=>ok({items:[{id:PC,provider:"playtomic"}]});await h.open();
  h.controls.page=()=>ok(report("unused",{items:[],status:"no_shadow_bookings"}));
  await h.review();
  assert.match(h.get("#provenanceMessage").textContent,/No stored shadow bookings/);
  assert.match(h.get("#provenanceReport").innerHTML,/not pilot approval/);
});

test("Connection-list denial fails closed for non-admin roles without fetching a report",async()=>{
  const h=await harness();
  h.controls.list=()=>denied(403);await h.open();
  assert.equal(h.get("#provenanceReview").disabled,true);
  assert.match(h.get("#provenanceMessage").textContent,/permission/);
  assert.equal(h.get("#provenanceReport").innerHTML,"");
  assert.equal(h.calls.length,4);
  await h.get("#provenanceForm").run("submit");
  assert.equal(h.calls.length,4);
});

for(const kind of ["report401","reportNetwork","list401"]){
  test("Late "+kind+" cannot revoke a newer organisation or restore former data",async()=>{
    const h=await harness(),old=pending();await h.open();await h.review();
    let reading;
    if(kind==="list401"){h.controls.list=()=>old.promise;reading=h.open();}
    else{h.controls.page=()=>old.promise;reading=h.review();}
    await tick();
    h.controls.list=()=>ok({items:[]});
    h.get("#orgSelect").value=OTHER;h.get("#orgSelect").run("change");await settle();
    assert.equal(h.get("#provenanceReport").innerHTML,"");
    if(kind==="reportNetwork")old.reject(Error("FORMER_TENANT_INTERNAL_ERROR"));
    else old.resolve(denied(401));
    await reading;
    assert.equal(h.storage.has("fill.access"),true);
    assert.match(h.get("#provenanceMessage").textContent,/No supported connection/);
    assert.equal(h.get("#provenanceReport").innerHTML,"");
  });
}

test("Logout erases report and picker; current 401 never leaves hidden evidence",async()=>{
  for(const logout of [true,false]){
    const h=await harness();await h.open();await h.review();
    if(logout)h.get("#signOut").run("click");
    else{h.controls.page=()=>denied(401);await h.review();}
    assert.equal(h.storage.has("fill.access"),false);
    assert.equal(h.get("#provenanceReport").innerHTML,"");
    assert.equal(h.get("#provenanceAge").value,"");
    assert.doesNotMatch(h.get("#provenanceConnection").innerHTML,new RegExp(PC));
    assert.equal(h.get("#provenanceView").hidden,true);
  }
});
