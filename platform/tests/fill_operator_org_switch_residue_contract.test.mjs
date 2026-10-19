import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Regression: after choosing another authorised organisation, an unfinished
// request must not leave the previous organisation's calendar or capacity
// information visible in memory or in the rendered DOM.
const source = readFileSync("platform/public/fill/app.js", "utf8");
const start = source.indexOf("  async function load() {");
const end = source.indexOf("  async function init() {", start);
assert.ok(start >= 0 && end > start, "actual tenant load implementation found");
const implementation = source.slice(start, end);

function pending() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return {promise, resolve};
}

test("org switch purges former tenant rendering before the new tenant read resolves", async () => {
  const request = pending();
  const cleared = [];
  let rendered = 0;
  const node = (name) => ({
    get textContent() { return "former tenant content"; },
    set textContent(value) { if (value === "") cleared.push(name); },
  });
  const context = {
    state: {
      token: "session-for-current-operator",
      org: "22222222-2222-4222-8222-222222222222",
      authEpoch: 7,
      readEpoch: 3,
      calendarEpoch: 9,
      view: "calendar",
      today: {tenant: "former-org", confidential_capacity: "A-only"},
      calendar: {tenant: "former-org", bookings: [{id: "A-private"}]},
    },
    el: {
      date: {value: "2026-10-19"},
      kpis: node("kpis"), util: node("util"), empty: node("empty"),
      revenueKpis: node("revenueKpis"), opportunityQueue: node("opportunityQueue"),
      courtComparison: node("courtComparison"), timeline: node("timeline"),
    },
    api: async (path) => {
      assert.match(path, /22222222-2222-4222-8222-222222222222\/today/);
      return request.promise;
    },
    clearError() {},
    renderToday() { rendered++; },
    loadCalendar: async () => {},
    fail(error) { throw error; },
  };
  vm.runInNewContext(implementation + "\nthis.load = load;", context);

  const loading = context.load();

  assert.equal(context.state.today, null, "former tenant Today data removed immediately");
  assert.equal(context.state.calendar, null, "former tenant Calendar data removed immediately");
  assert.deepEqual([...new Set(cleared)].sort(), [
    "courtComparison", "empty", "kpis", "opportunityQueue",
    "revenueKpis", "timeline", "util",
  ]);
  assert.equal(rendered, 0, "new tenant view is not rendered before its read resolves");

  request.resolve({summary: {}, courts: []});
  await loading;
  assert.equal(rendered, 1, "only resolved new tenant data is rendered");
});
