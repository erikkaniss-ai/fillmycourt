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

const coveredToday={...today,summary:{...today.summary,active_courts:1,
 courts_with_rate_coverage:1,capacity_minutes:1440,empty_minutes:1440},courts:[{
 court_id:"fictional-covered-court",court_name:"FICTIONAL COVERED COURT",
 has_rate_coverage:true,capacity_minutes:1440,booked_minutes:0,held_minutes:0,
 blocked_minutes:0,empty_minutes:1440,utilization_pct:0,bookings:0,cancellations:0,
 revenue_minor:0,sellable_windows:[{starts_at:today.day_start,ends_at:today.day_end,
 start_minute:0,end_minute:1440}]}]};
const emptyCalendar=()=>({bookings:[],holds:[],blocks:[]});
const occupiedCalendar=(source="FICTIONAL OCCUPANCY")=>({bookings:[{
 court_id:"fictional-covered-court",starts_at:today.day_start,ends_at:today.day_end,
 status:"confirmed",source}],holds:[],blocks:[]});

async function calendarFixture(reply, day=coveredToday){
 const el=Object.fromEntries(ids.map(id=>[id,make()]));
 const nav=["today","calendar","revenue"].map(view=>make({view}));
 const session=new Map([["fill.access","fixture-valid-session"]]),local=new Map();
 const calls=[];
 let requests=0;
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
  if(path.startsWith("/api/fmc/fixture-org/today"))return ok(day);
  if(path.startsWith("/api/fmc/fixture-org/calendar"))return reply(++requests);
  throw Error("Unexpected fictional request");
 }};
 vm.runInNewContext(app,ctx);
 await tick();await tick();
 assert.equal(el["#workspace"].hidden,false,"Fictional operator bootstrap completes");
 return {el,session,calls,visit:()=>nav[1].listener("click")()};
}

function assertCalendarSession(fixture){
 assert.equal(fixture.session.get("fill.access"),"fixture-valid-session");
 assert.equal(fixture.el["#authGate"].hidden,true);
 assert.equal(fixture.el["#workspace"].hidden,false);
 assert.ok(fixture.calls.every(call=>call.method==="GET"),"All requests stay fictional GETs");
}

function assertCurrentMalformedCalendar(fixture){
 assertCalendarSession(fixture);
 assert.equal(/lane-cell open/.test(fixture.el["#calendarTimeline"].innerHTML),false,
  "Malformed Calendar must not render rate-covered unoccupied slots");
 assert.equal(fixture.el["#error"].hidden,false,"Current malformed Calendar must show a load error");
 assert.match(fixture.el["#error"].textContent,/unable to load calendar/i);
 assert.doesNotMatch(fixture.el["#error"].textContent,/FICTIONAL JSON FAILURE/);
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,"","Unsafe Calendar grid must be cleared");
 assert.doesNotMatch(fixture.el["#calendarTimeline"].innerHTML,/court-grid|unoccupied in Core/);
}

test("Current Calendar 200 JSON rejection clears the prior grid without revoking session",async()=>{
 const fixture=await calendarFixture(n=>n===1?ok(occupiedCalendar()):{
  ok:true,status:200,json:async()=>{throw Error("FICTIONAL JSON FAILURE");}});
 await fixture.visit();
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/lane-cell booked/);
 assert.doesNotMatch(fixture.el["#calendarTimeline"].innerHTML,/lane-cell open/);
 await fixture.visit();
 assertCurrentMalformedCalendar(fixture);
});

test("Current Calendar 200 missing all required arrays cannot render false unoccupied slots",async()=>{
 const fixture=await calendarFixture(n=>ok(n===1?occupiedCalendar():{}));
 await fixture.visit();
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/lane-cell booked/);
 await fixture.visit();
 assertCurrentMalformedCalendar(fixture);
});

test("Old Calendar JSON rejection after newer valid body preserves newer grid error and session",async()=>{
 let rejectOlder,notifyBodyStarted;
 const olderBody=new Promise((_,reject)=>{rejectOlder=reject;});
 const bodyStarted=new Promise(done=>{notifyBodyStarted=done;});
 const fixture=await calendarFixture(n=>n===1?{
  ok:true,status:200,json:()=>{notifyBodyStarted();return olderBody;}
 }:ok(occupiedCalendar("FICTIONAL NEWER SNAPSHOT")));
 const olderRequest=fixture.visit();
 await bodyStarted;
 await fixture.visit();
 const newerGrid=fixture.el["#calendarTimeline"].innerHTML;
 const newerError={hidden:fixture.el["#error"].hidden,text:fixture.el["#error"].textContent};
 assert.match(newerGrid,/FICTIONAL NEWER SNAPSHOT/);
 assert.equal(newerError.hidden,true);
 rejectOlder(Error("FICTIONAL JSON FAILURE"));
 await olderRequest;
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,newerGrid);
 assert.equal(fixture.el["#error"].hidden,newerError.hidden);
 assert.equal(fixture.el["#error"].textContent,newerError.text);
 assertCalendarSession(fixture);
});

test("Valid current empty Calendar three-array snapshot still renders covered unoccupied cells",async()=>{
 const fixture=await calendarFixture(()=>ok(emptyCalendar()));
 await fixture.visit();
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/court-grid/);
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/lane-cell open/);
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/rate-covered; unoccupied in Core/);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});

const rowCourt="fictional-covered-court";
const invalidBookingSnapshot=()=>({bookings:[{court_id:rowCourt,status:"confirmed",
 starts_at:"FICTIONAL INVALID START",ends_at:today.day_end}],holds:[],blocks:[]});

