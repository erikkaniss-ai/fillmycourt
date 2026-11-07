import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appPath = new URL("../public/fill/app.js", import.meta.url);
const htmlPath = new URL("../public/fill/index.html", import.meta.url);
const appSource = await readFile(appPath, "utf8");
const htmlSource = await readFile(htmlPath, "utf8");

const fixtureToday = {
  date: "2026-10-16", day_start: "2026-10-16T00:00:00+01:00", day_end: "2026-10-17T00:00:00+01:00", timezone: "Europe/Lisbon", currency: "EUR",
  summary: { capacity_minutes: 1080, booked_minutes: 180, held_minutes: 0, blocked_minutes: 0, empty_minutes: 900, utilization_pct: 16.7, bookings: 1, cancellations: 0, revenue_minor: 3600, active_courts: 2, courts_with_rate_coverage: 1, courts_without_rate_coverage: 1, bookable_60_starts: 9, bookable_90_starts: 8, highest_single_quote_minor: 3600, highest_single_quote_duration_minutes: 90 },
  courts: [
    { court_id: "court-fixture", court_name: "Fixture Court — not a partner", has_rate_coverage: true, open_start_minute: 540, open_end_minute: 1080, capacity_minutes: 540, booked_minutes: 180, held_minutes: 0, blocked_minutes: 0, bookings: 1, cancellations: 0, revenue_minor: 3600, utilization_pct: 33.3, empty_minutes: 360, sellable_windows: [{ start_minute: 540, end_minute: 1080 }] },
    { court_id: "court-unpriced", court_name: "Unpriced Court — fixture", has_rate_coverage: false, open_start_minute: 0, open_end_minute: 0, capacity_minutes: 0, booked_minutes: 0, held_minutes: 0, blocked_minutes: 0, bookings: 0, cancellations: 0, revenue_minor: 0, utilization_pct: 0, empty_minutes: 0, sellable_windows: [] },
  ],
  empty_windows: [{ court_id: "court-fixture", court_name: "Fixture Court — not a partner", starts_at: "2026-10-16T12:00:00+01:00", ends_at: "2026-10-16T15:00:00+01:00", duration_minutes: 180, bookable_60_count: 5, min_60_amount_minor: 2400, max_60_amount_minor: 2400, bookable_90_count: 4, min_90_amount_minor: 3600, max_90_amount_minor: 3600, best_amount_minor: 3600, best_duration_minutes: 90, best_starts_at: "2026-10-16T12:00:00+01:00", currency: "EUR" }],
};

// Only the synthetic UI's initial selected day is fixed, independently of
// the response body. Real request dates must not silently follow a bad reply.
function fixtureClock(day) {
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [day + "T12:00:00Z"])); }
  };
}
function todayForFixtureDate(day) {
  const body = structuredClone(fixtureToday);
  const next = {"2026-10-16": "2026-10-17", "2026-10-17": "2026-10-18"}[day];
  assert.ok(next, "Only explicit fictional October fixture days are supported");
  body.date = day;
  body.day_start = day + "T00:00:00+01:00";
  body.day_end = next + "T00:00:00+01:00";
  for (const window of body.empty_windows) for (const key of ["starts_at", "ends_at", "best_starts_at"])
    window[key] = day + window[key].slice(10);
  return body;
}

function makeElement(dataset = {}) {
  const listeners = new Map();
  let text = "";
  return { dataset, hidden: false, disabled: false, value: "", innerHTML: "",
    get textContent() { return text; },
    set textContent(value) { text = value; this.innerHTML = ""; },
    classList: { toggle() {} }, addEventListener(type, handler) { listeners.set(type, handler); }, listener(type) { return listeners.get(type); } };
}

