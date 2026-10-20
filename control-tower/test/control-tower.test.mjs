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
    return new Response(JSON.stringify({ workflow_runs: [{ id: 7, head_sha: "abc123456789abcdef", name: "Platform CI", status: "completed", conclusion: "success", html_url: "https://github.test/run/7" }] }));
  };
  const result = await refreshGithub({ github: { repository: "org/repo", pullRequest: 5 } }, { fetchImpl, token: "never-client-side", now: new Date("2026-10-20T08:00:00Z") });
  assert.equal(result.state, "actual_verified");
  assert.equal(result.pullRequest.sha, "abc123456789abcdef");
  assert.equal(result.ci.runId, 7);
  assert.equal(JSON.stringify(result).includes("never-client-side"), false);
  assert.equal(calls.every((call) => call.options.headers.Authorization === "Bearer never-client-side"), true);
});

test("private projects fail closed without making anonymous reads", async () => {
  const result = await refreshGithub({ github: { repository: "org/private", private: true, mode: "open-pulls" } }, {
    token: "", fetchImpl: async () => { throw new Error("must not be called"); }
  });
  assert.equal(result.state, "unverified");
  assert.match(result.error, /UNKNOWN/);
});

test("unapproved draft weights never produce project or rollup percentages", async () => {
  const result = await buildSnapshot({ projects: [{ baseline: false, milestones: [{ weight: 100, acceptance: "passed" }] }] });
  assert.equal(result.projects[0].progress, null);
  assert.equal(result.rollup.percent, null);
});