async function assertMalformedOccupancyRow(body){
 const fixture=await calendarFixture(n=>ok(n===1?occupiedCalendar():body));
 await fixture.visit();
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/lane-cell booked/);
 await fixture.visit();
 assertCurrentMalformedCalendar(fixture);
 assert.equal(fixture.el["#error"].textContent,"Unable to load Calendar. Try again.");
 assert.doesNotMatch(fixture.el["#error"].textContent,/FICTIONAL INVALID START|fictional-covered-court/);
}

test("Confirmed booking with invalid start cannot become unoccupied Calendar",async()=>{
 await assertMalformedOccupancyRow(invalidBookingSnapshot());
});

test("Hold missing end cannot become unoccupied Calendar",async()=>{
 await assertMalformedOccupancyRow({bookings:[],holds:[{
  court_id:rowCourt,starts_at:today.day_start}],blocks:[]});
});

test("Block with nonpositive interval cannot become unoccupied Calendar",async()=>{
 await assertMalformedOccupancyRow({bookings:[],holds:[],blocks:[{
  court_id:rowCourt,starts_at:today.day_start,ends_at:today.day_start}]});
});

test("Old malformed occupancy row after newer valid Calendar preserves grid error and session",async()=>{
 let completeOlder,notifyBodyStarted;
 const olderBody=new Promise(done=>{completeOlder=done;});
 const bodyStarted=new Promise(done=>{notifyBodyStarted=done;});
 const fixture=await calendarFixture(n=>n===1?{
  ok:true,status:200,json:()=>{notifyBodyStarted();return olderBody;}
 }:ok(occupiedCalendar("FICTIONAL NEWER ROW SNAPSHOT")));
 const olderRequest=fixture.visit();
 await bodyStarted;
 await fixture.visit();
 const newerGrid=fixture.el["#calendarTimeline"].innerHTML;
 const newerError={hidden:fixture.el["#error"].hidden,text:fixture.el["#error"].textContent};
 assert.match(newerGrid,/FICTIONAL NEWER ROW SNAPSHOT/);
 assert.equal(newerError.hidden,true);
 completeOlder(invalidBookingSnapshot());
 await olderRequest;
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,newerGrid);
 assert.equal(fixture.el["#error"].hidden,newerError.hidden);
 assert.equal(fixture.el["#error"].textContent,newerError.text);
 assertCalendarSession(fixture);
});

test("Valid mixed rows preserve cancelled history and day-boundary clipping semantics",async()=>{
 const fixture=await calendarFixture(()=>ok({bookings:[
  {court_id:rowCourt,status:"confirmed",starts_at:"2026-10-18T23:30:00+01:00",
   ends_at:"2026-10-19T00:30:00+01:00",source:"FICTIONAL CLIPPED START"},
  {court_id:rowCourt,status:"pending_payment",starts_at:"2026-10-19T23:30:00+01:00",
   ends_at:"2026-10-20T00:30:00+01:00",source:"FICTIONAL CLIPPED END"},
  {court_id:rowCourt,status:"cancelled",starts_at:"2026-10-19T02:00:00+01:00",
   ends_at:"2026-10-19T03:00:00+01:00",source:"FICTIONAL CANCELLED HISTORY"},
  {court_id:rowCourt,status:"fictional_history",starts_at:"2026-10-19T04:00:00+01:00",
   ends_at:"2026-10-19T05:00:00+01:00",source:"FICTIONAL OTHER HISTORY"},
  {court_id:rowCourt,status:"confirmed",starts_at:"2026-10-18T22:00:00+01:00",
   ends_at:"2026-10-18T23:00:00+01:00",source:"FICTIONAL OUTSIDE HISTORY"}
 ],holds:[{court_id:rowCourt,starts_at:"2026-10-19T00:30:00+01:00",
  ends_at:"2026-10-19T01:00:00+01:00"}],blocks:[{court_id:rowCourt,
  starts_at:"2026-10-19T01:00:00+01:00",ends_at:"2026-10-19T01:30:00+01:00",
  reason:"FICTIONAL VALID BLOCK"}]}));
 await fixture.visit();
 const grid=fixture.el["#calendarTimeline"].innerHTML;
 assert.match(grid,/court-grid/);
 assert.match(grid,/grid-template-columns:repeat\(48,/);
 assert.equal((grid.match(/class="lane-cell booked"/g)||[]).length,2);
 assert.equal((grid.match(/class="lane-cell held"/g)||[]).length,1);
 assert.equal((grid.match(/class="lane-cell blocked"/g)||[]).length,1);
 assert.equal((grid.match(/class="lane-cell open"/g)||[]).length,44);
 assert.match(grid,/00:00–00:30 · FICTIONAL CLIPPED START/);
 assert.match(grid,/23:30–24:00 · FICTIONAL CLIPPED END/);
 assert.doesNotMatch(grid,/FICTIONAL CANCELLED HISTORY|FICTIONAL OTHER HISTORY|FICTIONAL OUTSIDE HISTORY/);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});


test("Current Calendar 403 clears prior occupied grid and preserves operator session",async()=>{
 const permission="FICTIONAL CALENDAR PERMISSION DENIED";
 const denial={ok:false,status:403,json:async()=>({error:permission})};
 const fixture=await calendarFixture(n=>{
  assert.ok(n===1||n===2,"Only two fictional Calendar requests are allowed");
  return n===1?ok(occupiedCalendar("FICTIONAL PRE-DENIAL OCCUPANCY")):denial;
 });
 const bootstrapCalls=fixture.calls.slice();
 assert.equal(bootstrapCalls.length,3);
 assert.deepEqual(bootstrapCalls.map(call=>new URL(call.path,"https://fixture.invalid").pathname),
  ["/api/me","/api/fmc/organizations","/api/fmc/fixture-org/today"]);
 const originalSession=fixture.session.get("fill.access");
 assert.equal(fixture.session.has("fill.access"),true);
 const originalOrg=fixture.el["#orgSelect"].value;
 const originalIdentity=fixture.el["#identity"].textContent;
 await fixture.visit();
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/lane-cell booked/);
 assert.match(fixture.el["#calendarTimeline"].innerHTML,/FICTIONAL PRE-DENIAL OCCUPANCY/);
 assert.doesNotMatch(fixture.el["#calendarTimeline"].innerHTML,/lane-cell open/);
 assert.equal(fixture.el["#error"].hidden,true);
 await fixture.visit();
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,"");
 assert.doesNotMatch(fixture.el["#calendarTimeline"].innerHTML,
  /lane-cell booked|lane-cell held|lane-cell blocked|lane-cell open|court-grid|unoccupied in Core/);
 assert.equal(fixture.el["#error"].hidden,false);
 assert.match(fixture.el["#error"].textContent,/FICTIONAL CALENDAR PERMISSION DENIED/);
 assert.equal(fixture.session.has("fill.access"),true);
 assert.equal(fixture.session.get("fill.access")===originalSession,true);
 assert.equal(fixture.el["#authGate"].hidden,true);
 assert.equal(fixture.el["#workspace"].hidden,false);
 assert.equal(fixture.el["#orgSelect"].value===originalOrg,true);
 assert.equal(fixture.el["#identity"].textContent===originalIdentity,true);
 const calendarPath="/api/fmc/fixture-org/calendar?"+new URLSearchParams({
  start:today.day_start,end:today.day_end}).toString();
 assert.deepEqual(fixture.calls.slice(bootstrapCalls.length),
  [{path:calendarPath,method:"GET"},{path:calendarPath,method:"GET"}]);
 assert.deepEqual(fixture.calls.slice(0,bootstrapCalls.length),bootstrapCalls);
 assert.equal(fixture.calls.length,5,"No retry, fallback or additional request");
 assert.ok(fixture.calls.every(call=>call.method==="GET"));
});

