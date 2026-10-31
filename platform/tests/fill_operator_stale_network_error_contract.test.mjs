// A failed older Calendar network request must not show a former tenant error
// after the operator has switched to a new, successfully loaded club.
// Synthetic local VM only; zero API writes, no actual tenant data.
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
function node(dataset={}){
 const handlers=new Map();
 return {dataset,hidden:false,disabled:false,value:"",textContent:"",innerHTML:"",
  classList:{toggle(){}},addEventListener:(k,f)=>handlers.set(k,f),
  listener:k=>handlers.get(k)};
}
const today={date:"2026-10-19",day_start:"2026-10-19T00:00:00+01:00",
 day_end:"2026-10-20T00:00:00+01:00",timezone:"Europe/Lisbon",currency:"EUR",
 summary:{active_courts:0,courts_with_rate_coverage:0,utilization_pct:0,
 revenue_minor:0,bookings:0,empty_minutes:0},courts:[],empty_windows:[]};
const ok=body=>({ok:true,status:200,json:async()=>body});
const tick=()=>new Promise(done=>setTimeout(done,0));

test("Late failed Calendar fetch from club A cannot show stale error in club B",async()=>{
 const el=Object.fromEntries(ids.map(id=>[id,node()]));
 const nav=["today","calendar","revenue"].map(view=>node({view}));
 const session=new Map([["fill.access","synthetic-bearer"]]),local=new Map();
 let rejectOld,signalOld;
 const old=new Promise((resolve,reject)=>{rejectOld=reject;});
 const oldStarted=new Promise(resolve=>{signalOld=resolve;});
 const calls=[];
 const ctx={URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
  location:{hostname:"fixture.invalid",hash:"",search:"",pathname:"/fill/"},
  history:{replaceState(){}},
  document:{querySelector:k=>el[k],querySelectorAll:k=>k===".nav-item"?nav:[]},
  sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),
   removeItem:k=>session.delete(k)},
  localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),
   removeItem:k=>local.delete(k)},
  fetch:async(path,opts={})=>{
   calls.push({path,method:opts.method||"GET"});
   if(path==="/api/me")return ok({user:{email:"operator@example.invalid"}});
   if(path==="/api/fmc/organizations")return ok({items:[
    {id:"org-a",name:"SYNTHETIC A",role:"support"},
    {id:"org-b",name:"SYNTHETIC B",role:"support"}]});
   if(path.startsWith("/api/fmc/org-a/today") ||
      path.startsWith("/api/fmc/org-b/today"))return ok(today);
   if(path.startsWith("/api/fmc/org-a/calendar")){signalOld();return old;}
   if(path.startsWith("/api/fmc/org-b/calendar"))
    return ok({bookings:[],holds:[],blocks:[]});
   throw Error("UNEXPECTED_GET "+path);
  }
 };
 vm.runInNewContext(app,ctx,{filename:"fill/app.js"});
 await tick();await tick();
 assert.equal(el["#workspace"].hidden,false);
 const oldCall=nav[1].listener("click")();
 await oldStarted;
 el["#orgSelect"].value="org-b";
 el["#orgSelect"].listener("change")();
 await tick();await tick();
 assert.equal(el["#workspace"].hidden,false);
 assert.equal(el["#authGate"].hidden,true);
 assert.equal(el["#error"].hidden,true);
 rejectOld(new Error("STAGING_OLD_ORG_INTERNAL_NETWORK_FAILURE"));
 await oldCall;
 assert.equal(el["#error"].hidden,true,"Old club fetch rejection must be invisible in club B");
 assert.equal(el["#error"].textContent,"","No stale former-club details");
 assert.equal(el["#workspace"].hidden,false);
 assert.equal(el["#orgSelect"].value,"org-b");
 assert.equal(session.get("fill.access"),"synthetic-bearer");
 assert.ok(calls.every(call=>call.method==="GET"));
});