test("private read credential is isolated to private mappings and never in output", async () => {
  const calls = [];
  const result = await buildSnapshot({ projects: [
    { github: { repository: "org/public", pullRequest: 1 } },
    { github: { repository: "org/private", private: true, mode: "open-pulls" } }
  ] }, { privateToken: "restricted-test-secret", fetchImpl: async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    if (url.includes("/private/pulls?")) return new Response("[]");
    return new Response("{}", { status: 403 });
  } });
  assert.equal(calls.find((item) => item.url.includes("/private/")).authorization, "Bearer restricted-test-secret");
  assert.equal(calls.find((item) => item.url.includes("/public/")).authorization, undefined);
  assert.equal(JSON.stringify(result).includes("restricted-test-secret"), false);
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


test("required CI ignores unrelated green packaging and is tied to current PR HEAD", async () => {
  const sha="a".repeat(40);
  const run=(name,conclusion,status="completed",head=sha,id=50)=>({
    id,name,status,conclusion,head_sha:head,event:"pull_request",
    created_at:"2026-10-20T10:00:00Z",
    html_url:"https://github.com/erikkaniss-ai/rebloom-world/actions/runs/"+id,
    pull_requests:[{number:53,head:{sha}}]
  });
  const requests=[];
  const fetchImpl=async (url)=>{
    requests.push(url);
    if(url.includes("/pulls/53"))return new Response(JSON.stringify({
      number:53,html_url:"https://github.com/erikkaniss-ai/rebloom-world/pull/53",title:"UX",
      draft:true,state:"open",base:{ref:"main"},head:{ref:"feature",sha}
    }));
    if(url.endsWith("/status"))return new Response(JSON.stringify({total_count:0}));
    return new Response(JSON.stringify({workflow_runs:[
      run("ReBloom latest B UX reviewed Netlify-root artifact (NO DEPLOY)","success"),
      run("ReBloom canonical Linux validation","failure","completed",sha,51)
    ]}));
  };
  const project={github:{repository:"erikkaniss-ai/rebloom-world",pullRequest:53,
    requiredWorkflows:["ReBloom canonical Linux validation"]}};
  const result=await refreshGithub(project,{fetchImpl,token:"test-token"});
  assert.equal(result.state,"actual_verified");
  assert.equal(result.requiredCi.verdict,"failed_or_other");
  assert.equal(result.requiredCi.checks[0].workflow,"ReBloom canonical Linux validation");
  assert.ok(requests.some(url=>url.includes("head_sha=")));
});

test("CI is UNKNOWN when a required workflow is missing, skipped or has mismatched PR", async()=>{
  const {assessRequiredCi}=await import("../server.mjs");
  const sha="b".repeat(40);
  const run=(name,status,conclusion,head_sha=sha,number=5)=>({
    id:7,name,event:"pull_request",head_sha,status,conclusion,
    created_at:"2026-10-20T10:00:00Z",pull_requests:[{number,head:{sha}}]
  });
  assert.equal(assessRequiredCi(["Platform CI"],[
    run("Optional Preview","completed","success")],sha,5).verdict,"unverified");
  assert.equal(assessRequiredCi(["Platform CI"],[
    run("Platform CI","completed","skipped")],sha,5).verdict,"unverified");
  assert.equal(assessRequiredCi(["Platform CI"],[
    run("Platform CI","completed","success",sha,6)],sha,5).verdict,"unverified");
  // GitHub PR workflows may use a synthetic merge SHA; explicit PR + source SHA permits it.
  assert.equal(assessRequiredCi(["Platform CI"],[
    run("Platform CI","completed","success","c".repeat(40),5)],sha,5).verdict,"success");
  assert.equal(assessRequiredCi(["Platform CI"],[
    {...run("Platform CI","completed","success","c".repeat(40),5),pull_requests:[]}],sha,5).verdict,"unverified");
  assert.equal(assessRequiredCi(["Platform CI"],[
    run("Platform CI","in_progress",null)],sha,5).verdict,"running");
  assert.equal(assessRequiredCi(["Platform CI"],[
    run("Platform CI","completed","success")],sha,5).verdict,"success");
  assert.equal(assessRequiredCi([],[
    run("Platform CI","completed","success")],sha,5).verdict,"unverified");
});

test("private open PR listing inherits required CI policies without leaking token", async()=>{
  const sha="d".repeat(40);
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,header:options.headers.Authorization});
    if(url.includes("/pulls?"))return new Response(JSON.stringify([{
      number:53,updated_at:"2026-10-20T10:00:00Z",labels:[]
    }]));
    if(url.includes("/pulls/53"))return new Response(JSON.stringify({
      number:53,html_url:"https://github.com/x/y/pull/53",title:"UX",
      draft:true,state:"open",base:{ref:"main"},head:{ref:"feature",sha}
    }));
    if(url.endsWith("/status"))return new Response(JSON.stringify({total_count:0}));
    return new Response(JSON.stringify({workflow_runs:[
      {id:70,name:"ReBloom canonical Linux validation",head_sha:sha,event:"pull_request",
        status:"completed",conclusion:"success",created_at:"2026-10-20T10:00:00Z",
        pull_requests:[{number:53,head:{sha}}]}
    ]}));
  };
  const project={github:{repository:"erikkaniss-ai/rebloom-world",private:true,
    mode:"open-pulls",requiredWorkflows:["ReBloom canonical Linux validation"]}};
  const result=await refreshGithub(project,{token:"restricted-secret",fetchImpl});
  assert.equal(result.pullRequests[0].requiredCi.verdict,"success");
  assert.equal(JSON.stringify(result).includes("restricted-secret"),false);
  assert.equal(calls.every(x=>x.header==="Bearer restricted-secret"),true);
});