test("Fill operator data use only Core GET contracts; password auth is separate", async () => {
  assert.match(htmlSource, /Staging · read-only/);
  assert.match(htmlSource, /not partner availability/i);
  assert.match(appSource, /\/api\/fmc\/\$\{encodeURIComponent\(org\)\}\/today/);
  assert.match(appSource, /\/api\/fmc\/\$\{encodeURIComponent\(org\)\}\/calendar/);
  assert.match(appSource, /method: "POST"/);
  assert.match(appSource, /"\/api\/fmc-auth\/login"/);
  assert.doesNotMatch(appSource, /\/opportunities|\/crm-actions|\/attributions|\/disputes/);

  const elements = Object.fromEntries(["#authGate", "#workspace", "#orgSelect", "#identity", "#signOut", "#dateInput", "#refreshButton", "#error", "#pageTitle", "#todayView", "#calendarView", "#revenueView", "#kpis", "#courtUtilisation", "#utilisationBadge", "#emptyCapacity", "#calendarTimeline", "#revenueKpis", "#opportunityQueue", "#courtComparison", "#operatorSignIn", "#operatorEmail", "#operatorPassword", "#operatorLoginButton", "#operatorLoginError"].map((id) => [id, makeElement()]));
  const navigation = [makeElement({ view: "today" }), makeElement({ view: "calendar" }), makeElement({ view: "revenue" })];
  const calls = [];
  const local = new Map([["fill.access", "stale-persistent-fixture"]]);
  const session = new Map([["fill.access", "fixture-session"]]);
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  const context = {
    URLSearchParams, Intl, Date: fixtureClock(fixtureToday.date), Map, Number, String, Error, Headers, encodeURIComponent,
    document: { querySelector(selector) { return elements[selector]; }, querySelectorAll(selector) { return selector === ".nav-item" ? navigation : []; } },
    location: { hash: "", pathname: "/fill/", search: "" }, history: { replaceState() {} },
    localStorage: { getItem: (key) => local.get(key) || null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) },
    sessionStorage: { getItem: (key) => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: (key) => session.delete(key) },
    fetch: async (path, options = {}) => {
      calls.push({ path, method: options.method || "GET" });
      if (path === "/api/me") return response({ user: { email: "operator@example.test" } });
      if (path === "/api/fmc/organizations") return response({ items: [{ id: "org-fixture", name: "Fixture Club", role: "manager" }] });
      if (path.startsWith("/api/fmc/org-fixture/today?")) return response(fixtureToday);
      if (path.startsWith("/api/fmc/org-fixture/calendar?")) return response({ bookings: [{ court_id: "court-fixture", status: "confirmed", starts_at: "2026-10-16T09:00:00+01:00", ends_at: "2026-10-16T12:00:00+01:00", source: "fixture" }], holds: [], blocks: [] });
      throw new Error(`Unexpected request ${path}`);
    },
  };
  vm.runInNewContext(appSource, context, { filename: "fill/app.js" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(local.has("fill.access"), false, "stale persistent bearer purged");
  assert.equal(session.get("fill.access"), "fixture-session");
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET"]);
  assert.match(elements["#courtUtilisation"].innerHTML, /Needs rate coverage/);
  assert.match(elements["#opportunityQueue"].innerHTML, /Capacity candidate only/);
  assert.match(elements["#opportunityQueue"].innerHTML, /Fixture Court — not a partner/);
  assert.match(elements["#revenueKpis"].innerHTML, /60-min starts/);
  await navigation[1].listener("click")();
  assert.equal(calls.at(-1).method, "GET");
  assert.match(calls.at(-1).path, /\/calendar\?/);
  assert.match(elements["#calendarTimeline"].innerHTML, /lane-cell booked/);
});


async function renderMoneyFixture(today, organizations = [{ id: "org-fixture", name: "Fixture Club", role: "manager" }], requestDate = fixtureToday.date) {
  const elements = Object.fromEntries(["#authGate", "#workspace", "#orgSelect", "#identity", "#signOut", "#dateInput", "#refreshButton", "#error", "#pageTitle", "#todayView", "#calendarView", "#revenueView", "#kpis", "#courtUtilisation", "#utilisationBadge", "#emptyCapacity", "#calendarTimeline", "#revenueKpis", "#opportunityQueue", "#courtComparison", "#operatorSignIn", "#operatorEmail", "#operatorPassword", "#operatorLoginButton", "#operatorLoginError"].map((id) => [id, makeElement()]));
  const navigation = [makeElement({ view: "today" }), makeElement({ view: "calendar" }), makeElement({ view: "revenue" })];
  const calls = [];
  const local = new Map([["fill.access", "stale-persistent-fixture"]]);
  const session = new Map([["fill.access", "fixture-session"]]);
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  let todayReply = () => response(today);
  const context = {
    URLSearchParams, Intl, Date: fixtureClock(requestDate), Map, Number, String, Error, Headers, encodeURIComponent,
    document: { querySelector(selector) { return elements[selector]; }, querySelectorAll(selector) { return selector === ".nav-item" ? navigation : []; } },
    location: { hash: "", pathname: "/fill/", search: "" }, history: { replaceState() {} },
    localStorage: { getItem: (key) => local.get(key) || null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) },
    sessionStorage: { getItem: (key) => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: (key) => session.delete(key) },
    fetch: async (path, options = {}) => {
      calls.push({ path, method: options.method || "GET" });
      if (path === "/api/me") return response({ user: { email: "operator@example.test" } });
      if (path === "/api/fmc/organizations") return response({ items: organizations });
      if (organizations.some(org => path.startsWith(`/api/fmc/${org.id}/today?`))) return todayReply(path);
      if (path.startsWith("/api/fmc/org-fixture/calendar?")) return response({ bookings: [{ court_id: "court-fixture", status: "confirmed", starts_at: "2026-10-16T09:00:00+01:00", ends_at: "2026-10-16T12:00:00+01:00", source: "fixture" }], holds: [], blocks: [] });
      throw new Error(`Unexpected request ${path}`);
    },
  };
  vm.runInNewContext(appSource, context, { filename: "fill/app.js" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { elements, calls, navigation, session,
    setTodayReply(reply) { todayReply = reply; },
    refresh: () => elements["#refreshButton"].listener("click")() };
}


for (const [minor, visible] of [[0, "\u20ac0.00"], [1, "\u20ac0.01"], [99, "\u20ac0.99"], [100, "\u20ac1.00"], [12345, "\u20ac123.45"]]) {
  test(`EUR minor-unit precision is visible across Today and Recovery: ${minor}`, async () => {
    const today = structuredClone(fixtureToday);
    today.currency = "EUR";
    today.summary.revenue_minor = minor;
    today.summary.highest_single_quote_minor = minor;
    today.courts = [{ ...today.courts[0], revenue_minor: minor }];
    today.empty_windows = [{ ...today.empty_windows[0], court_id: today.courts[0].court_id,
      currency: "EUR", best_amount_minor: minor,
      min_60_amount_minor: minor, max_60_amount_minor: minor,
      min_90_amount_minor: minor, max_90_amount_minor: minor }];
    const { elements, calls } = await renderMoneyFixture(today);
    const regions = ["#kpis", "#revenueKpis", "#opportunityQueue", "#courtComparison"];
    const missing = regions.filter((id) => !elements[id].innerHTML.includes(visible));
    const comparisonOccurrences = elements["#courtComparison"].innerHTML.split(visible).length - 1;
    if (missing.length || comparisonOccurrences < 2) {
      console.log(`FILL_EUR_PRECISION_RED minor=${minor} missing_regions=${missing.length} comparison_both=${Number(comparisonOccurrences >= 2)}`);
    }
    assert.deepEqual(missing, [], "Every visible money region preserves the declared EUR hundredths");
    assert.ok(comparisonOccurrences >= 2, "Court comparison preserves both revenue and best quote");
    assert.ok(calls.every((call) => call.method === "GET"), "Rendering remains read-only");
    console.log(`FILL_EUR_PRECISION_PASS minor=${minor} regions=4 comparison_both=1`);
  });
}

test("Money presentation preserves fictional court escaping and existing USD display policy", async () => {
  const today = structuredClone(fixtureToday);
  today.currency = "USD";
  today.summary.revenue_minor = 12345;
  today.summary.highest_single_quote_minor = 12345;
  const unsafeName = '<img src=x onerror="fictional">';
  today.courts = [{ ...today.courts[0], court_name: unsafeName, revenue_minor: 12345 }];
  today.empty_windows = [{ ...today.empty_windows[0], court_id: today.courts[0].court_id,
    court_name: unsafeName, currency: "USD", best_amount_minor: 12345 }];
  const { elements, calls } = await renderMoneyFixture(today);
  for (const id of ["#kpis", "#revenueKpis", "#opportunityQueue", "#courtComparison"]) {
    assert.ok(elements[id].innerHTML.includes("US$123"), "Existing USD visible amount remains unchanged");
    assert.ok(!elements[id].innerHTML.includes(unsafeName), "Fictional court markup is escaped");
  }
  assert.ok(elements["#courtComparison"].innerHTML.includes("&lt;img"), "Escaped court remains visible");
  assert.ok(calls.every((call) => call.method === "GET"), "Rendering remains read-only");
  today.summary.highest_single_quote_minor = 0;
  const zeroUsd = await renderMoneyFixture(today);
  assert.ok(!zeroUsd.elements["#revenueKpis"].innerHTML.includes("US$0"), "Existing non-EUR zero quote policy remains unchanged");
  console.log("FILL_EUR_COMPATIBILITY_PASS usd_policy=1 escaping=1 readonly=1");
});


test("An absent EUR Recovery quote stays unavailable instead of becoming a zero price", async () => {
  const today = structuredClone(fixtureToday);
  today.summary.highest_single_quote_minor = null;
  today.empty_windows = [];
  const { elements } = await renderMoneyFixture(today);
  assert.ok(!elements["#revenueKpis"].innerHTML.includes("\u20ac0.00"), "Missing source amount is not presented as zero");
  console.log("FILL_EUR_ABSENT_QUOTE_PASS unavailable_preserved=1");
});


for (const [kind, duration, present] of [["core_empty", null, false], ["free_60", 60, true], ["free_90", 90, true]]) {
  test(`Recovery quote presence distinguishes Core empty from configured free quote: ${kind}`, async () => {
    const today = structuredClone(fixtureToday);
    today.summary.highest_single_quote_minor = 0;
    today.summary.highest_single_quote_duration_minutes = duration;
    if (kind === "core_empty") {
      today.empty_windows = [];
      today.summary.bookable_60_starts = 0;
      today.summary.bookable_90_starts = 0;
    } else {
      today.empty_windows = [{ ...today.empty_windows[0], currency: "EUR",
        best_amount_minor: 0, best_duration_minutes: duration,
        min_60_amount_minor: 0, max_60_amount_minor: 0,
        bookable_90_count: duration === 90 ? 1 : 0,
        min_90_amount_minor: duration === 90 ? 0 : null,
        max_90_amount_minor: duration === 90 ? 0 : null }];
    }
    const { elements, calls } = await renderMoneyFixture(today);
    const cards = [...elements["#revenueKpis"].innerHTML.matchAll(/<article class="kpi">([\s\S]*?)<\/article>/g)]
      .map((match) => match[1]).filter((card) => card.includes("<span>Top slot quote</span>"));
    assert.equal(cards.length, 1, "Actual Recovery quote KPI is unique");
    const zero = cards[0].includes("<strong>\u20ac0.00</strong>");
    const absent = cards[0].includes("<strong>\u2014</strong>");
    if (!present && zero) console.log("FILL_QUOTE_PRESENCE_NODE_RED case=core_empty actual_zero_quote=1");
    assert.equal(zero, present, "Only configured quotes may show a monetary zero");
    assert.equal(absent, !present, "The existing absent marker represents an empty Core quote");
    assert.ok(calls.every((call) => call.method === "GET"), "Quote rendering remains read-only");
    console.log(`FILL_QUOTE_PRESENCE_NODE_PASS case=${kind} duration=${duration === null ? "none" : duration} present=${Number(present)}`);
  });
}


const privateReadoutIds=["#kpis","#courtUtilisation","#emptyCapacity","#calendarTimeline",
 "#revenueKpis","#opportunityQueue","#courtComparison"];
const todayOk=body=>({ok:true,status:200,json:async()=>body});
const copyToday=()=>structuredClone(fixtureToday);
function withoutTodayField(field){const body=copyToday();delete body[field];return body;}
const malformedToday=[
 ["empty object",{}],["array",[]],["null",null],["number",42],
 ["string","FICTIONAL BAD TODAY"],["boolean",false],
 ...["date","day_start","day_end","timezone","currency","summary","courts","empty_windows"]
  .map(field=>[`missing ${field}`,withoutTodayField(field)]),
 ...[null,[],{},0,"FICTIONAL BAD SUMMARY",false].map((summary,index)=>
  [`bad summary ${index}`,{...copyToday(),summary}]),
 ...["revenue_minor","utilization_pct","bookings"].map(field=>{
  const body=copyToday();body.summary[field]=null;return [`null summary ${field}`,body];}),
 ...["courts","empty_windows"].flatMap(field=>[null,{}].map((value,index)=>
  [`bad ${field} ${index}`,{...copyToday(),[field]:value}])),
];
function assertTodaySession(fixture){
 assert.equal(fixture.session.get("fill.access"),"fixture-session");
 assert.equal(fixture.elements["#authGate"].hidden,true);
 assert.equal(fixture.elements["#workspace"].hidden,false);
 assert.ok(fixture.calls.every(call=>call.method==="GET"),"Only fictional read requests are permitted");
}
function assertBadToday(fixture){
 assertTodaySession(fixture);
 assert.equal(fixture.elements["#error"].hidden,false);
 assert.equal(fixture.elements["#error"].textContent,"Unable to load Today. Try again.");
 for(const id of privateReadoutIds)assert.equal(fixture.elements[id].innerHTML,"",
  `Malformed Today must clear private ${id} instead of inventing zero or capacity`);
 assert.equal(fixture.elements["#utilisationBadge"].textContent,"—");
}
for(const [name,body] of malformedToday)test(`Current malformed Today ${name} clears all private readouts`,async()=>{
 const fixture=await renderMoneyFixture(copyToday());
 await fixture.navigation[1].listener("click")();
 for(const id of privateReadoutIds)assert.ok(fixture.elements[id].innerHTML.length>0,
  `Prior valid ${id} must actually be populated`);
 const before=fixture.calls.length;
 fixture.setTodayReply(()=>todayOk(body));await fixture.refresh();
 assertBadToday(fixture);
 assert.equal(fixture.calls.length,before+1,"No malformed-body retry or fallback Calendar request");
});
for(const [name,body] of [["object",{}],["array",[]],["null",null]])
 test(`Initial Today ${name} cannot fabricate zero metrics or expose raw exceptions`,async()=>{
  const fixture=await renderMoneyFixture(body);assertBadToday(fixture);
 });

test("Today 200 JSON decode failure is sanitized and clears prior readouts",async()=>{
 const fixture=await renderMoneyFixture(copyToday());
 await fixture.navigation[1].listener("click")();
 fixture.setTodayReply(()=>({ok:true,status:200,json:async()=>{throw Error("FICTIONAL PRIVATE JSON DETAIL");}}));
 await fixture.refresh();assertBadToday(fixture);
});

test("Valid authoritative empty Today preserves zero revenue and absent quote",async()=>{
 const body=copyToday();
 for(const key of Object.keys(body.summary))body.summary[key]=0;
 body.summary.highest_single_quote_duration_minutes=null;body.courts=[];body.empty_windows=[];
 const fixture=await renderMoneyFixture(body);assertTodaySession(fixture);
 assert.equal(fixture.elements["#error"].hidden,true);
 assert.match(fixture.elements["#kpis"].innerHTML,/<strong>€0.00<\/strong>/);
 assert.match(fixture.elements["#courtUtilisation"].innerHTML,/No active courts/);
 const card=[...fixture.elements["#revenueKpis"].innerHTML.matchAll(/<article class="kpi">([\s\S]*?)<\/article>/g)]
  .map(match=>match[1]).find(value=>value.includes("Top slot quote"));
 assert.match(card,/<strong>—<\/strong>/);
});

test("A valid Today after malformed response restores readouts without a new session",async()=>{
 const fixture=await renderMoneyFixture(copyToday());
 fixture.setTodayReply(()=>todayOk({}));await fixture.refresh();assertBadToday(fixture);
 const body=copyToday();body.summary.revenue_minor=1;
 fixture.setTodayReply(()=>todayOk(body));await fixture.refresh();
 assertTodaySession(fixture);assert.equal(fixture.elements["#error"].hidden,true);
 assert.match(fixture.elements["#kpis"].innerHTML,/<strong>€0.01<\/strong>/);
 assert.match(fixture.elements["#opportunityQueue"].innerHTML,/Fixture Court/);
});

for(const failure of ["body","decode"])test(`Stale Today ${failure} failure cannot erase newer valid readouts`,async()=>{
 const fixture=await renderMoneyFixture(copyToday());
 let completeOlder,notifyOlder;
 const started=new Promise(done=>{notifyOlder=done;});
 const older=new Promise((resolve,reject)=>{completeOlder=failure==="decode"?()=>reject(Error("FICTIONAL OLD DECODE DETAIL")):()=>resolve(null);});
 fixture.setTodayReply(()=>({ok:true,status:200,json:()=>{notifyOlder();return older;}}));
 const pending=fixture.refresh();await started;
 const body=copyToday();body.courts[0].court_name="FICTIONAL NEWER TODAY";
 fixture.setTodayReply(()=>todayOk(body));await fixture.refresh();
 const newer=privateReadoutIds.map(id=>fixture.elements[id].innerHTML);
 assert.match(newer[0],/Revenue/);assert.ok(newer.some(html=>html.includes("FICTIONAL NEWER TODAY")));
 completeOlder();await pending;
 assert.deepEqual(privateReadoutIds.map(id=>fixture.elements[id].innerHTML),newer);
 assert.equal(fixture.elements["#error"].hidden,true);assertTodaySession(fixture);
});

for(const navigation of ["date","tenant"])test(`Old malformed Today after ${navigation} change cannot overwrite newer club readout`,async()=>{
 const orgs=[{id:"org-fixture",name:"FICTIONAL CLUB A",role:"manager"},
  {id:"org-second",name:"FICTIONAL CLUB B",role:"support"}];
 const fixture=await renderMoneyFixture(copyToday(),orgs);
 let completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});const started=new Promise(done=>{notifyOlder=done;});
 fixture.setTodayReply(()=>({ok:true,status:200,json:()=>{notifyOlder();return older;}}));
 const pending=fixture.refresh();await started;
 const body=navigation==="date"?todayForFixtureDate("2026-10-17"):copyToday();body.courts[0].court_name="FICTIONAL NEWER NAVIGATION";
 fixture.setTodayReply(()=>todayOk(body));
 if(navigation==="date"){
  fixture.elements["#dateInput"].value="2026-10-17";
  await fixture.elements["#dateInput"].listener("change")();
 }else{
  fixture.elements["#orgSelect"].value="org-second";
  fixture.elements["#orgSelect"].listener("change")();
  await new Promise(done=>setTimeout(done,0));await new Promise(done=>setTimeout(done,0));
 }
 const newer=privateReadoutIds.map(id=>fixture.elements[id].innerHTML);
 assert.ok(newer.some(html=>html.includes("FICTIONAL NEWER NAVIGATION")));
 completeOlder({});await pending;
 assert.deepEqual(privateReadoutIds.map(id=>fixture.elements[id].innerHTML),newer);
 assert.equal(fixture.elements["#error"].hidden,true);assertTodaySession(fixture);
});