test("Older Calendar 403 after newer occupied 200 preserves grid error and operator session",async()=>{
 const permission="FICTIONAL STALE CALENDAR PERMISSION DENIED";
 const denial={ok:false,status:403,json:async()=>({error:permission})};
 let completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});
 const olderStarted=new Promise(done=>{notifyOlder=done;});
 const fixture=await calendarFixture(n=>{
  assert.ok(n===1||n===2,"Only two fictional Calendar requests are allowed");
  if(n===1){notifyOlder();return older;}
  return ok(occupiedCalendar("FICTIONAL NEWER PERMITTED SNAPSHOT"));
 });
 const bootstrapCalls=fixture.calls.slice();
 assert.equal(bootstrapCalls.length,3);
 assert.deepEqual(bootstrapCalls.map(call=>new URL(call.path,"https://fixture.invalid").pathname),
  ["/api/me","/api/fmc/organizations","/api/fmc/fixture-org/today"]);
 const originalSession=fixture.session.get("fill.access");
 assert.equal(fixture.session.has("fill.access"),true);
 const oldRequest=fixture.visit();
 await olderStarted;
 await fixture.visit();
 const newer={
  grid:fixture.el["#calendarTimeline"].innerHTML,
  errorHidden:fixture.el["#error"].hidden,errorText:fixture.el["#error"].textContent,
  authHidden:fixture.el["#authGate"].hidden,workspaceHidden:fixture.el["#workspace"].hidden,
  org:fixture.el["#orgSelect"].value,identity:fixture.el["#identity"].textContent,
 };
 assert.match(newer.grid,/lane-cell booked/);
 assert.match(newer.grid,/FICTIONAL NEWER PERMITTED SNAPSHOT/);
 assert.doesNotMatch(newer.grid,/lane-cell open/);
 assert.equal(newer.errorHidden,true);
 assert.equal(newer.authHidden,true);
 assert.equal(newer.workspaceHidden,false);
 assert.equal(fixture.session.get("fill.access")===originalSession,true);
 completeOlder(denial);
 await oldRequest;
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,newer.grid);
 assert.equal(fixture.el["#error"].hidden,newer.errorHidden);
 assert.equal(fixture.el["#error"].textContent,newer.errorText);
 assert.doesNotMatch(fixture.el["#error"].textContent,/FICTIONAL STALE CALENDAR PERMISSION DENIED/);
 assert.equal(fixture.el["#authGate"].hidden,newer.authHidden);
 assert.equal(fixture.el["#workspace"].hidden,newer.workspaceHidden);
 assert.equal(fixture.el["#orgSelect"].value===newer.org,true);
 assert.equal(fixture.el["#identity"].textContent===newer.identity,true);
 assert.equal(fixture.session.has("fill.access"),true);
 assert.equal(fixture.session.get("fill.access")===originalSession,true);
 const calendarPath="/api/fmc/fixture-org/calendar?"+new URLSearchParams({
  start:today.day_start,end:today.day_end}).toString();
 assert.deepEqual(fixture.calls.slice(bootstrapCalls.length),
  [{path:calendarPath,method:"GET"},{path:calendarPath,method:"GET"}]);
 assert.deepEqual(fixture.calls.slice(0,bootstrapCalls.length),bootstrapCalls);
 assert.equal(fixture.calls.length,5,"No stale retry, fallback or additional request");
 assert.ok(fixture.calls.every(call=>call.method==="GET"));
});