test("independent PR, Actions and commit-status reads preserve partial verified evidence",async()=>{
  const sha="a".repeat(40);
  const project={github:{repository:"erikkaniss-ai/fillmycourt",pullRequest:5,
    requiredWorkflows:["Platform CI"]}};
  const pr={number:5,html_url:"https://github.com/erikkaniss-ai/fillmycourt/pull/5",
    title:"Draft",draft:true,state:"open",base:{ref:"getacourt-staging"},
    head:{ref:"get/rc",sha}};
  const run={id:50,name:"Platform CI",head_sha:sha,event:"pull_request",
    status:"completed",conclusion:"success",created_at:"2026-10-20T10:00:00Z",
    pull_requests:[{number:5,head:{sha}}]};
  const statusDenied=await refreshGithub(project,{token:"read-only-test",
    fetchImpl:async url=>{
      if(url.includes("/pulls/5"))return new Response(JSON.stringify(pr));
      if(url.endsWith("/status"))return new Response("forbidden",{status:403});
      return new Response(JSON.stringify({workflow_runs:[run]}));
    }});
  assert.equal(statusDenied.state,"actual_verified");
  assert.equal(statusDenied.pullRequest.sha,sha);
  assert.equal(statusDenied.requiredCi.verdict,"success");
  assert.equal(statusDenied.commitStatus,"unverified");
  assert.equal(statusDenied.sourceCoverage.pr,true);
  assert.equal(statusDenied.sourceCoverage.actions,true);
  assert.equal(statusDenied.sourceCoverage.commitStatus,false);
  const actionsDenied=await refreshGithub(project,{token:"read-only-test",
    fetchImpl:async url=>{
      if(url.includes("/pulls/5"))return new Response(JSON.stringify(pr));
      if(url.endsWith("/status"))return new Response(JSON.stringify({total_count:0,state:"pending"}));
      return new Response("forbidden",{status:403});
    }});
  assert.equal(actionsDenied.state,"actual_verified");
  assert.equal(actionsDenied.pullRequest.sha,sha);
  assert.equal(actionsDenied.requiredCi.verdict,"unverified");
  assert.equal(actionsDenied.workflows.length,0);
  assert.equal(actionsDenied.sourceCoverage.pr,true);
  assert.equal(actionsDenied.sourceCoverage.actions,false);
  assert.equal(actionsDenied.sourceCoverage.commitStatus,true);
});

test("a failed PR read is not silently upgraded by unrelated Actions",async()=>{
  const project={github:{repository:"erikkaniss-ai/fillmycourt",pullRequest:5,
    requiredWorkflows:["Platform CI"]}};
  let count=0;
  const result=await refreshGithub(project,{token:"read-only-test",fetchImpl:async()=>{
    count++;return new Response("forbidden",{status:403});
  }});
  assert.equal(result.state,"unverified");
  assert.equal(result.pullRequest,undefined);
  assert.equal(count,1);
});


test("verified activity exposes dated PR updates and Actions results without treating them as completion",async()=>{
  const sha="e".repeat(40);
  const source={github:{repository:"erikkaniss-ai/fillmycourt",pullRequest:5,
    requiredWorkflows:["Platform CI"]}};
  const pr={number:5,html_url:"https://github.com/erikkaniss-ai/fillmycourt/pull/5",
    updated_at:"2026-10-20T10:30:00Z",title:"Draft",draft:true,state:"open",
    base:{ref:"getacourt-staging"},head:{ref:"get/rc",sha}};
  const workflows=[{id:57,name:"Platform CI",event:"pull_request",head_sha:sha,
    status:"completed",conclusion:"success",
    html_url:"https://github.com/erikkaniss-ai/fillmycourt/actions/runs/57",
    created_at:"2026-10-20T10:35:00Z",
    pull_requests:[{number:5,head:{sha}}]}];
  const result=await refreshGithub(source,{token:"test-only",fetchImpl:async url=>{
    if(url.includes("/pulls/5"))return Response.json(pr);
    if(url.endsWith("/status"))return Response.json({total_count:0});
    return Response.json({workflow_runs:workflows});
  }});
  assert.equal(result.sourceActivity.length,2);
  assert.equal(result.sourceActivity[0].kind,"ci_run");
  assert.equal(result.sourceActivity[0].at,"2026-10-20T10:35:00.000Z");
  assert.equal(result.sourceActivity[1].kind,"pr_updated");
  assert.equal(result.sourceActivity[1].at,"2026-10-20T10:30:00.000Z");
  assert.equal(result.sourceActivity.every(e=>e.url.startsWith("https://github.com/")),true);
  assert.equal(result.requiredCi.verdict,"success");
  assert.equal(result.progress,undefined);
});

test("invalid or absent dates never become invented timeline events",async()=>{
  const {sourceActivity}=await import("../server.mjs");
  const sha="f".repeat(40);
  const events=sourceActivity({
    number:5,html_url:"https://github.com/example/repo/pull/5",updated_at:"invalid"
  },[{id:71,name:"Optional",head_sha:sha,status:"completed",conclusion:"success",
    created_at:"",html_url:"https://github.com/example/repo/actions/runs/71"}],sha);
  assert.deepEqual(events,[]);
});
