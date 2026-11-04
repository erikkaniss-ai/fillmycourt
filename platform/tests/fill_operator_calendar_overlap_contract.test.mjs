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

async function calendarFixture(reply){
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
  if(path.startsWith("/api/fmc/fixture-org/today"))return ok(coveredToday);
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

