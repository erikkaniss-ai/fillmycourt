// Same-org overlapping Calendar GETs: an old 401 cannot override a newer 200.
// Synthetic in-memory data only; no live club/API calls.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const app=readFileSync("platform/public/fill/app.js","utf8");
const ids=["#authGate","#workspace","#orgSelect","#identity","#signOut","#dateInput",
"#refreshButton","#error","#pageTitle","#todayView","#calendarView","#revenueView",
"#kpis","#courtUtilisation","#utilisationBadge","#emptyCapacity","#calendarTimeline",
"#revenueKpis","#opportunityQueue","#courtComparison","#operatorSignIn","#operatorEmail",
"#operatorPassword","#operatorLoginButton","#operatorLoginError","#demoNotice","#demoPreviewLink"];
const make=(dataset={})=>{
 const handlers=new Map();
 return {dataset,hidden:false,disabled:false,value:"",textContent:"",innerHTML:"",
 classList:{toggle(){}},addEventListener:(k,f)=>handlers.set(k,f),
 listener:k=>handlers.get(k)};
};
const today={date:"2026-10-19",day_start:"2026-10-19T00:00:00+01:00",
day_end:"2026-10-20T00:00:00+01:00",timezone:"Europe/Lisbon",currency:"EUR",
summary:{active_courts:0,courts_with_rate_coverage:0,utilization_pct:0,revenue_minor:0,
bookings:0,empty_minutes:0},courts:[],empty_windows:[]};
const ok=body=>({ok:true,status:200,json:async()=>body});
const unauthorized={ok:false,status:401,json:async()=>({error:"AUTH_REQUIRED"})};
const tick=()=>new Promise(done=>setTimeout(done,0));

test("Older Calendar 401 cannot revoke session after newer Calendar GET 200",async()=>{
 const el=Object.fromEntries(ids.map(id=>[id,make()]));
 const nav=["today","calendar","revenue"].map(view=>make({view}));
 const session=new Map([["fill.access","fixture-valid-session"]]),local=new Map();
 let completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});
 const olderStarted=new Promise(done=>{notifyOlder=done;});
 let calendarRequests=0;
 const calls=[];
 const ctx={URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
 location:{hostname:"fixture.invalid",hash:"",search:"",pathname:"/fill/"},
 history:{replaceState(){}},
 document:{querySelector:k=>el[k],querySelectorAll:k=>k===".nav-item"?nav:[]},
 sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),
 removeItem:k=>session.delete(k)},
 localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),
 removeItem:k=>local.delete(k)},
 fetch:async(path,options={})=>{
   calls.push({path,method:options.method||"GET"});
   if(path==="/api/me")return ok({user:{email:"qa@example.invalid"}});
   if(path==="/api/fmc/organizations")return ok({items:[{
    id:"fixture-org",name:"FICTIONAL CLUB",role:"support"}]});
   if(path.startsWith("/api/fmc/fixture-org/today"))return ok(today);
   if(path.startsWith("/api/fmc/fixture-org/calendar")){
    calendarRequests++;
    if(calendarRequests===1){notifyOlder();return older;}
    return ok({bookings:[],holds:[],blocks:[]});
   }
   throw Error("Unexpected fixture request: "+path);
 }};
 vm.runInNewContext(app,ctx);
 await tick();await tick();
 assert.equal(el["#workspace"].hidden,false);
 const oldRequest=nav[1].listener("click")();
 await olderStarted;
 await nav[1].listener("click")();
 assert.equal(calendarRequests,2,"Second Calendar visit should request latest view");
 assert.equal(session.get("fill.access"),"fixture-valid-session");
 completeOlder(unauthorized);
 await oldRequest;
 assert.equal(session.get("fill.access"),"fixture-valid-session",
  "Superseded calendar 401 must not invalidate active operator session");
 assert.equal(el["#authGate"].hidden,true);
 assert.equal(el["#workspace"].hidden,false);
 assert.equal(el["#error"].hidden,true);
 assert.ok(calls.every(c=>c.method==="GET"),"Never write outside staging");
});
