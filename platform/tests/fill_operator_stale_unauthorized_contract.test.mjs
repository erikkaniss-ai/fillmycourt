// A superseded tenant's 401 is not proof that the current tenant's JWT expired.
// Synthetic GET-only local VM, no Supabase / Netlify / Railway request.
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
function elem(dataset={}){
 const listeners=new Map();
 return {dataset,hidden:false,disabled:false,value:"",textContent:"",innerHTML:"",
 classList:{toggle(){}},addEventListener:(key,f)=>listeners.set(key,f),
 listener:key=>listeners.get(key)};
}
const day={
 date:"2026-10-19",day_start:"2026-10-19T00:00:00+01:00",
 day_end:"2026-10-20T00:00:00+01:00",timezone:"Europe/Lisbon",currency:"EUR",
 summary:{active_courts:0,courts_with_rate_coverage:0,utilization_pct:0,
 revenue_minor:0,bookings:0,empty_minutes:0},courts:[],empty_windows:[]
};
const ok=data=>({ok:true,status:200,json:async()=>data});
const fail401={ok:false,status:401,json:async()=>({
 error:"AUTH_REQUIRED",message:"fixture tenant A unauthorized"
})};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));

test("Old club Calendar 401 cannot log out valid session after switching to club B",async()=>{
 const el=Object.fromEntries(ids.map(x=>[x,elem()]));
 const nav=["today","calendar","revenue"].map(view=>elem({view}));
 const session=new Map([["fill.access","ci-operator-valid-token"]]);
 const local=new Map();
 let releaseOld,startedOld;
 const old=new Promise(resolve=>{releaseOld=resolve;});
 const oldStarted=new Promise(resolve=>{startedOld=resolve;});
 const calls=[];
 const context={
  URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
  location:{hostname:"fixture.local",hash:"",search:"",pathname:"/fill/"},
  history:{replaceState(){}},
  document:{querySelector:q=>el[q],querySelectorAll:q=>q===".nav-item"?nav:[]},
  sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),
   removeItem:k=>session.delete(k)},
  localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),
   removeItem:k=>local.delete(k)},
  fetch:async(path,opts={})=>{
   calls.push({path,method:opts.method||"GET",bearer:opts.headers?.Authorization});
   if(path==="/api/me")return ok({user:{email:"operator@example.invalid"}});
   if(path==="/api/fmc/organizations")
    return ok({items:[{id:"org-a",name:"SYNTHETIC A",role:"support"},
    {id:"org-b",name:"SYNTHETIC B",role:"support"}]});
   if(path.startsWith("/api/fmc/org-a/today"))return ok(day);
   if(path.startsWith("/api/fmc/org-b/today"))return ok(day);
   if(path.startsWith("/api/fmc/org-a/calendar")){
     startedOld();return old;
   }
   if(path.startsWith("/api/fmc/org-b/calendar"))
    return ok({bookings:[],holds:[],blocks:[]});
   throw Error("INVALID_FIXTURE_ENDPOINT "+path);
  }
 };
 vm.runInNewContext(app,context);
 await pause();await pause();
 assert.equal(el["#workspace"].hidden,false,"Initial operator workspace visible");
 const calendarRequest=nav[1].listener("click")();
 await oldStarted;
 // This supersedes the in-flight calendar request for organization A.
 el["#orgSelect"].value="org-b";
 el["#orgSelect"].listener("change")();
 await pause();await pause();
 assert.equal(el["#workspace"].hidden,false,"Org B workspace visible");
 assert.ok(calls.some(x=>x.path.startsWith("/api/fmc/org-b/calendar")));
 releaseOld(fail401);
 await calendarRequest;
 assert.equal(session.get("fill.access"),"ci-operator-valid-token",
   "A stale 401 from org A must NOT revoke an active session for org B");
 assert.equal(el["#workspace"].hidden,false,"Old 401 must not close new workspace");
 assert.equal(el["#authGate"].hidden,true,"No outdated login gate");
 assert.equal(el["#error"].hidden,true,"No stale error shown on new tenant");
 assert.equal(el["#orgSelect"].value,"org-b");
 assert.ok(calls.every(x=>x.method==="GET"),"Zero application writes");
});