test("Current Calendar 403 evicts populated cached Today and Revenue readouts",{timeout:2000},async()=>{
 const permission="FICTIONAL READOUT PERMISSION DENIED";
 let calendarRequests=0;
 const reply=number=>{
  assert.equal(number<=2,true,"Only two fictional Calendar reads are permitted");
  return number===1?ok(occupiedCalendar("FICTIONAL PRIOR OCCUPANCY")):
   {ok:false,status:403,json:async()=>({error:permission})};
 };
 const el=Object.fromEntries(ids.map(id=>[id,make()]));
 const nav=["today","calendar","revenue"].map(view=>make({view}));
 const session=new Map([["fill.access",String(Symbol())]]),local=new Map(),calls=[];
 const readoutIds=["#kpis","#courtUtilisation","#emptyCapacity",
  "#revenueKpis","#opportunityQueue","#courtComparison"];
 for(const id of [...readoutIds,"#calendarTimeline"]){
  const node=el[id];let visibleText=node.textContent;
  Object.defineProperty(node,"textContent",{enumerable:true,configurable:true,
   get:()=>visibleText,set:value=>{visibleText=value;if(value==="")node.innerHTML="";}});
 }
 const courtLabel="FICTIONAL CACHED READOUT COURT";
 const data={...coveredToday,summary:{...coveredToday.summary,
  booked_minutes:60,empty_minutes:1380,revenue_minor:2400,bookings:1,utilization_pct:100/24},
  courts:coveredToday.courts.map(court=>({...court,court_name:courtLabel,
   booked_minutes:60,empty_minutes:1380,revenue_minor:2400,bookings:1,utilization_pct:100/24}))};
 let notifyReadout,notifyAuthenticated;
 const readoutReady=new Promise(done=>{notifyReadout=done;});
 const authenticated=new Promise(done=>{notifyAuthenticated=done;});
 let publicKpis="",publicAuthHidden=el["#authGate"].hidden;
 Object.defineProperty(el["#kpis"],"innerHTML",{enumerable:true,configurable:true,
  get:()=>publicKpis,set:value=>{publicKpis=value;if(String(value).length)notifyReadout();}});
 Object.defineProperty(el["#authGate"],"hidden",{enumerable:true,configurable:true,
  get:()=>publicAuthHidden,set:value=>{publicAuthHidden=value;if(value===true)notifyAuthenticated();}});
 const ctx={URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
  location:{hostname:"fixture.invalid",hash:"",search:"",pathname:"/fill/"},
  history:{replaceState(){}},
  document:{querySelector:key=>el[key],querySelectorAll:key=>key===".nav-item"?nav:[]},
  sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),
   removeItem:key=>session.delete(key)},
  localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),
   removeItem:key=>local.delete(key)},
  fetch:async(path,options={})=>{
   assert.equal((options.method||"GET")==="GET",true,"Only fictional reads are permitted");
   calls.push({path,method:options.method||"GET"});
   if(path==="/api/me")return ok({user:{email:"qa@example.invalid"}});
   if(path==="/api/fmc/organizations")return ok({items:[{
    id:"fixture-org",name:"FICTIONAL READOUT CLUB",role:"support"}]});
   if(path.startsWith("/api/fmc/fixture-org/today"))return ok(data);
   if(path.startsWith("/api/fmc/fixture-org/calendar"))return reply(++calendarRequests);
   throw Error("Unexpected fictional readout request");
  }};
 vm.runInNewContext(app,ctx);
 await Promise.all([readoutReady,authenticated]);
 const visit=async view=>{
  const listener=nav.find(item=>item.dataset.view===view).listener("click");
  assert.equal(typeof listener==="function",true,"Original navigation handler must be registered");
  await listener();
 };
 assert.equal(el["#workspace"].hidden,false,"Fictional operator bootstrap must complete");
 const originalSession=session.get("fill.access");
 const originalOrg=el["#orgSelect"].value,originalIdentity=el["#identity"].textContent;
 await visit("today");
 assert.equal(el["#todayView"].hidden,false,"Original Today navigation must expose the readout");
 assert.equal(el["#kpis"].innerHTML.length>0,true,"Today readout precondition must be populated");
 assert.equal(el["#courtUtilisation"].innerHTML.includes(courtLabel),true,
  "Today readout precondition must contain the fictional court");
 await visit("revenue");
 assert.equal(el["#revenueView"].hidden,false,"Original Revenue navigation must expose the readout");
 assert.equal(el["#revenueKpis"].innerHTML.length>0,true,"Revenue readout precondition must be populated");
 assert.equal(el["#courtComparison"].innerHTML.includes(courtLabel),true,
  "Revenue readout precondition must contain the fictional court");
 const bootstrapCalls=calls.slice();
 assert.equal(bootstrapCalls.length,3,"Exactly three fictional bootstrap reads are expected");
 assert.equal(JSON.stringify(bootstrapCalls.map(call=>new URL(call.path,"https://fixture.invalid").pathname))===
  JSON.stringify(["/api/me","/api/fmc/organizations","/api/fmc/fixture-org/today"]),true);
 await visit("calendar");
 assert.equal(el["#calendarTimeline"].innerHTML.includes("lane-cell booked"),true,
  "An occupied Calendar snapshot must precede the denial");
 await visit("calendar");
 assert.equal(el["#calendarTimeline"].innerHTML==="",true,"Denied Calendar must clear its timeline");
 assert.equal(/lane-cell open|court-grid|unoccupied in Core/.test(el["#calendarTimeline"].innerHTML),false);
 assert.equal(el["#error"].hidden,false);
 assert.equal(el["#error"].textContent.includes(permission),true,"The current permission error must remain observable");
 await visit("today");
 assert.equal(el["#todayView"].hidden,false);
 const todayCleared=readoutIds.slice(0,3).every(id=>el[id].innerHTML==="");
 await visit("revenue");
 assert.equal(el["#revenueView"].hidden,false);
 const revenueCleared=readoutIds.slice(3).every(id=>el[id].innerHTML==="");
 assert.equal(session.has("fill.access"),true);
 assert.equal(session.get("fill.access")===originalSession,true);
 assert.equal(el["#authGate"].hidden,true);
 assert.equal(el["#workspace"].hidden,false);
 assert.equal(el["#orgSelect"].value===originalOrg,true);
 assert.equal(el["#identity"].textContent===originalIdentity,true);
 const calendarPath="/api/fmc/fixture-org/calendar?"+new URLSearchParams({
  start:today.day_start,end:today.day_end}).toString();
 assert.equal(JSON.stringify(calls.slice(bootstrapCalls.length))===
  JSON.stringify([{path:calendarPath,method:"GET"},{path:calendarPath,method:"GET"}]),true);
 assert.equal(calls.length,5,"No retry or fallback is permitted after the denial");
 assert.equal(calendarRequests,2);
 assert.equal(calls.every(call=>call.method==="GET"),true);
 assert.equal(todayCleared&&revenueCleared,true,
  "Current Calendar403 must evict cached Today and Revenue readouts");
});