test("Old malformed Today after logout cannot rehydrate metrics or report a private error",async()=>{
 const fixture=await renderMoneyFixture(copyToday());
 let completeOlder,notifyOlder;
 const older=new Promise(done=>{completeOlder=done;});const started=new Promise(done=>{notifyOlder=done;});
 fixture.setTodayReply(()=>({ok:true,status:200,json:()=>{notifyOlder();return older;}}));
 const pending=fixture.refresh();await started;
 fixture.elements["#signOut"].listener("click")();completeOlder(null);await pending;
 assert.equal(fixture.session.has("fill.access"),false);
 assert.equal(fixture.elements["#authGate"].hidden,false);
 assert.equal(fixture.elements["#workspace"].hidden,true);
 assert.equal(fixture.elements["#error"].hidden,true);
 for(const id of privateReadoutIds)assert.equal(fixture.elements[id].innerHTML,"");
});

for(const status of [401,403])test(`Current Today HTTP ${status} preserves existing auth semantics`,async()=>{
 const fixture=await renderMoneyFixture(copyToday());
 fixture.setTodayReply(()=>({ok:false,status,json:async()=>({error:"FICTIONAL TODAY DENIED"})}));
 await fixture.refresh();
 for(const id of privateReadoutIds)assert.equal(fixture.elements[id].innerHTML,"");
 if(status===401){
  assert.equal(fixture.session.has("fill.access"),false);
  assert.equal(fixture.elements["#authGate"].hidden,false);assert.equal(fixture.elements["#workspace"].hidden,true);
 }else{
  assertTodaySession(fixture);assert.equal(fixture.elements["#error"].textContent,"FICTIONAL TODAY DENIED");
 }
});


