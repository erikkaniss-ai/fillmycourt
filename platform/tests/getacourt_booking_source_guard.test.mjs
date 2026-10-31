import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync("getacourt/assets/app.js","utf8");
const search=readFileSync("netlify/functions/getacourt-search.mts","utf8");
const start=app.indexOf("  async function selectSlot(");
const end=app.indexOf("  async function hold(){",start);
assert.ok(start>=0&&end>start,"Review actual Get slot click pathway");
const code=app.slice(start,end);

test("Global bookingEnabled cannot bypass per-slot native provider gate",()=>{
 assert.match(code,/state\.platform\.bookingEnabled && slot\.provider!=="fillmycourt"/);
 assert.ok(code.indexOf("slot.provider!==\"fillmycourt\"")<code.indexOf("requireSignedIn()"));
 assert.ok(code.indexOf("slot.provider!==\"fillmycourt\"")<code.indexOf("await hold()"));
 assert.match(code,/not authorized for in-app booking/);
});

test("Get normalizer currently labels only shared-Core native availability as native",()=>{
 assert.match(search,/provider: "fillmycourt"/);
 assert.doesNotMatch(search,/provider: "playtomic"/);
 assert.doesNotMatch(code,/https?:\/\/playtomic/);
});
