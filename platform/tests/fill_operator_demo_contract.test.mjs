import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const fixture=fs.readFileSync("platform/public/fill/demo-fixture.js","utf8");
const app=fs.readFileSync("platform/public/fill/app.js","utf8");
const html=fs.readFileSync("platform/public/fill/index.html","utf8");

test("synthetic demo has three courts, clear revenue disclaimer, and zero network code",()=>{
 assert.doesNotMatch(fixture,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage/);
 const ctx={globalThis:{},Date,Intl,URL};
 vm.runInNewContext(fixture,ctx);
 const get=ctx.globalThis.FillDemo.get;
 const org=get("/api/fmc/organizations").items[0].id;
 assert.match(get("/api/fmc/organizations").items[0].name,/SYNTHETIC/);
 assert.match(get("/api/me").user.email,/example\.invalid/);
 const d=get("/api/fmc/"+org+"/today?date=2026-10-16");
 assert.equal(d.summary.active_courts,3);
 assert.equal(d.summary.courts_without_rate_coverage,1);
 assert.equal(d.summary.revenue_minor,9000);
 assert.equal(d.empty_windows.length,2);
 const calendar=get("/api/fmc/"+org+"/calendar?start=2026-10-16T00%3A00%3A00%2B01%3A00&end=2026-10-17T00%3A00%3A00%2B01%3A00");
 assert.equal(calendar.bookings.length,4);
 assert.equal(calendar.bookings.filter(b=>b.status==="cancelled").length,1);
 assert.ok(calendar.bookings.some(b=>b.court_id===d.courts[2].court_id && b.status==="confirmed"));
 assert.equal(calendar.holds.length,1);
 assert.equal(calendar.blocks.length,1);
 // Portugal DST: synthetic Core-shaped day_start/end must represent
 // actual 25h/23h UTC elapsed time, rather than a hard-coded 24h day.
 for (const [day, expectedHours] of [["2026-10-25",25],["2026-03-29",23]]) {
   const scene=get("/api/fmc/"+org+"/today?date="+day);
   assert.equal((Date.parse(scene.day_end)-Date.parse(scene.day_start))/3600000,
     expectedHours,day);
   const events=get("/api/fmc/"+org+"/calendar?start="+encodeURIComponent(scene.day_start)+
     "&end="+encodeURIComponent(scene.day_end));
   assert.equal(events.bookings.filter(r=>r.status==="confirmed").length,3);
 }
 assert.throws(()=>get("/api/fmc/"+org+"/today?date=2026-02-30"));
 assert.throws(()=>get("/api/holds"));
 assert.throws(()=>get("/api/fmc/organizations?edit=true"));
});

test("private-preview-only demo flag and permanent synthetic banner are present",()=>{
 assert.match(app,/canExploreDemo && new URLSearchParams\(location.search\)\.get\("demo"\) === "1"/);
 assert.match(app,/fillmycourt-preview/);
 assert.match(app,/127\.0\.0\.1/);
 assert.match(app,/if \(state.demo\)/);
 assert.match(app,/window\.FillDemo\.get\(path\)/);
 assert.match(html,/id="demoNotice"/);
 assert.match(html,/id="demoPreviewLink"/);
 assert.match(html,/SYNTHETIC FIXTURE/);
 assert.match(html,/demo-fixture\.js/);
});