function assertLatestTodayQuery(fixture,day){
 const calls=fixture.calls.filter(call=>/\/today\?/.test(call.path));
 assert.ok(calls.length>0);
 assert.equal(new URL(calls.at(-1).path,"https://fixture.invalid").searchParams.get("date"),day);
}
for(const [requested,returned] of [["2026-10-17","2026-10-16"],["2026-10-16","2026-10-17"]]){
 test(`Initial Today requested ${requested} rejects valid wrong-date ${returned}`,async()=>{
  const body=todayForFixtureDate(returned);body.courts[0].court_name="FICTIONAL WRONG-DATE COURT";
  const fixture=await renderMoneyFixture(body,undefined,requested);
  assertLatestTodayQuery(fixture,requested);assertTodaySession(fixture);
  if(fixture.elements["#error"].hidden)console.log(`FILL_TODAY_DATE_RED phase=initial requested=${requested} returned=${returned} wrong_private_render=${Number(fixture.elements["#courtComparison"].innerHTML.includes("FICTIONAL WRONG-DATE COURT"))}`);
  assertBadToday(fixture);
 });
 test(`Current Today requested ${requested} rejects valid wrong-date ${returned} without fallback`,async()=>{
  const fixture=await renderMoneyFixture(todayForFixtureDate(requested),undefined,requested);
  await fixture.navigation[1].listener("click")();
  for(const id of privateReadoutIds)assert.ok(fixture.elements[id].innerHTML.length>0);
  const before=fixture.calls.length;
  fixture.setTodayReply(()=>todayOk(todayForFixtureDate(returned)));await fixture.refresh();
  assertLatestTodayQuery(fixture,requested);
  if(fixture.elements["#error"].hidden)console.log(`FILL_TODAY_DATE_RED phase=refresh requested=${requested} returned=${returned}`);
  assertBadToday(fixture);
  assert.equal(fixture.calls.length,before+1,"Wrong-date body must not trigger Calendar, retry or fallback");
 });
}

