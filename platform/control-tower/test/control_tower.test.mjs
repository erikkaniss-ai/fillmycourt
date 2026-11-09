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


test("CI evidence requires canonical workflow(s), exact PR/head and no unrelated workflow substitution",async()=>{
  const {classifyRequiredCI}=await import("../model.mjs");
  const sha="a".repeat(40);
  const make=(name,status="completed",conclusion="success",created_at="2026-10-20T09:00:00Z")=>({
    id:100,name,status,conclusion,head_sha:sha,event:"pull_request",created_at,
    html_url:"https://github.com/erikkaniss-ai/fillmycourt/actions/runs/100",
    pull_requests:[{number:5,head:{sha}}]
  });
  assert.equal(classifyRequiredCI(["Platform CI"],[make("Optional artifact")],sha,5).ci,"unverified");
  assert.equal(classifyRequiredCI(["Platform CI"],[make("Platform CI")],"b".repeat(40),5).ci,"unverified");
  assert.equal(classifyRequiredCI(["Platform CI"],[{
    ...make("Platform CI"),head_sha:"b".repeat(40),
    pull_requests:[{number:6,head:{sha}}]}],sha,5).ci,"unverified");
  assert.equal(classifyRequiredCI(["Platform CI"],[make("Platform CI")],sha,5).ci,"success");
  assert.equal(classifyRequiredCI(["Platform CI","Private preview"],[make("Platform CI")],sha,5).ci,"unverified");
  assert.equal(classifyRequiredCI([], [make("Platform CI")],sha,5).ci,"unverified");
});

test("CI state is fail-closed: failed required run beats a successful unrelated run",async()=>{
  const {classifyRequiredCI}=await import("../model.mjs");
  const sha="c".repeat(40);
  const run=(name,conclusion,status="completed",created_at="2026-10-20T09:00:00Z",id=100)=>({
    id,name,status,conclusion,head_sha:sha,event:"pull_request",created_at,
    html_url:"https://github.com/example/test/actions/runs/"+id,
    pull_requests:[{number:5,head:{sha}}]
  });
  assert.equal(classifyRequiredCI(["Platform CI"],[
    run("Platform CI","failure"),run("Preview deploy","success")],sha,5).ci,"failed_or_other");
  assert.equal(classifyRequiredCI(["Platform CI"],[
    run("Platform CI",null,"in_progress")],sha,5).ci,"running");
  assert.equal(classifyRequiredCI(["Platform CI"],[
    run("Platform CI","cancelled")],sha,5).ci,"failed_or_other");
  assert.equal(classifyRequiredCI(["Platform CI"],[
    run("Platform CI","skipped")],sha,5).ci,"unverified");
  assert.equal(classifyRequiredCI(["Platform CI"],[
    run("Platform CI","failure","completed","2026-10-20T08:00:00Z",101),
    run("Platform CI","success","completed","2026-10-20T10:00:00Z",102)],sha,5).ci,"success");
  const mixed=classifyRequiredCI(["Platform CI","Private preview"],[
    run("Platform CI","success"),run("Private preview","failure")],sha,5);
  assert.equal(mixed.ci,"failed_or_other");
});

test("merge-SHA workflow evidence must explicitly belong to same PR and current source HEAD",async()=>{
  const {classifyRequiredCI}=await import("../model.mjs");
  const sha="d".repeat(40);
  const merge="e".repeat(40);
  const known={name:"Platform CI",id:43,event:"pull_request",head_sha:merge,
    status:"completed",conclusion:"success",created_at:"2026-10-20T09:00:00Z",
    html_url:"https://github.com/x/y/actions/runs/43",
    pull_requests:[{number:5,head:{sha}}]};
  assert.equal(classifyRequiredCI(["Platform CI"],[known],sha,5).ci,"success");
  assert.equal(classifyRequiredCI(["Platform CI"],[{...known,pull_requests:[]}],sha,5).ci,"unverified");
  assert.equal(classifyRequiredCI(["Platform CI"],[{...known,pull_requests:[{number:5,head:{sha:"f".repeat(40)}}]}],sha,5).ci,"unverified");
});
