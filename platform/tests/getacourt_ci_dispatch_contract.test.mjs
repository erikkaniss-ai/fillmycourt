// Guard against duplicate Get RC full CI on the same commit.
// Protected Get draft PR still must run ALL fast + PostgreSQL + Chromium checks.
// Staging integration may run CI on its own push; never skip PR checks.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const workflow=readFileSync(".github/workflows/platform-ci.yml","utf8");
const triggers=workflow.split("\nconcurrency:")[0];

function checkoutSteps(source){
  const lines=source.split(/\r?\n/),steps=[];
  let job=null;
  for(let i=0;i<lines.length;i++){
    const heading=/^  ([\w-]+):$/.exec(lines[i]);
    if(heading)job=heading[1];
    if(!/^\s+(?:-\s+)?uses:\s*actions\/checkout@/.test(lines[i]))continue;
    let end=i+1;
    while(end<lines.length&&!/^      - |^  \S/.test(lines[end]))end++;
    steps.push({job,refs:lines.slice(i+1,end).flatMap(line=>{
      const ref=/^          ref:\s*(.+)$/.exec(line);
      return ref?[ref[1].trim()]:[];
    })});
  }
  return steps;
}

test("Every Platform job checks out the explicit PR head with a non-PR SHA fallback",()=>{
  const steps=checkoutSteps(workflow);
  assert.deepEqual(steps.map(step=>step.job),['integration-qa','fast-contracts','contract']);
  for(const step of steps)assert.deepEqual(step.refs,
    ['${{ github.event.pull_request.head.sha || github.sha }}'],
    step.job+' must not silently test a PR merge ref or omit a checkout pin');
});

test("Checkout expressions select candidate over merge SHA and retain the non-PR commit",()=>{
  const candidate='1'.repeat(40),merge='2'.repeat(40),push='3'.repeat(40);
  for(const step of checkoutSteps(workflow)){
    assert.equal(step.refs.length,1,step.job+' needs one explicit ref');
    const ref=step.refs[0];
    assert.match(ref,/^\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}$/);
    const expression=ref.slice(3,-2).trim();
    // Evaluate the actual checked-in expression. Empty PR-head values model
    // the missing GitHub PR context on a staging push, not a merge candidate.
    for(const [head,fallback,expected] of [[candidate,merge,candidate],['',push,push],[null,push,push]]){
      const actual=vm.runInNewContext(expression,{github:{event:{pull_request:{head:{sha:head}}},sha:fallback}});
      assert.equal(actual,expected,step.job);
    }
  }
});

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
