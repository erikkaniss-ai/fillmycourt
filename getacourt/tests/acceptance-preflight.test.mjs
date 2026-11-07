import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {CHECKS,evaluatePreflight} from "../qa/acceptance-preflight.mjs";

// Entirely fictional approval/evidence records. NOT actual authority or hosted proof.
const sha="a".repeat(40),now="2030-01-01T12:00:00Z";
const context={sha,now};
const origin="https://deploy-preview-5--getacourt-preview.netlify.app";
const factFixtures={
  "source-ci":{success:true},
  isolation:{syntheticOnly:true,providersDisabled:true,bookingDisabled:true,paymentsDisabled:true,nonProductionBackend:true},
  perimeter:{anonymousStatus:401,teamAccessVerified:true},
  "ios-device":{physical:true,consent:true,testerRef:"fixture:tester",osVersion:"ios-fixture",browserVersion:"safari-fixture"},
  "android-device":{physical:true,consent:true,testerRef:"fixture:tester",osVersion:"android-fixture",browserVersion:"chrome-fixture"},
  "location-consent":{consent:true,testerRef:"fixture:tester",deviceRef:"fixture:device",noCoordinatesRetained:true},
  "oauth-config":{stagingProjectRef:"fixture:auth-project",clientRef:"fixture:google-client",callbackUrl:origin+"/",exactRedirectsReviewed:true,minimalIdentityScopes:true,noProductionAuth:true,noConfigChanges:true},
  "oauth-consent":{consent:true,testerRef:"fixture:tester",testAccountRef:"fixture:account",allowTestUserSessionCreation:true,allowOwnSessionRefreshSignOut:true},
  "assistive-device":{physical:true,consent:true,testerRef:"fixture:tester",deviceRef:"fixture:device",screenReaderVersion:"reader-fixture",browserVersion:"browser-fixture"}
};
function fixture(){
  const binding={sha,origin,deployId:"fixture:existing-deploy"};
  return {schemaVersion:1,candidate:{sha,pr:5,branch:"get/release-candidate-mvp-qa-04",state:"open",draft:true,merged:false},
    deployment:{...binding,nonProduction:true,observedAt:"2030-01-01T11:00:00Z",expiresAt:"2030-01-01T20:00:00Z",receiptRef:"fixture:deployment",reviewerRef:"fixture:reviewer"},
    evidence:Object.entries(factFixtures).map(([kind,facts])=>({...binding,kind,observedAt:"2030-01-01T11:00:00Z",expiresAt:"2030-01-01T20:00:00Z",receiptRef:"fixture:"+kind,reviewerRef:"fixture:reviewer",facts:structuredClone(facts)})),
    goRecords:CHECKS.map(c=>({...binding,checkId:c.id,decision:"GO",approvedAt:"2030-01-01T11:00:00Z",expiresAt:"2030-01-01T15:00:00Z",receiptRef:"fixture:go-"+c.id,approverRef:"fixture:owner",authorityRef:"fixture:delegation",testerRef:"fixture:tester",actions:[...c.actions]}))};
}
const report=input=>evaluatePreflight(input,context);
const check=(input,id)=>report(input).checks.find(c=>c.id===id);
const blocked=(input,id)=>assert.equal(check(input,id).preflight,"BLOCKED");
const evidence=(input,kind)=>input.evidence.find(e=>e.kind===kind);

