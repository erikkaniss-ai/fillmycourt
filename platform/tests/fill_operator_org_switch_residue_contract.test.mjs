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
const instantStart = source.indexOf("  function calendarInstant(value) {");
const instantEnd = source.indexOf("  function validCalendarSnapshot(", instantStart);
const todayStart = source.indexOf("  function validTodaySnapshot(today) {");
assert.ok(instantStart >= 0 && instantEnd > instantStart && todayStart >= 0 && todayStart < start,
  "actual production Today and instant validator closures found");
const implementation = source.slice(instantStart, instantEnd) + source.slice(todayStart, end);

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
  const utilisationBadge = {textContent: "72% overall"}; // PRIVATE tenant A KPI
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
      utilBadge: utilisationBadge,
      kpis: node("kpis"), util: node("util"), empty: node("empty"),
      revenueKpis: node("revenueKpis"), opportunityQueue: node("opportunityQueue"),
      courtComparison: node("courtComparison"), timeline: node("timeline"),
    },
    api: async (path) => {
      assert.match(path, /22222222-2222-4222-8222-222222222222\/today/);
      return request.promise;
    },
    clearError() {},
    resetProvenance() {},
    renderToday() { rendered++; },
    loadCalendar: async () => {},
    fail(error) { throw error; },
  };
  vm.runInNewContext(implementation + "\nthis.load = load;", context);

  const loading = context.load();

  assert.equal(context.state.today, null, "former tenant Today data removed immediately");
  assert.equal(context.state.calendar, null, "former tenant Calendar data removed immediately");
  assert.equal(utilisationBadge.textContent, "—",
    "Former tenant utilisation badge must be cleared immediately");
  assert.deepEqual([...new Set(cleared)].sort(), [
    "courtComparison", "empty", "kpis", "opportunityQueue",
    "revenueKpis", "timeline", "util",
  ]);
  assert.equal(rendered, 0, "new tenant view is not rendered before its read resolves");

  const validEmptyToday = {
    date: "2026-10-19", day_start: "2026-10-19T00:00:00+01:00",
    day_end: "2026-10-20T00:00:00+01:00", timezone: "Europe/Lisbon", currency: "EUR",
    summary: {capacity_minutes: 0, booked_minutes: 0, held_minutes: 0, blocked_minutes: 0,
      empty_minutes: 0, utilization_pct: 0, bookings: 0, cancellations: 0, revenue_minor: 0,
      active_courts: 0, courts_with_rate_coverage: 0, courts_without_rate_coverage: 0,
      bookable_60_starts: 0, bookable_90_starts: 0, highest_single_quote_minor: 0,
      highest_single_quote_duration_minutes: null},
    courts: [], empty_windows: [],
  };
  request.resolve(validEmptyToday);
  await loading;
  assert.equal(rendered, 1, "only resolved new tenant data is rendered");
  assert.equal(context.state.today, validEmptyToday);
  assert.equal(context.state.readEpoch, 4);
  assert.equal(context.state.authEpoch, 7);
  assert.equal(context.state.token, "session-for-current-operator");

  // The former incomplete fixture must fail the actual production boundary,
  // proving this isolated loader did not replace its validator with a true stub.
  context.api = async () => ({summary: {}, courts: []});
  await assert.rejects(context.load(), /Unable to load Today\. Try again\./);
  assert.equal(rendered, 1, "malformed follow-up must not call renderToday");
  assert.equal(context.state.today, null);
  assert.equal(context.state.calendar, null);
  assert.equal(context.state.token, "session-for-current-operator");
});