test("Older Calendar 403 preserves newer populated Today Revenue and Calendar readouts",{timeout:2000},async()=>{
 const permission="FICTIONAL STALE READOUT PERMISSION DENIED";
 let calendarRequests=0,completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});
 const olderStarted=new Promise(done=>{notifyOlder=done;});
 const reply=number=>{
  assert.equal(number<=2,true,"Only two fictional Calendar reads are permitted");
  if(number===1){notifyOlder();return older;}
  return ok(occupiedCalendar("FICTIONAL NEWER READOUT SNAPSHOT"));
 };
 const el=Object.fromEntries(ids.map(id=>[id,make()]));
 const nav=["today","calendar","revenue"].map(view=>make({view}));
 const session=new Map([["fill.access",String(Symbol())]]),local=new Map(),calls=[];
 const readoutIds=["#kpis","#courtUtilisation","#emptyCapacity",
  "#revenueKpis","#opportunityQueue","#courtComparison"];
 for(const id of [...readoutIds,"#calendarTimeline"]){
  const node=el[id];let visibleText=node.textContent;
  Object.defineProperty(node,"textContent",{enumerable:true,configurable:true,
   get:()=>visibleText,set:value=>{visibleText=value;if(value==="")node.innerHTML="";}});
 }
 const courtLabel="FICTIONAL CACHED READOUT COURT";
 const data={...coveredToday,summary:{...coveredToday.summary,
  booked_minutes:60,empty_minutes:1380,revenue_minor:2400,bookings:1,utilization_pct:100/24},
  courts:coveredToday.courts.map(court=>({...court,court_name:courtLabel,
   booked_minutes:60,empty_minutes:1380,revenue_minor:2400,bookings:1,utilization_pct:100/24}))};
 let notifyReadout,notifyAuthenticated;
 const readoutReady=new Promise(done=>{notifyReadout=done;});
 const authenticated=new Promise(done=>{notifyAuthenticated=done;});
 let publicKpis="",publicAuthHidden=el["#authGate"].hidden;
 Object.defineProperty(el["#kpis"],"innerHTML",{enumerable:true,configurable:true,
  get:()=>publicKpis,set:value=>{publicKpis=value;if(String(value).length)notifyReadout();}});
 Object.defineProperty(el["#authGate"],"hidden",{enumerable:true,configurable:true,
  get:()=>publicAuthHidden,set:value=>{publicAuthHidden=value;if(value===true)notifyAuthenticated();}});
 const ctx={URLSearchParams,Intl,Date,Map,Number,String,Error,Headers,encodeURIComponent,
  location:{hostname:"fixture.invalid",hash:"",search:"",pathname:"/fill/"},
  history:{replaceState(){}},
  document:{querySelector:key=>el[key],querySelectorAll:key=>key===".nav-item"?nav:[]},
  sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),
   removeItem:key=>session.delete(key)},
  localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),
   removeItem:key=>local.delete(key)},
  fetch:async(path,options={})=>{
   assert.equal((options.method||"GET")==="GET",true,"Only fictional reads are permitted");
   calls.push({path,method:options.method||"GET"});
   if(path==="/api/me")return ok({user:{email:"qa@example.invalid"}});
   if(path==="/api/fmc/organizations")return ok({items:[{
    id:"fixture-org",name:"FICTIONAL READOUT CLUB",role:"support"}]});
   if(path.startsWith("/api/fmc/fixture-org/today"))return ok(data);
   if(path.startsWith("/api/fmc/fixture-org/calendar"))return reply(++calendarRequests);
   throw Error("Unexpected fictional readout request");
  }};
 vm.runInNewContext(app,ctx);
 await Promise.all([readoutReady,authenticated]);
 const visit=async view=>{
  const listener=nav.find(item=>item.dataset.view===view).listener("click");
  assert.equal(typeof listener==="function",true,"Original navigation handler must be registered");
  await listener();
 };
 assert.equal(el["#workspace"].hidden,false,"Fictional operator bootstrap must complete");
 const originalSession=session.get("fill.access");
 const originalOrg=el["#orgSelect"].value,originalIdentity=el["#identity"].textContent;
 await visit("today");
 assert.equal(el["#todayView"].hidden,false,"Original Today navigation must expose the readout");
 assert.equal(el["#kpis"].innerHTML.length>0,true,"Today readout precondition must be populated");
 assert.equal(el["#courtUtilisation"].innerHTML.includes(courtLabel),true,
  "Today readout precondition must contain the fictional court");
 await visit("revenue");
 assert.equal(el["#revenueView"].hidden,false,"Original Revenue navigation must expose the readout");
 assert.equal(el["#revenueKpis"].innerHTML.length>0,true,"Revenue readout precondition must be populated");
 assert.equal(el["#courtComparison"].innerHTML.includes(courtLabel),true,
  "Revenue readout precondition must contain the fictional court");
 const bootstrapCalls=calls.slice();
 assert.equal(bootstrapCalls.length,3,"Exactly three fictional bootstrap reads are expected");
 assert.equal(JSON.stringify(bootstrapCalls.map(call=>new URL(call.path,"https://fixture.invalid").pathname))===
  JSON.stringify(["/api/me","/api/fmc/organizations","/api/fmc/fixture-org/today"]),true);
 const oldRequest=visit("calendar");
 await olderStarted;
 await visit("calendar");
 const newerReadouts=readoutIds.map(id=>el[id].innerHTML);
 const newerGrid=el["#calendarTimeline"].innerHTML;
 const newerError={hidden:el["#error"].hidden,text:el["#error"].textContent};
 assert.equal(newerGrid.includes("lane-cell booked"),true);
 assert.equal(newerGrid.includes("FICTIONAL NEWER READOUT SNAPSHOT"),true);
 assert.equal(newerError.hidden,true);
 completeOlder({ok:false,status:403,json:async()=>({error:permission})});
 await oldRequest;
 assert.equal(readoutIds.every((id,index)=>el[id].innerHTML===newerReadouts[index]),true,
  "Stale403 must preserve every newer shared readout");
 assert.equal(el["#calendarTimeline"].innerHTML===newerGrid,true);
 assert.equal(el["#error"].hidden===newerError.hidden,true);
 assert.equal(el["#error"].textContent===newerError.text,true);
 assert.equal(el["#error"].textContent.includes(permission),false);
 await visit("today");
 assert.equal(el["#todayView"].hidden,false);
 assert.equal(el["#courtUtilisation"].innerHTML.includes(courtLabel),true);
 await visit("revenue");
 assert.equal(el["#revenueView"].hidden,false);
 assert.equal(el["#courtComparison"].innerHTML.includes(courtLabel),true);
 assert.equal(readoutIds.every((id,index)=>el[id].innerHTML===newerReadouts[index]),true);
 assert.equal(session.has("fill.access"),true);
 assert.equal(session.get("fill.access")===originalSession,true);
 assert.equal(el["#authGate"].hidden,true);
 assert.equal(el["#workspace"].hidden,false);
 assert.equal(el["#orgSelect"].value===originalOrg,true);
 assert.equal(el["#identity"].textContent===originalIdentity,true);
 const calendarPath="/api/fmc/fixture-org/calendar?"+new URLSearchParams({
  start:today.day_start,end:today.day_end}).toString();
 assert.equal(JSON.stringify(calls.slice(bootstrapCalls.length))===
  JSON.stringify([{path:calendarPath,method:"GET"},{path:calendarPath,method:"GET"}]),true);
 assert.equal(calls.length,5,"A stale denial must not retry or fall back");
 assert.equal(calendarRequests,2);
 assert.equal(calls.every(call=>call.method==="GET"),true);
});

