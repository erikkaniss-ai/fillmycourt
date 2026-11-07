import test from "node:test";
import assert from "node:assert/strict";
import {classifyFullCi,matchesCurrentPr,hasExactOwnerApproval} from "../scripts/fill_ci_gate.mjs";
import {readFileSync} from "node:fs";
const sha="a".repeat(40), other="b".repeat(40);
const pr=()=>({
  number:8,state:"open",draft:true,
  head:{sha,ref:"fill/operator-mvp-readonly",repo:{full_name:"erikkaniss-ai/fillmycourt"}},
  base:{ref:"platform/v0.4-staging",repo:{full_name:"erikkaniss-ai/fillmycourt"}}
});
const run=()=>({
  id:123,run_number:200,run_attempt:1,status:"completed",conclusion:"success",
  event:"pull_request",head_sha:sha,head_branch:"fill/operator-mvp-readonly",
  head_repository:{full_name:"erikkaniss-ai/fillmycourt"},
  path:".github/workflows/platform-ci.yml",
  pull_requests:[{number:8,head:{sha,ref:"fill/operator-mvp-readonly"},base:{ref:"platform/v0.4-staging"}}]
});
test("Full CI READY only for a success on the same Fill PR8 SHA",()=>{
  assert.deepEqual(classifyFullCi([run()],sha),{status:"READY",runId:123});
});
test("Wrong commit, other PR, other branch, missing PR linkage, or wrong workflow never authorize",()=>{
  for (const mutate of [
    r=>r.head_sha=other,
    r=>r.head_branch="main",
    r=>r.head_repository.full_name="other/repo",
    r=>r.event="push",
    r=>r.path=".github/workflows/another.yml",
    r=>r.pull_requests=[],
    r=>r.pull_requests[0].number=5,
    r=>r.pull_requests[0].head.sha=other,
    r=>r.pull_requests[0].base.ref="main"
  ]) { const candidate=run(); mutate(candidate);
    assert.equal(classifyFullCi([candidate],sha).status,"WAIT"); }
});
test("A failed, cancelled or stale full CI blocks instead of reusing a past success",()=>{
  for (const conclusion of ["failure","cancelled","skipped","timed_out",null]) {
    const candidate=run();candidate.conclusion=conclusion;
    assert.equal(classifyFullCi([candidate],sha).status,"BLOCK");
  }
  const failed=run(); failed.id=999;failed.run_number=201;failed.conclusion="failure";
  assert.equal(classifyFullCi([run(),failed],sha).status,"BLOCK");
});
test("Pending CI waits; invalid API response and SHA fail closed",()=>{
  const pending=run();pending.status="in_progress";pending.conclusion=null;
  assert.equal(classifyFullCi([pending],sha).status,"WAIT");
  assert.throws(()=>classifyFullCi(null,sha),/INVALID_CI_RESPONSE/);
  assert.throws(()=>classifyFullCi([],"bad"),/INVALID_SHA/);
});
test("A changed or non-draft PR HEAD cannot be uploaded",()=>{
  assert.equal(matchesCurrentPr(pr(),sha),true);
  for (const mutate of [
    p=>p.head.sha=other,p=>p.draft=false,p=>p.state="closed",
    p=>p.base.ref="main",p=>p.head.repo.full_name="other/repo",
    p=>p.number=5
  ]){const candidate=pr();mutate(candidate);assert.equal(matchesCurrentPr(candidate,sha),false);}
});
test("Deployment is gated BEFORE Netlify upload, and original privacy perimeter remains",()=>{
  const workflow=readFileSync(".github/workflows/fill-private-preview-deploy.yml","utf8");
  assert.match(workflow,/actions: read/);
  assert.match(workflow,/pull-requests: read/);
  assert.match(workflow,/node platform\/scripts\/fill_ci_gate\.mjs/);
  assert.ok(workflow.indexOf("node platform/scripts/fill_ci_gate.mjs") <
            workflow.indexOf("netlify deploy"));
  assert.match(workflow,/node platform\/scripts\/fill_ci_gate\.mjs --check-head/);
  assert.match(workflow,/status.*= "401"/);
  assert.doesNotMatch(workflow,/^\s*--prod(?:\s|$)/m);
  assert.doesNotMatch(workflow,/^\s*--prod-if-unlocked(?:\s|$)/m);
});

test("Full Platform CI cannot omit the two-org provenance rehearsal or silently accept a skipped fixture run",()=>{
  const workflow=readFileSync(".github/workflows/platform-ci.yml","utf8");
  const step=workflow.match(/- name: Protected provenance UAT rehearsal[^\n]*\n([\s\S]*?)(?=\n      - name:|$)/)?.[0];
  assert.ok(step,"Distinct protected UAT step is mandatory before full CI can pass");
  assert.match(step,/FILL_PROVENANCE_UAT_FIXTURES: ci-local-only/);
  assert.match(step,/run: pytest -v -o addopts='' platform\/tests\/test_fill_provenance_uat\.py/);
  assert.doesNotMatch(step,/continue-on-error|if:|\|\| true/);
  assert.match(workflow,/pytest -q platform\/tests --ignore=platform\/tests\/test_fill_provenance_uat\.py/);
  const suite=readFileSync("platform/tests/test_fill_provenance_uat.py","utf8");
  assert.match(suite,/fixture_database\(url, os\.getenv\("FILL_PROVENANCE_UAT_FIXTURES"\)\)/);
  assert.match(suite,/httpx\.MockTransport\(auth_response\)/);
  assert.match(suite,/test_two_org_browser_uses_real_rls_and_discards_late_scope/);
});

test("Staging UAT approval is an exact, unique, owner-controlled SHA receipt",()=>{
  const good="<!-- FILL_STAGING_UAT_APPROVED_SHA:"+sha+" -->";
  assert.equal(hasExactOwnerApproval("Other text\\n"+good+"\\n",sha),true);
  for(const body of ["",null,good+good,"<!-- FILL_STAGING_UAT_APPROVED_SHA:"+other+" -->",
                      "<!-- FILL_STAGING_UAT_APPROVED_SHA:bad -->",
                      "<!-- FILL_STAGING_UAT_APPROVED_SHA:"+sha+" -->"+
                        "<!-- FILL_STAGING_UAT_APPROVED_SHA:"+other+" -->"]){
    assert.equal(hasExactOwnerApproval(body,sha),false);
  }
  assert.equal(hasExactOwnerApproval(good,other),false);
});
