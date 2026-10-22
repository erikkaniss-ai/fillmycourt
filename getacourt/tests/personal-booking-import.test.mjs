// Real user-owned .ics calendar import, not third-party OAuth or inventory feed.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const importer=require("../assets/personal-booking-import.js");
const ownIcs=[
"BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT",
"UID:secret-from-calendar", "DTSTART:20261025T003000Z",
"DTEND:20261025T013000Z","SUMMARY:Padel\\, friendly",
"LOCATION:Example Tennis Club","ATTENDEE;CN=Hidden:mailto:other@example.test",
"DESCRIPTION:secret private notes","URL:https://example.test/private",
"END:VEVENT","BEGIN:VEVENT",
"DTSTART:20261025T013000Z","DTEND:20261025T023000Z",
"SUMMARY:Second 01:30","LOCATION:Test arena",
"END:VEVENT","END:VCALENDAR"
].join("\r\n");
test("user-owned UTC ICS imports two distinct Lisbon repeated-hour events, not free slots",()=>{
  const records=importer.parseIcs(ownIcs,{provider:"playtomic"});
  assert.equal(records.length,2);
  assert.equal(records[0].startsAt,"2026-10-25T00:30:00.000Z");
  assert.equal(records[1].startsAt,"2026-10-25T01:30:00.000Z");
  assert.equal(records[0].title,"Padel, friendly");
  assert.equal(records[0].venue,"Example Tennis Club");
  for(const record of records){
    assert.equal(record.origin,"user_imported_calendar");
    assert.equal(record.bookingAuthority,"unverified");
    assert.equal(record.providerAuthenticated,false);
    assert.equal(record.confirmsAvailableCourt,false);
    assert.equal(record.provider,"playtomic");
    assert.ok(Object.isFrozen(record));
    assert.doesNotMatch(JSON.stringify(record),/secret-from-calendar|other@example|private notes|https:/);
  }
});
test("cancelled user events filtered; ICS folding and escaped strings read without payloads",()=>{
  const lines=[
    "BEGIN:VCALENDAR","BEGIN:VEVENT",
    "DTSTART:20260901T140000Z","DTEND:20260901T153000Z",
    "SUMMARY:Padel booking with",
    " folded continuation","LOCATION:Private\\; office",
    "END:VEVENT","BEGIN:VEVENT","DTSTART:20261025T013000Z",
    "DTEND:20261025T023000Z","STATUS:CANCELLED","END:VEVENT","END:VCALENDAR"
  ].join("\r\n");
  const records=importer.parseIcs(lines,{provider:"tiesports"});
  assert.equal(records.length,1);
  assert.equal(records[0].title,"Padel booking withfolded continuation");
  assert.equal(records[0].venue,"Private; office");
});
test("malformed timezone, duplicate times, inverted dates, dates out of range and huge events rejected",()=>{
  const variants=[
    ownIcs.replace("DTSTART:20261025T003000Z","DTSTART;TZID=Europe/Lisbon:20261025T013000"),
    ownIcs.replace("DTSTART:20261025T003000Z","DTSTART:20261025T013000"),
    ownIcs.replace("DTSTART:20261025T003000Z","DTSTART:20261032T003000Z"),
    ownIcs.replace("DTSTART:20261025T003000Z","DTSTART:19900101T003000Z"),
    ownIcs.replace("DTEND:20261025T013000Z","DTEND:20261025T003000Z"),
    ownIcs.replace("DTEND:20261025T013000Z","DTEND:20271025T013000Z"),
    ownIcs.replace("DTEND:20261025T013000Z","DTEND:20261025T013000Z\r\nDTEND:20261025T013000Z"),
    ownIcs.replace("END:VEVENT","BEGIN:VEVENT"),
    "Hello, here's my password"
  ];
  for(const data of variants)assert.throws(()=>importer.parseIcs(data,{provider:"playtomic"}));
  assert.throws(()=>importer.parseIcs(ownIcs,{provider:"unknown"}),/source/);
  assert.throws(()=>importer.parseIcs("x".repeat(131073),{provider:"other"}),/too large/);
});
test("only local private records for current Get identity; explicit clear and replacement",()=>{
  const store=importer.createStore();
  assert.equal(store.count,0);
  assert.equal(store.importIcs({ownerRef:"user-one",provider:"matchi",content:ownIcs}),2);
  assert.equal(store.list("user-one").length,2);
  assert.deepEqual(store.list("user-two"),[]);
  assert.throws(()=>store.importIcs({ownerRef:"user-two",provider:"other",content:ownIcs}),/scope mismatch/);
  assert.equal(store.count,2);
  assert.throws(()=>store.importIcs({ownerRef:"user-one",provider:"other",content:"corrupt"}));
  assert.equal(store.count,2,"Failed import must not overwrite valid current-session data");
  store.clear();
  assert.equal(store.count,0);
  assert.deepEqual(store.list("user-one"),[]);
  assert.equal(store.importIcs({ownerRef:"user-two",provider:"other",content:ownIcs}),2);
  assert.equal(store.list("user-two").length,2);
  assert.deepEqual(store.list("user-one"),[]);
});
test("ICS text is redacted and never interpolated as HTML or third-party API authority",()=>{
  const text=ownIcs.replace("SUMMARY:Padel\\, friendly","SUMMARY:<script>alert(1)</script> player@example.test +351 912 345 678");
  const result=importer.parseIcs(text,{provider:"other"});
  assert.doesNotMatch(result[0].title,/[<>]|example\.test|912 345/);
  const app=readFileSync("getacourt/assets/app.js","utf8");
  const html=readFileSync("getacourt/index.html","utf8");
  const src=readFileSync("getacourt/assets/personal-booking-import.js","utf8");
  assert.match(app,/personalImports\?\.clear\(\)/);
  assert.match(app,/epoch!==state\.authEpoch/);
  assert.match(app,/li\.append\(title,meta\)/);
  assert.match(app,/title\.textContent=booking\.title/);
  assert.match(app,/viewer!==jwtPayload/);
  assert.match(html,/id="importDialog"/);
  assert.match(html,/personal-booking-import\.js/);
  assert.match(html,/id="importOwnData"/);
  assert.doesNotMatch(src,/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|\/auth\/v1\//);
});
