import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const y=readFileSync(".github/workflows/fill-private-preview-deploy.yml","utf8");
const f=readFileSync("platform/netlify/functions/fill-operator-readonly.mts","utf8");
const a=readFileSync("platform/public/fill/app.js","utf8");

test("Explicit no-deploy freeze skips the entire private draft job, including secrets and upload",()=>{
  assert.match(y,/private-draft:\s*\n(?:\s*#[^\n]*\n)*\s*if: >-\s*\n\s*false &&/);
  assert.doesNotMatch(y,/workflow_dispatch:|repository_dispatch:/);
  assert.ok(y.indexOf("false &&") < y.indexOf("NETLIFY_AUTH_TOKEN:"));
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
