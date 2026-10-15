import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const js=readFileSync("getacourt/assets/app.js","utf8");
const html=readFileSync("getacourt/index.html","utf8");

// This is intentionally a small pure contract: browser-rendered calendar state
// requires a separate real browser E2E and is never claimed by this test.
const body=js.match(/function validSearchDate\(dateValue,minDate\)\{[^}]+\}/)?.[0];
assert.ok(body,"Date validation helper must exist in player app");
const validSearchDate=vm.runInNewContext("("+body+")");

test("Get date choices reject empty, past or malformed dates",()=>{
  assert.equal(validSearchDate("2026-10-17","2026-10-15"),true);
  assert.equal(validSearchDate("2026-10-15","2026-10-15"),true);
  for(const v of ["","2026-10-14","17/10/2026","2026/10/17","NaN"]) {
    assert.equal(validSearchDate(v,"2026-10-15"),false,v);
  }
});

test("Get date picker has an accessible live status and change-to-search contract",()=>{
  assert.match(html, /id="dateInput"[^>]+type="date"[^>]+required/);
  assert.match(html, /id="dateStatus"[^>]+aria-live="polite"/);
  assert.match(js, /el\.date\.addEventListener\("change"/);
  assert.match(js, /search\(\{scroll:false\}\)/);
  assert.match(js, /revision!==state\.searchRevision/);
  assert.match(js, /if\(options\.scroll!==false\)/);
});

test("Get booking remains gated; date UI does not activate transactions",()=>{
  assert.match(js, /state\.platform\.bookingEnabled/);
  assert.match(js, /Booking disabled in staging/);
});