// Calendar instants must identify real aware Core datetimes, not Date.parse guesses.
const temporalRows=["bookings","holds","blocks"];
function temporalSnapshot(kind,start,end){
 const body=emptyCalendar();
 body[kind].push({court_id:rowCourt,starts_at:start,ends_at:end,
  ...(kind==="bookings"?{status:"confirmed",source:"FICTIONAL TEMPORAL ROW"}:{})});
 return body;
}
const malformedInstants=[
 ["date-only","2026-10-25","2026-10-26"],
 ["offsetless repeated hour","2026-10-25T01:30:00","2026-10-25T02:30:00"],
 ["normalized February day","2026-02-30T09:00:00Z","2026-02-30T10:00:00Z"],
 ["non-leap February 29","2026-02-29T09:00:00Z","2026-02-29T10:00:00Z"],
 ["normalized April day","2026-04-31T09:00:00+01:00","2026-04-31T10:00:00+01:00"],
 ["hour 24","2026-10-19T24:00:00Z","2026-10-20T01:00:00Z"],
 ["offset without colon","2026-10-19T09:00:00+0100","2026-10-19T10:00:00+0100"],
 ["space separator","2026-10-19 09:00:00Z","2026-10-19 10:00:00Z"],
 ["lowercase spelling","2026-10-19t09:00:00z","2026-10-19t10:00:00z"],
 ["missing seconds","2026-10-19T09:00Z","2026-10-19T10:00Z"],
 ["invalid minute","2026-10-19T09:60:00Z","2026-10-19T11:00:00Z"],
 ["invalid offset","2026-10-19T09:00:00+24:00","2026-10-19T10:00:00+24:00"],
 ["unsupported precision","2026-10-19T09:00:00.0000001Z","2026-10-19T10:00:00.0000001Z"],
];
for(const kind of temporalRows)for(const [name,start,end] of malformedInstants){
 test(`Calendar ${kind} rejects ${name} through load/error/cleared-grid`,async()=>{
  await assertMalformedOccupancyRow(temporalSnapshot(kind,start,end));
 });
}
// A valid start must not hide an invalid end; both boundaries are mandatory.
for(const kind of temporalRows)test(`Calendar ${kind} rejects impossible end with valid start`,async()=>{
 await assertMalformedOccupancyRow(temporalSnapshot(kind,
  "2026-02-28T09:00:00Z","2026-02-30T10:00:00Z"));
});