test("Matching Today can recover after a wrong-date reply without replacing the operator session",async()=>{
 const fixture=await renderMoneyFixture(todayForFixtureDate("2026-10-16"));
 fixture.setTodayReply(()=>todayOk(todayForFixtureDate("2026-10-17")));await fixture.refresh();
 assertLatestTodayQuery(fixture,"2026-10-16");assertBadToday(fixture);
 const body=todayForFixtureDate("2026-10-16");body.summary.revenue_minor=1;
 fixture.setTodayReply(()=>todayOk(body));await fixture.refresh();
 assertTodaySession(fixture);assert.equal(fixture.elements["#error"].hidden,true);
 assert.match(fixture.elements["#kpis"].innerHTML,/<strong>€0.01<\/strong>/);
});

for(const navigation of ["sameclub","date","tenant","logout"])
 test(`Stale wrong-date Today after ${navigation} cannot erase newer private state or auth`,async()=>{
  const orgs=[{id:"org-fixture",name:"FICTIONAL CLUB A",role:"manager"},
   {id:"org-second",name:"FICTIONAL CLUB B",role:"support"}];
  const fixture=await renderMoneyFixture(todayForFixtureDate("2026-10-16"),orgs);
  let completeOlder,notifyOlder;
  const older=new Promise(done=>{completeOlder=done;});const started=new Promise(done=>{notifyOlder=done;});
  fixture.setTodayReply(()=>({ok:true,status:200,json:()=>{notifyOlder();return older;}}));
  const pending=fixture.refresh();await started;assertLatestTodayQuery(fixture,"2026-10-16");
  const selected=navigation==="date"?"2026-10-17":"2026-10-16";
  const body=todayForFixtureDate(selected);body.courts[0].court_name="FICTIONAL CURRENT-DATE COURT";
  fixture.setTodayReply(()=>todayOk(body));
  if(navigation==="date"){
   fixture.elements["#dateInput"].value=selected;
   await fixture.elements["#dateInput"].listener("change")();
  }else if(navigation==="tenant"){
   fixture.elements["#orgSelect"].value="org-second";fixture.elements["#orgSelect"].listener("change")();
   await new Promise(done=>setTimeout(done,0));await new Promise(done=>setTimeout(done,0));
  }else if(navigation==="logout")fixture.elements["#signOut"].listener("click")();
  else await fixture.refresh();
  const newer=privateReadoutIds.map(id=>fixture.elements[id].innerHTML);
  if(navigation!=="logout"){
   assertLatestTodayQuery(fixture,selected);assert.ok(newer.some(html=>html.includes("FICTIONAL CURRENT-DATE COURT")));
  }
  // This reply is wrong for its captured16 request, even when the new UI selected17.
  completeOlder(todayForFixtureDate("2026-10-17"));await pending;
  assert.deepEqual(privateReadoutIds.map(id=>fixture.elements[id].innerHTML),newer);
  assert.equal(fixture.elements["#error"].hidden,true);
  if(navigation==="logout"){
   assert.equal(fixture.session.has("fill.access"),false);assert.equal(fixture.elements["#authGate"].hidden,false);
   assert.equal(fixture.elements["#workspace"].hidden,true);assert.ok(newer.every(html=>html===""));
  }else assertTodaySession(fixture);
 });
