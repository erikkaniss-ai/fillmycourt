// Guard against duplicate Get RC full CI on the same commit.
// Protected Get draft PR still must run ALL fast + PostgreSQL + Chromium checks.
// Staging integration may run CI on its own push; never skip PR checks.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const workflow=readFileSync(".github/workflows/platform-ci.yml","utf8");
const triggers=workflow.split("\nconcurrency:")[0];

test("Get RC CI runs once per Draft PR head, not again on branch push",()=>{
  assert.match(triggers,/^on:\s*$/m);
  assert.match(triggers,/^  pull_request:\s*$/m);
  assert.match(triggers,/^  push:\s*$/m);
  assert.match(triggers,/^    branches: \["getacourt-staging"\]\s*$/m,
    "Preserve integration-branch push CI without duplicate RC push CI");
  assert.doesNotMatch(triggers,/^    branches: \["get\/release-candidate-mvp-qa-04"\]\s*$/m,
    "RC branch must not dispatch both push and PR runs");
  for(const path of ["platform/**","getacourt/**","netlify/functions/**",
    ".github/workflows/platform-ci.yml"]){
    assert.equal(triggers.split('      - "'+path+'"').length,3,
      "Both PR and staging push must watch "+path);
  }
});

test("One PR CI run still requires complete browser + database coverage",()=>{
  assert.match(workflow,/fast-contracts:/);
  assert.match(workflow,/contract:/);
  assert.match(workflow,/node --experimental-strip-types --test/);
  assert.match(workflow,/GetAcourt QA-08 real Chromium local fixture E2E/);
  assert.match(workflow,/QA-09 actual upstream Leaflet\/SRI local Chromium E2E/);
  assert.match(workflow,/postgres:16/);
  assert.match(workflow,/Apply migrations from zero/);
  assert.match(workflow,/pytest -q platform\/tests/);
  assert.match(workflow,/getacourt_auth_facade_contract\.test\.mjs/);
  assert.match(workflow,/QA-PREVIEW-02 offline preflight regression/);
  assert.doesNotMatch(workflow,/run: node platform\/tests\/getacourt_preview_perimeter_smoke.mjs/);
  assert.match(workflow,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});