const validInstants=[
 {name:"ordinary Z",start:"2026-10-19T08:00:00Z",end:"2026-10-19T09:00:00Z"},
 {name:"ordinary explicit offset",start:"2026-10-19T09:00:00+01:00",end:"2026-10-19T10:00:00+01:00"},
 {name:"negative offset",start:"2026-10-19T04:00:00-04:00",end:"2026-10-19T05:00:00-04:00"},
 {name:"cross-day clipping",start:"2026-10-18T23:30:00+01:00",end:"2026-10-19T00:30:00+01:00",occupied:1},
 {name:"leap day",date:"2028-02-29",dayStart:"2028-02-29T00:00:00Z",dayEnd:"2028-03-01T00:00:00Z",
  start:"2028-02-29T09:00:00Z",end:"2028-02-29T10:00:00Z"},
 {name:"spring jump",date:"2026-03-29",dayStart:"2026-03-29T00:00:00+00:00",dayEnd:"2026-03-30T00:00:00+01:00",
  start:"2026-03-29T00:30:00+00:00",end:"2026-03-29T02:30:00+01:00",cells:46},
 {name:"fall repeated hour",date:"2026-10-25",dayStart:"2026-10-25T00:00:00+01:00",dayEnd:"2026-10-26T00:00:00+00:00",
  start:"2026-10-25T01:30:00+01:00",end:"2026-10-25T01:30:00+00:00",cells:50},
 ...Array.from({length:6},(_,i)=>({name:`Core fraction ${i+1} digits`,
  start:`2026-10-19T08:00:00.${"123456".slice(0,i+1)}Z`,
  end:`2026-10-19T09:00:00.${"123456".slice(0,i+1)}Z`,occupied:3})),
 {name:"Core microseconds within one millisecond",start:"2026-10-19T08:00:00.000001Z",end:"2026-10-19T08:00:00.000002Z",occupied:1},
 {name:"Core microseconds past half-hour boundary",start:"2026-10-19T08:29:59.999999Z",end:"2026-10-19T08:30:00.000001Z",occupied:2},
];
for(const kind of temporalRows)for(const data of validInstants){
 test(`Calendar ${kind} preserves ${data.name} occupancy and real-day grid`,async()=>{
  const day={...coveredToday,date:data.date||today.date,
   day_start:data.dayStart||today.day_start,day_end:data.dayEnd||today.day_end,
   courts:coveredToday.courts.map(court=>({...court,sellable_windows:[{
    starts_at:data.dayStart||today.day_start,ends_at:data.dayEnd||today.day_end}]}))};
  const fixture=await calendarFixture(()=>ok(temporalSnapshot(kind,data.start,data.end)),day);
  await fixture.visit();
  const grid=fixture.el["#calendarTimeline"].innerHTML;
  assert.equal(fixture.el["#error"].hidden,true,"Valid aware Core interval must load");
  assert.match(grid,new RegExp(`grid-template-columns:repeat\\(${data.cells||48},`));
  const occupiedClass={bookings:"booked",holds:"held",blocks:"blocked"}[kind];
  assert.equal((grid.match(new RegExp(`class="lane-cell ${occupiedClass}"`,"g"))||[]).length,
   data.occupied||2,"No valid occupancy may disappear or become free");
  assert.equal((grid.match(/class="lane-cell open"/g)||[]).length,
   (data.cells||48)-(data.occupied||2));
  assertCalendarSession(fixture);
 });
}

test("Stale timezone-less Calendar body preserves a newer valid grid and session",async()=>{
 let completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});
 const started=new Promise(done=>{notifyOlder=done;});
 const fixture=await calendarFixture(n=>n===1?{ok:true,status:200,
  json:()=>{notifyOlder();return older;}}:ok(occupiedCalendar("FICTIONAL AWARE NEWER")));
 const pending=fixture.visit();await started;await fixture.visit();
 const grid=fixture.el["#calendarTimeline"].innerHTML;
 assert.match(grid,/FICTIONAL AWARE NEWER/);
 completeOlder(temporalSnapshot("bookings","2026-10-25T01:30:00","2026-10-25T02:30:00"));
 await pending;
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,grid);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});

// Core bookings with status held occupy time even when no active hold row exists.
function heldBookingSnapshot(start,end){
 const body=temporalSnapshot("bookings",start,end);
 body.bookings[0].status="held";
 return body;
}
const heldTemporalCases=validInstants.filter(data=>[
 "ordinary Z","ordinary explicit offset","cross-day clipping","spring jump",
 "fall repeated hour","Core microseconds within one millisecond",
 "Core microseconds past half-hour boundary"].includes(data.name));
