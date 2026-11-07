import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const y=readFileSync(".github/workflows/fill-private-preview-deploy.yml","utf8");
const f=readFileSync("platform/netlify/functions/fill-operator-readonly.mts","utf8");
const a=readFileSync("platform/public/fill/app.js","utf8");

test("Staging deploy is narrow and requires exact SHA GO before credential/upload",()=>{
  assert.match(y,/private-draft:\s*\n(?:\s*#[^\n]*\n)*\s*if: >-\s*\n\s*github.repository/);
  assert.doesNotMatch(y,/workflow_dispatch:|repository_dispatch:/);
  assert.doesNotMatch(y,/\s+false &&/);
  const checks=y.match(/node platform\/scripts\/fill_ci_gate\.mjs --check-owner-go/g)||[];
  assert.equal(checks.length,2);
  assert.ok(y.indexOf("node platform/scripts/fill_ci_gate.mjs --check-owner-go") < y.indexOf("netlify deploy"));
});

test("Netlify token is bound only to the two late credential and upload steps",()=>{
  const stepsAt=y.indexOf("    steps:");
  assert.ok(stepsAt>0);
  assert.doesNotMatch(y.slice(0,stepsAt),/NETLIFY_AUTH_TOKEN:/,
    "Netlify token must not be bound at workflow or job scope");
  const firstOwnerGo=y.indexOf("run: node platform/scripts/fill_ci_gate.mjs --check-owner-go");
  assert.ok(firstOwnerGo>=stepsAt);
  assert.doesNotMatch(y.slice(0,firstOwnerGo),/secrets\.(?:FILL_)?NETLIFY_AUTH_TOKEN/,
    "No Netlify secret expression may precede the initial owner GO guard");
  const bindings=[...y.matchAll(/^          NETLIFY_AUTH_TOKEN: (.+)$/gm)];
  assert.equal(bindings.length,2);
  assert.equal((y.match(/NETLIFY_AUTH_TOKEN:/g)||[]).length,2);
  for(const binding of bindings){
    assert.ok(firstOwnerGo<binding.index,"First owner GO must precede every Netlify token binding");
    assert.equal(binding[1].trim(),"${{ secrets.FILL_NETLIFY_AUTH_TOKEN || secrets.NETLIFY_AUTH_TOKEN }}");
  }
  const tokenSteps=y.split(/^      - /m).slice(1).filter(step=>/NETLIFY_AUTH_TOKEN:/.test(step));
  assert.deepEqual(tokenSteps.map(step=>step.match(/^name: ([^\r\n]+)/)?.[1]),[
    "Check private preview credential",
    "Upload DRAFT only to existing private Fill site"
  ]);
  for(const step of tokenSteps) assert.match(step,/^        env:\r?\n          NETLIFY_AUTH_TOKEN:/m);
});

test("Deployment workflow targets ONLY same-repo Fill PR8 and existing team-only site",()=>{
  assert.match(y,/number == 8/);
  assert.match(y,/head_ref == 'fill\/operator-mvp-readonly'/);
  assert.match(y,/base_ref == 'platform\/v0\.4-staging'/);
  assert.match(y,/head\.repo\.full_name == github\.repository/);
  assert.match(y,/permissions:\s*\n\s*contents: read/);
  assert.match(y,/NETLIFY_SITE_ID: d763b7a1-dccd-4638-8876-ac1670171698/);
  assert.match(y,/secrets\.FILL_NETLIFY_AUTH_TOKEN/);
  assert.match(y,/secrets\.NETLIFY_AUTH_TOKEN/);
  assert.match(y,/--alias "fill-pr8-\$short_sha"/);
  assert.match(y,/--functions netlify\/functions/);
  assert.doesNotMatch(y,/--context deploy-preview/);
  assert.match(y,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(y,/SOURCE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.doesNotMatch(y,/process\.env\.GITHUB_SHA/);
  assert.match(y,/--no-build/);
  assert.match(y,/FILL PRIVATE DEPLOY SKIPPED/);
  assert.match(y,/status.*= "401"/);
  assert.doesNotMatch(y,/^\s*--prod(?:\s|$)/m);
  assert.doesNotMatch(y,/^\s*--prod-if-unlocked(?:\s|$)/m);
  assert.doesNotMatch(y,/^\s*--create-site(?:\s|$)/m);
  assert.doesNotMatch(y,/72eee365-bff0-48ec-bb8f-f08ff01341b7/);
});
test("Backend is fixed to trusted Netlify preview ID and Railway Operations",()=>{
  assert.match(f,/FILL_PREVIEW_SITE_ID = "d763b7a1-dccd-4638-8876-ac1670171698"/);
  assert.match(f,/context\?\.site\?\.id !== FILL_PREVIEW_SITE_ID/);
  assert.match(f,/fmc-operations-api-staging\.up\.railway\.app/);
  assert.match(f,/OPERATIONS_BASE/);
  assert.doesNotMatch(f,/72eee365-bff0-48ec-bb8f-f08ff01341b7/);
});
test("Opt-in fixture mode includes only private manual draft alias, not public site",()=>{
  assert.ok(a.includes("fill-pr8-[a-f0-9]{7}"));
  assert.ok(a.includes("--fillmycourt-preview"));
  assert.ok(a.includes('new URLSearchParams(location.search).get("demo") === "1"'));
});
