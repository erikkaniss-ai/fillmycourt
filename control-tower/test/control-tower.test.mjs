import assert from "node:assert/strict";
import test from "node:test";
import { buildRollup, buildSnapshot, refreshGithub, weightedProgress } from "../server.mjs";

test("weighted progress is based on milestones, not commits or CI count", () => {
  assert.equal(weightedProgress([
    { weight: 25, acceptance: "passed" },
    { weight: 50, acceptance: "blocked" },
    { weight: 25, acceptance: "unknown" }
  ]), 25);
  assert.equal(weightedProgress([]), null);
});

test("rollup excludes projects without a reviewed milestone baseline", () => {
  const rollup = buildRollup([
    { baseline: true, milestones: [{ weight: 40, acceptance: "passed" }, { weight: 60, acceptance: "blocked" }] },
    { baseline: false, milestones: [] }
  ]);
  assert.deepEqual(rollup, { percent: 40, baselinedProjects: 1, totalProjects: 2, completedWeight: 40, totalWeight: 100 });
});

test("GitHub refresh exposes status evidence but never server credentials", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/pulls/5")) return new Response(JSON.stringify({
      number: 5, html_url: "https://github.test/pr/5", title: "Draft", draft: true, state: "open",
      base: { ref: "getacourt-staging" }, head: { ref: "get/rc", sha: "abc123456789abcdef" }
    }));
    if (url.includes("/status")) return new Response(JSON.stringify({ state: "success" }));
    return new Response(JSON.stringify({ workflow_runs: [{ id: 7, name: "Platform CI", status: "completed", conclusion: "success", html_url: "https://github.test/run/7" }] }));
  };
  const result = await refreshGithub({ github: { repository: "org/repo", pullRequest: 5 } }, { fetchImpl, token: "never-client-side", now: new Date("2026-10-20T08:00:00Z") });
  assert.equal(result.state, "actual_verified");
  assert.equal(result.pullRequest.sha, "abc123456789abcdef");
  assert.equal(result.ci.runId, 7);
  assert.equal(JSON.stringify(result).includes("never-client-side"), false);
  assert.equal(calls.every((call) => call.options.headers.Authorization === "Bearer never-client-side"), true);
});

test("snapshot retains unknown projects and keeps them out of the calculated rollup", async () => {
  const config = { schemaVersion: 1, generatedFrom: "test", projects: [
    { id: "known", baseline: true, milestones: [{ weight: 100, acceptance: "passed" }], github: null },
    { id: "unknown", baseline: false, milestones: [] }
  ] };
  const snapshot = await buildSnapshot(config, { fetchImpl: async () => { throw new Error("not called"); }, now: new Date("2026-10-20T08:00:00Z") });
  assert.equal(snapshot.rollup.percent, 100);
  assert.equal(snapshot.projects[1].progress, null);
});