assert.equal(heldTemporalCases.length,7);
for(const data of heldTemporalCases)test(`Held booking preserves ${data.name} as held occupancy`,async()=>{
 const day={...coveredToday,date:data.date||today.date,
  day_start:data.dayStart||today.day_start,day_end:data.dayEnd||today.day_end,
  courts:coveredToday.courts.map(court=>({...court,sellable_windows:[{
   starts_at:data.dayStart||today.day_start,ends_at:data.dayEnd||today.day_end}]}))};
 const fixture=await calendarFixture(()=>ok(heldBookingSnapshot(data.start,data.end)),day);
 await fixture.visit();
 const grid=fixture.el["#calendarTimeline"].innerHTML;
 assert.equal(fixture.el["#error"].hidden,true);
 assert.equal((grid.match(/class="lane-cell held"/g)||[]).length,data.occupied||2,
  "A held booking must occupy the same Core instants without becoming free");
 assert.equal((grid.match(/class="lane-cell open"/g)||[]).length,
  (data.cells||48)-(data.occupied||2));
 assert.doesNotMatch(grid,/class="lane-cell booked"/);
 assert.match(grid,/<span>Hold<\/span>/,"Held booking presentation must say Hold");
 assert.match(grid,/Active booking hold/);
 assert.match(grid,new RegExp(`grid-template-columns:repeat\\(${data.cells||48},`));
 assertCalendarSession(fixture);
});

test("Held booking remains occupied on an unpriced court without tariff fallback",async()=>{
 const day={...coveredToday,summary:{...coveredToday.summary,courts_with_rate_coverage:0},
  courts:coveredToday.courts.map(court=>({...court,has_rate_coverage:false,sellable_windows:[]}))};
 const fixture=await calendarFixture(()=>ok(heldBookingSnapshot(
  "2026-10-19T09:00:00+01:00","2026-10-19T10:00:00+01:00")),day);
 await fixture.visit();
 const grid=fixture.el["#calendarTimeline"].innerHTML;
 assert.equal((grid.match(/class="lane-cell held"/g)||[]).length,2);
 assert.equal((grid.match(/class="lane-cell closed"/g)||[]).length,46);
 assert.doesNotMatch(grid,/lane-cell open|lane-cell booked/);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});

test("Held bookings coexist with confirmed pending active holds blocks and nonoccupying history",async()=>{
 const row=(status,start,end)=>({court_id:rowCourt,status,
  starts_at:`2026-10-19T${start}:00+01:00`,ends_at:`2026-10-19T${end}:00+01:00`});
 const body={bookings:[row("held","09:00","10:00"),row("confirmed","10:00","11:00"),
  row("pending_payment","11:00","12:00"),row("cancelled","13:00","14:00"),
  row("fictional_history","14:00","15:00")],holds:[row("held","12:00","12:30")],
  blocks:[row("blocked","12:30","13:00")]};
 const fixture=await calendarFixture(()=>ok(body));await fixture.visit();
 const grid=fixture.el["#calendarTimeline"].innerHTML;
 assert.equal((grid.match(/class="lane-cell booked"/g)||[]).length,4);
 assert.equal((grid.match(/class="lane-cell blocked"/g)||[]).length,1);
 assert.equal((grid.match(/class="lane-cell held"/g)||[]).length,3);
 assert.equal((grid.match(/class="lane-cell open"/g)||[]).length,40);
 assert.doesNotMatch(grid,/fictional_history|cancelled/);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});

test("Held booking overlap retains block priority and half-open interval edges",async()=>{
 const body=heldBookingSnapshot("2026-10-19T09:00:00+01:00","2026-10-19T10:00:00+01:00");
 body.blocks.push({court_id:rowCourt,starts_at:"2026-10-19T09:30:00+01:00",
  ends_at:"2026-10-19T10:00:00+01:00",reason:"FICTIONAL OVERLAPPING BLOCK"});
 const fixture=await calendarFixture(()=>ok(body));await fixture.visit();
 const grid=fixture.el["#calendarTimeline"].innerHTML;
 assert.equal((grid.match(/class="lane-cell blocked"/g)||[]).length,1);
 assert.equal((grid.match(/class="lane-cell held"/g)||[]).length,1);
 assert.equal((grid.match(/class="lane-cell open"/g)||[]).length,46);
 assert.match(grid,/FICTIONAL OVERLAPPING BLOCK/);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});

test("Older malformed Calendar cannot erase a newer held-booking grid or revoke session",async()=>{
 let completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});
 const started=new Promise(done=>{notifyOlder=done;});
 const fixture=await calendarFixture(n=>n===1?{ok:true,status:200,
  json:()=>{notifyOlder();return older;}}:ok(heldBookingSnapshot(
   "2026-10-19T09:00:00+01:00","2026-10-19T10:00:00+01:00")));
 const pending=fixture.visit();await started;await fixture.visit();
 const newer=fixture.el["#calendarTimeline"].innerHTML;
 // The old body is malformed; its late validation failure must also stay stale.
 completeOlder({bookings:[],holds:[]});await pending;
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,newer);
 assert.equal((newer.match(/class="lane-cell held"/g)||[]).length,2);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});

test("Older held-booking response cannot overwrite newer confirmed occupancy",async()=>{
 let completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});
 const started=new Promise(done=>{notifyOlder=done;});
 const fixture=await calendarFixture(n=>{if(n===1){notifyOlder();return older;}
  return ok(occupiedCalendar("FICTIONAL NEWER CONFIRMED"));});
 const pending=fixture.visit();await started;await fixture.visit();
 const newer=fixture.el["#calendarTimeline"].innerHTML;
 completeOlder(ok(heldBookingSnapshot("2026-10-19T09:00:00+01:00","2026-10-19T10:00:00+01:00")));
 await pending;
 assert.equal(fixture.el["#calendarTimeline"].innerHTML,newer);
 assert.match(newer,/FICTIONAL NEWER CONFIRMED/);
 assert.equal((newer.match(/class="lane-cell booked"/g)||[]).length,48);
 assert.equal(fixture.el["#error"].hidden,true);
 assertCalendarSession(fixture);
});
