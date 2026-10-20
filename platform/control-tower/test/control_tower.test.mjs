import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {weightedProgress,projectView,portfolio,PROJECTS} from "../model.mjs";
import {safeGithubUrl} from "../server.mjs";

test("all four portfolio projects have explicit private-repo source mappings",()=>{
  assert.deepEqual(PROJECTS.map(p=>p.id),["getacourt","fillmycourt","rebloom","continuum"]);
  assert.equal(new Set(PROJECTS.map(p=>p.id)).size,4);
  for(const project of PROJECTS) {
    assert.match(project.repo,/^erikkaniss-ai\/[a-z0-9-]+$/);
    assert.ok(project.pr>0);
  }
});

test("unbaselined progress is null, not fake zero or inferred from CI",()=>{
  assert.equal(weightedProgress([]),null);
  assert.equal(weightedProgress(undefined),null);
  const view=projectView(PROJECTS[0],{
    verified:true,checked_at:"2026-10-20T09:00:00Z",
    head_sha:"a".repeat(40),pr_state:"open",pr_draft:true,ci:"success"});
  assert.equal(view.progress_pct,null);
  assert.equal(view.progress_basis,"unbaselined");
  assert.equal(view.staging,"unverified");
  assert.equal(view.release,"not_authorized");
});

test("weighted accepted milestones require criterion, positive weight and URL evidence",()=>{
  const approved=[
    {criterion:"Verified UX",weight:2,state:"accepted",evidence_url:"https://github.com/org/repo/pull/1"},
    {criterion:"Provider UAT",weight:3,state:"pending"}
  ];
  assert.equal(weightedProgress(approved),40);
  assert.equal(weightedProgress(approved.map(m=>({...m,weight:0}))),null);
  assert.equal(weightedProgress([{criterion:"Acceptance",weight:1,state:"accepted"}]),null);
  assert.equal(weightedProgress([{criterion:"Acceptance",weight:1,state:"accepted",evidence_url:"javascript:fake"}]),null);
  assert.equal(weightedProgress([{criterion:"Acceptance",weight:1,state:"in_progress"}]),null);
});

test("verification failures cannot appear as passing CI or released",()=>{
  const item=projectView(PROJECTS[1],{verified:false,ci:"success",head_sha:"fake"});
  assert.equal(item.verified,false);
  assert.equal(item.head_sha,null);
  assert.equal(item.ci,"unverified");
  assert.equal(item.pr_state,"unverified");
  assert.equal(item.release,"not_authorized");
  const view=portfolio(PROJECTS,{}, "2026-10-20T09:00:00Z");
  assert.equal(view.progress_pct,null);
  assert.equal(view.summary.verified,0);
  assert.equal(view.summary.unbaselined,4);
  assert.equal(view.summary.ci_success,0);
});

test("GitHub API routes are allowlisted and all client URLs are static-approved",()=>{
  assert.equal(safeGithubUrl(PROJECTS[0].repo,"/pulls/5"),
    "https://api.github.com/repos/erikkaniss-ai/fillmycourt/pulls/5");
  assert.throws(()=>safeGithubUrl("attacker/other","/pulls/5"),/allowlisted/);
  const ui=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const server=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(ui,/\b(localStorage|sessionStorage|innerHTML|Authorization)\b/);
  assert.match(server,/server\.listen\(port,"127\.0\.0\.1"\)/);
  assert.match(server,/Content-Security-Policy/);
  assert.match(server,/CONTROL_TOWER_GITHUB_READ_TOKEN/);
});

test("no browser-shipped source contains server credentials",()=>{
  const ui=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  for(const text of [ui,html,css])
    assert.doesNotMatch(text,/CONTROL_TOWER_GITHUB_READ_TOKEN|ghp_[A-Za-z0-9]{15}/);
});