test("Complete fictional records only prepare manual review, never execution or release",()=>{
  const input=fixture(),before=JSON.stringify(input),r=report(input);
  assert.equal(r.checks.length,7);assert.equal(r.executionEnabled,false);
  assert.equal(r.authorityVerified,false);assert.equal(r.releaseReady,false);
  assert.equal(r.reviewedSha,sha);assert.equal(r.asOf,now);
  assert.equal(r.workerActivation,"NOT_AUTHORISED");
  for(const c of r.checks){assert.equal(c.preflight,"READY_FOR_MANUAL_GO_REVIEW");assert.equal(c.execution,"NOT_RUN");assert.equal(c.executionEnabled,false);}
  assert.equal(JSON.stringify(input),before,"Evaluation is immutable");
  assert.equal(check(input,"google-oauth").requiresStateChangeGO,true);
  assert.equal(check(input,"device-location").requiresStateChangeGO,true);
});
test("Current accepted-source snapshot honestly has no deployment, receipts or GO",()=>{
  const input=JSON.parse(readFileSync("getacourt/qa/current-preflight.json","utf8"));
  assert.equal(input.candidate.sha,"be691ef98b5c2adb6ff412b39fae1d44305fee08");
  assert.equal(input.deployment,null);assert.deepEqual(input.evidence,[]);assert.deepEqual(input.goRecords,[]);
  for(const c of evaluatePreflight(input,{sha:input.candidate.sha,now}).checks){
    assert.equal(c.preflight,"BLOCKED");assert.equal(c.execution,"NOT_RUN");
    assert.ok(c.blockers.includes("EXACT_SCOPED_GO_REQUIRED"));
  }
  assert.ok(evaluatePreflight(input,context).checks.every(c=>c.blockers.includes("CANDIDATE_NOT_EXACT_OPEN_DRAFT")));
});
test("Missing, failed, stale, foreign or future evidence cannot be counted",()=>{
  const mutations=[
    i=>i.evidence.splice(i.evidence.findIndex(r=>r.kind==="perimeter"),1),
    i=>evidence(i,"perimeter").facts.anonymousStatus=200,
    i=>evidence(i,"perimeter").facts.anonymousStatus=302,
    i=>evidence(i,"perimeter").facts.teamAccessVerified=false,
    i=>evidence(i,"perimeter").sha="b".repeat(40),
    i=>evidence(i,"perimeter").origin="https://getacourt.com",
    i=>evidence(i,"perimeter").deployId="fixture:other-deploy",
    i=>evidence(i,"perimeter").observedAt="2029-12-30T11:00:00Z",
    i=>evidence(i,"perimeter").observedAt="2030-01-01T13:00:00Z",
    i=>evidence(i,"perimeter").expiresAt=now,
    i=>evidence(i,"perimeter").receiptRef="",
    i=>evidence(i,"perimeter").reviewerRef="",
    i=>evidence(i,"perimeter").observedAt="2029-02-30T11:00:00Z"
  ];
  for(const mutate of mutations){const i=fixture();mutate(i);blocked(i,"hosted-ui");}
});
test("Every receipt kind is mandatory for its check, not substituted by CI",()=>{
  for(const c of CHECKS)for(const kind of c.kinds){const i=fixture();i.evidence=i.evidence.filter(r=>r.kind!==kind);blocked(i,c.id);}
  for(const flag of Object.keys(factFixtures.isolation)){const i=fixture();evidence(i,"isolation").facts[flag]=false;assert.ok(report(i).checks.every(c=>c.preflight==="BLOCKED"));}
});
test("Candidate/deployment must be exact Draft PR5 on the existing nonproduction site",()=>{
  const mutations=[
    i=>i.candidate.draft=false,i=>i.candidate.merged=true,i=>i.candidate.state="closed",i=>i.candidate.pr=14,
    i=>i.candidate.branch="main",i=>i.candidate.sha="b".repeat(40),
    i=>i.deployment.nonProduction=false,i=>i.deployment.sha="b".repeat(40),
    i=>i.deployment.observedAt="2029-12-20T11:00:00Z",i=>i.deployment.expiresAt=now,
    ...["https://getacourt.com","https://getacourt-preview.netlify.app","https://deploy-preview-8--getacourt-preview.netlify.app",
      origin+"/",origin+"?token=secret",origin+".evil.invalid","http://deploy-preview-5--getacourt-preview.netlify.app",
      "https://user:pass@deploy-preview-5--getacourt-preview.netlify.app"].map(url=>i=>i.deployment.origin=url)
  ];
  for(const mutate of mutations){const i=fixture();mutate(i);assert.ok(report(i).checks.every(c=>c.preflight==="BLOCKED"));}
});
test("Each GO is separate, exact-bound, time-bounded and no broader than listed actions",()=>{
  for(const c of CHECKS){
    const mutations=[
      g=>g.decision="NO_GO",g=>g.sha="b".repeat(40),g=>g.origin="https://getacourt.com",
      g=>g.deployId="fixture:other",g=>g.approverRef="",g=>g.authorityRef="",g=>g.testerRef="",g=>g.receiptRef="",
      g=>g.approvedAt="2030-01-01T13:00:00Z",g=>g.expiresAt=now,
      g=>g.expiresAt="2030-01-02T15:00:00Z",g=>g.actions.pop(),
      g=>g.actions.push("production-deploy"),g=>g.actions.push(g.actions[0])
    ];
    for(const mutate of mutations){const i=fixture();mutate(i.goRecords.find(g=>g.checkId===c.id));blocked(i,c.id);}
    const i=fixture();i.goRecords=i.goRecords.filter(g=>g.checkId!==c.id);blocked(i,c.id);
  }
});
test("Physical devices and matching tester consent are not browser emulation",()=>{
  for(const [id,kind] of [["ios-safari","ios-device"],["android-chrome","android-device"],["human-accessibility","assistive-device"]]){
    for(const flag of ["physical","consent"]){const i=fixture();evidence(i,kind).facts[flag]=false;blocked(i,id);}
    const i=fixture();evidence(i,kind).facts.testerRef="fixture:someone-else";blocked(i,id);
  }
  const i=fixture();evidence(i,"location-consent").facts.noCoordinatesRetained=false;blocked(i,"device-location");
});
test("OAuth GO acknowledges auth writes and cannot be inherited from read-only hosted GO",()=>{
  for(const flag of ["allowTestUserSessionCreation","allowOwnSessionRefreshSignOut","consent"]){
    const i=fixture();evidence(i,"oauth-consent").facts[flag]=false;blocked(i,"google-oauth");
  }
  for(const flag of ["exactRedirectsReviewed","minimalIdentityScopes","noProductionAuth","noConfigChanges"]){
    const i=fixture();evidence(i,"oauth-config").facts[flag]=false;blocked(i,"google-oauth");
  }
  for(const url of ["https://getacourt.com/",origin+"/*",origin+"/?code=secret"]){
    const i=fixture();evidence(i,"oauth-config").facts.callbackUrl=url;blocked(i,"google-oauth");
  }
  const i=fixture();i.goRecords.find(g=>g.checkId==="google-oauth").actions=[...CHECKS.find(c=>c.id==="hosted-ui").actions];blocked(i,"google-oauth");
});
test("Unknown, duplicated and malformed records fail closed without echoing secrets",()=>{
  const mutations=[i=>i.evidence.push(structuredClone(i.evidence[0])),i=>i.goRecords.push(structuredClone(i.goRecords[0])),
    i=>i.evidence.push(null),i=>i.goRecords.push(null),i=>i.evidence.push({kind:"unknown"}),
    i=>i.goRecords.push({checkId:"production"}),i=>i.password="SECRET_MUST_NOT_ECHO",i=>i.evidence[0].token="SECRET_MUST_NOT_ECHO",
    i=>i.evidence[0].facts.token="SECRET_MUST_NOT_ECHO"];
  for(const mutate of mutations){const i=fixture();mutate(i);const r=report(i);assert.ok(r.checks.some(c=>c.preflight==="BLOCKED"));assert.doesNotMatch(JSON.stringify(r),/SECRET_MUST_NOT_ECHO/);}
  for(const i of [null,{},[],{schemaVersion:999},{...fixture(),evidence:"invalid"},{...fixture(),goRecords:{}}]){
    assert.ok(report(i).checks.every(c=>c.preflight==="BLOCKED"));
  }
  for(const ctx of [{},{sha,now:"bad"},{sha,now:"2030-02-30T12:00:00Z"}])assert.ok(evaluatePreflight(fixture(),ctx).checks.every(c=>c.preflight==="BLOCKED"));
});
test("Pure planner and local CLI have no network, credential, worker or app registration path",()=>{
  for(const file of ["getacourt/qa/acceptance-preflight.mjs","getacourt/qa/preflight-cli.mjs"]){
    const source=readFileSync(file,"utf8");
    assert.doesNotMatch(source,/\bfetch\s*\(|https?\.request|process\.env|writeFile|execSync|serviceWorker|window\.|document\.|supabase\.auth/);
    assert.doesNotMatch(source,/node:(?:https?|net|child_process)/);
  }
  const ci=readFileSync(".github/workflows/platform-ci.yml","utf8");
  assert.match(ci,/node --test getacourt\/tests\/acceptance-preflight.test.mjs/);
  assert.match(ci,/github.event.pull_request.head.sha \|\| github.sha/);
  assert.match(ci,/test "\$result" -eq 2/);
  assert.match(ci,/name: getacourt-acceptance-preflight-NOT-RUN/);
  assert.doesNotMatch(ci,/run: node platform\/tests\/getacourt_preview_perimeter_smoke.mjs/);
  assert.match(ci,/pytest -q platform\/tests/);assert.match(ci,/browser-accessibility.mjs/);assert.match(ci,/browser-offline.mjs/);
  const retired=spawnSync(process.execPath,["platform/tests/getacourt_preview_perimeter_smoke.mjs"],{encoding:"utf8"});
  assert.equal(retired.status,2);assert.match(retired.stderr,/QA_PREVIEW_02_RETIRED/);
  assert.doesNotMatch(readFileSync("platform/tests/getacourt_preview_perimeter_smoke.mjs","utf8"),/fetch\s*\(|https:\/\//);
});
test("CLI returns BLOCKED as exit 2, generic parse failure as exit 1, no false PASS",()=>{
  const result=spawnSync(process.execPath,["getacourt/qa/preflight-cli.mjs","--input","getacourt/qa/current-preflight.json","--sha","be691ef98b5c2adb6ff412b39fae1d44305fee08","--now",now],{encoding:"utf8"});
  assert.equal(result.status,2);const r=JSON.parse(result.stdout);assert.ok(r.checks.every(c=>c.execution==="NOT_RUN"));
  const invalid=spawnSync(process.execPath,["getacourt/qa/preflight-cli.mjs","--input","SECRET_MUST_NOT_ECHO"],{encoding:"utf8"});
  assert.equal(invalid.status,1);assert.doesNotMatch(invalid.stderr,/SECRET_MUST_NOT_ECHO/);
  const malformed=spawnSync(process.execPath,["getacourt/qa/preflight-cli.mjs","--input","getacourt/assets/app.js","--sha",sha,"--now",now],{encoding:"utf8"});
  assert.equal(malformed.status,1);assert.match(malformed.stderr,/PREFLIGHT_INPUT_REJECTED/);assert.equal(malformed.stdout,"");
});
