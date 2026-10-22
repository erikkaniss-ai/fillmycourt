// A late GET must not rehydrate the previous operator's private workspace.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const app = readFileSync("platform/public/fill/app.js", "utf8");
function el(dataset={}) {
  const listeners=new Map();
  return {dataset,hidden:false,disabled:false,value:"",textContent:"",innerHTML:"",
    classList:{toggle(){}},addEventListener(t,f){listeners.set(t,f);},
    listener(t){return listeners.get(t);}};
}
const selectors=["#authGate","#workspace","#orgSelect","#identity","#signOut",
  "#dateInput","#refreshButton","#error","#pageTitle","#todayView","#calendarView",
  "#revenueView","#kpis","#courtUtilisation","#utilisationBadge","#emptyCapacity",
  "#calendarTimeline","#revenueKpis","#opportunityQueue","#courtComparison",
  "#operatorSignIn","#operatorEmail","#operatorPassword","#operatorLoginButton",
  "#operatorLoginError","#demoNotice","#demoPreviewLink"];
const day={date:"2026-10-19",day_start:"2026-10-19T00:00:00+01:00",
  day_end:"2026-10-20T00:00:00+01:00",timezone:"Europe/Lisbon",currency:"EUR",
  summary:{active_courts:0,courts_with_rate_coverage:0,utilization_pct:0,revenue_minor:0,
    bookings:0,empty_minutes:0},courts:[],empty_windows:[]};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});

test("Delayed old-operator Today response cannot rehydrate workspace after sign-out",async()=>{
  const elements=Object.fromEntries(selectors.map(x=>[x,el()]));
  const nav=["today","calendar","revenue"].map(view=>el({view}));
  const session=new Map([["fill.access","synthetic-operator-token"]]);
  const local=new Map();
  let todayCalls=0,finishLate,startedLate;
  const lateStarted=new Promise(resolve=>{startedLate=resolve;});
  const late=new Promise(resolve=>{finishLate=resolve;});
  const requests=[];
  const context={
    URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
    location:{hostname:"local-test.invalid",hash:"",search:"",pathname:"/fill/"},
    history:{replaceState(){}},
    document:{querySelector:q=>elements[q],querySelectorAll:q=>q===".nav-item"?nav:[]},
    localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),
      removeItem:k=>local.delete(k)},
    sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),
      removeItem:k=>session.delete(k)},
    fetch:async(path,opts={})=>{
      requests.push({path,method:opts.method||"GET"});
      if(path==="/api/me")return response({user:{email:"old-operator@example.invalid"}});
      if(path==="/api/fmc/organizations")
        return response({items:[{id:"org-test",name:"SYNTHETIC OLD CLUB",role:"support"}]});
      if(path.startsWith("/api/fmc/org-test/today")){
        todayCalls++;
        if(todayCalls===1)return response(day);
        startedLate();
        return late;
      }
      throw Error("UNEXPECTED_CALL "+path);
    }
  };
  vm.runInNewContext(app,context,{filename:"platform/public/fill/app.js"});
  // Allow initial /me, org list and Today GET to complete.
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(elements["#workspace"].hidden,false);
  assert.equal(elements["#authGate"].hidden,true);
  const pendingRefresh=elements["#refreshButton"].listener("click")();
  await lateStarted;
  elements["#signOut"].listener("click")();
  assert.equal(elements["#authGate"].hidden,false);
  assert.equal(elements["#workspace"].hidden,true);
  assert.equal(session.has("fill.access"),false);
  finishLate(response({...day,
    summary:{...day.summary,bookings:99,revenue_minor:999999}}));
  await pendingRefresh;
  assert.equal(elements["#workspace"].hidden,true);
  assert.equal(elements["#identity"].textContent,"Not signed in");
  assert.equal(elements["#kpis"].innerHTML,"",
    "A delayed request must never restore private KPIs after logout");
  assert.equal(elements["#courtUtilisation"].innerHTML,"");
  assert.ok(requests.every(req=>req.method==="GET"));
});
