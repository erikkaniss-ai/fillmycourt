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

function makeElement(dataset = {}) {
  const listeners = new Map();
  return { dataset, hidden: false, disabled: false, value: "", textContent: "", innerHTML: "", classList: { toggle() {} }, addEventListener(type, handler) { listeners.set(type, handler); }, listener(type) { return listeners.get(type); } };
}

test("Fill read-only operator shell only uses deployed Core GET contracts", async () => {
  assert.match(htmlSource, /Staging · read-only/);
  assert.match(htmlSource, /not partner availability/i);
  assert.match(appSource, /\/api\/fmc\/\$\{encodeURIComponent\(state\.org\)\}\/today/);
  assert.match(appSource, /\/api\/fmc\/\$\{encodeURIComponent\(state\.org\)\}\/calendar/);
  assert.doesNotMatch(appSource, /\bPOST\b/);
  assert.doesNotMatch(appSource, /\/opportunities|\/crm-actions|\/attributions|\/disputes/);

  const elements = Object.fromEntries(["#authGate", "#workspace", "#orgSelect", "#identity", "#signOut", "#dateInput", "#refreshButton", "#error", "#pageTitle", "#todayView", "#calendarView", "#revenueView", "#kpis", "#courtUtilisation", "#utilisationBadge", "#emptyCapacity", "#calendarTimeline", "#revenueKpis", "#opportunityQueue", "#courtComparison"].map((id) => [id, makeElement()]));
  const navigation = [makeElement({ view: "today" }), makeElement({ view: "calendar" }), makeElement({ view: "revenue" })];
  const calls = [];
  const local = new Map([["fill.access", "fixture-session"]]);
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  const context = {
    URLSearchParams, Intl, Date, Map, Number, String, Error, Headers, encodeURIComponent,
    document: { querySelector(selector) { return elements[selector]; }, querySelectorAll(selector) { return selector === ".nav-item" ? navigation : []; } },
    location: { hash: "", pathname: "/fill/", search: "" }, history: { replaceState() {} },
    localStorage: { getItem: (key) => local.get(key) || null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) },
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
