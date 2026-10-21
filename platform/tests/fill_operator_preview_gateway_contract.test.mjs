import test from "node:test";
import assert from "node:assert/strict";
import proxy, {config} from "../netlify/functions/fill-operator-readonly.mts";
import {readFileSync} from "node:fs";
const APP = "https://fillmycourt-preview.netlify.app";
const OPS = "https://fmc-operations-api-staging.up.railway.app";
const FILL_SITE_ID = "d763b7a1-dccd-4638-8876-ac1670171698";
const OTHER_SITE_ID = "72eee365-bff0-48ec-bb8f-f08ff01341b7";
const ID = "11111111-1111-4111-8111-111111111111";
const paths = ["/api/me", "/api/fmc/organizations",
  "/api/fmc/"+ID+"/today?date=2026-10-16",
  "/api/fmc/"+ID+"/calendar?start=2026-10-16T00%3A00%3A00%2B01%3A00&end=2026-10-17T00%3A00%3A00%2B01%3A00",
  "/api/fmc/"+ID+"/provider-provenance/connections",
  "/api/fmc/"+ID+"/provider-provenance/preflight?expected_operations_sha="+"a".repeat(40),
  "/api/fmc/"+ID+"/provider-provenance/"+ID+"?max_age_seconds=60&limit=50",
  "/api/fmc/"+ID+"/provider-provenance/"+ID+"?max_age_seconds=60&limit=50&after_booking_id="+ID];
const request = (path, options={}) => new Request(APP+path,{method:options.method||"GET",
  headers: options.headers||{"authorization":"Bearer fixture-staging-user"}});
async function harness(req, env=OPS, upstreamStatus=200, siteId=FILL_SITE_ID) {
  const previousNetlify=globalThis.Netlify, previousFetch=globalThis.fetch;
  const calls=[];
  globalThis.Netlify={env:{get:name=>name==="FILL_OPERATIONS_API_BASE"?env:null}};
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),method:init.method,redirect:init.redirect,
      authorization:init.headers.authorization,headers:init.headers});
    return Response.json(upstreamStatus===200?{items:[]}:{error:"PERMISSION_DENIED"},
      {status:upstreamStatus,headers:{"content-type":"application/json"}});
  };
  try {const r=await proxy(req,{site:{id:siteId}});return {status:r.status,body:await r.json(),
    headers:r.headers,calls};}
  finally{globalThis.Netlify=previousNetlify;globalThis.fetch=previousFetch;}
}
test("Private Fill gateway registers only approved Operations GET routes",()=>{
  assert.deepEqual(config.path,["/api/me","/api/fmc/organizations",
    "/api/fmc/:org/today","/api/fmc/:org/calendar",
    "/api/fmc/:org/provider-provenance/connections",
    "/api/fmc/:org/provider-provenance/preflight","/api/fmc/:org/provider-provenance/:connection"]);
  const conf=readFileSync("platform/netlify.toml","utf8");
  assert.match(conf,/publish = "public"/);
  assert.match(conf,/directory = "netlify\/functions"/);
  assert.match(conf,/X-Robots-Tag = "noindex, nofollow, noarchive"/);
  assert.doesNotMatch(conf,/GETACOURT_|provider|payment/i);
});
test("Provenance route accepts only explicit bounded freshness and cursor, no secret query",async()=>{
  const root="/api/fmc/"+ID+"/provider-provenance/";
  for(const path of [root+"connections?token=secret",root+"bad?max_age_seconds=60&limit=50",
    root+ID,root+ID+"?max_age_seconds=0&limit=50",root+ID+"?max_age_seconds=31536001&limit=50",
    root+ID+"?max_age_seconds=1.5&limit=50",root+ID+"?max_age_seconds=1e3&limit=50",
    root+ID+"?max_age_seconds=60&limit=51",root+ID+"?max_age_seconds=60&limit=50&x=1",
    root+ID+"?max_age_seconds=60&limit=50&limit=1",root+ID+"?max_age_seconds=60&limit=50&after_booking_id=",
    root+ID+"?max_age_seconds=60&limit=50&after_booking_id=foreign"]){
    const r=await harness(request(path));assert.equal(r.status,422,path);assert.equal(r.calls.length,0);
  }
  for(const method of ["PUT","PATCH","DELETE","HEAD"]){
    const r=await harness(request(paths.at(-1),{method}));
    assert.equal(r.status,405);assert.equal(r.calls.length,0);
  }
});
test("Operations preflight accepts exactly one full expected SHA, never arbitrary query/target",async()=>{
  const root="/api/fmc/"+ID+"/provider-provenance/preflight";
  for(const query of ["","?expected_operations_sha=short","?expected_operations_sha="+"A".repeat(40),
    "?expected_operations_sha="+"a".repeat(40)+"&expected_operations_sha="+"b".repeat(40),
    "?expected_operations_sha="+"a".repeat(40)+"&url=https://provider.invalid",
    "?expected_operations_sha="+"a".repeat(40)+"&max_age_seconds=60"]){
    const r=await harness(request(root+query));
    assert.equal(r.status,422);assert.equal(r.calls.length,0);
  }
  for(const status of [401,403,404,503]){
    const r=await harness(request(root+"?expected_operations_sha="+"a".repeat(40)),OPS,status);
    assert.equal(r.status,status);assert.equal(r.calls.length,1);
    assert.equal(r.headers.get("cache-control"),"no-store, private");
  }
});
test("Without bearer, no Railway request is sent",async()=>{
  for(const path of paths){
    const result=await harness(request(path,{headers:{}}));
    assert.equal(result.status,401,path);
    assert.equal(result.calls.length,0,path);
  }
});
test("All POST and unsupported operations are rejected without upstream calls",async()=>{
  for(const path of paths){
    const r=await harness(request(path,{method:"POST"}));
    assert.equal(r.status,405);
    assert.equal(r.calls.length,0);
  }
  for(const path of ["/api/holds","/api/fmc/"+ID+"/people",
    "/api/fmc/"+ID+"/opportunities","/api/fmc/"+ID+"/crm-actions",
    "/api/fmc/"+ID+"/reconciliation/runs"]){
    const r=await harness(request(path));
    assert.equal(r.status,404,path);
    assert.equal(r.calls.length,0);
  }
});
test("Only exact UUID, date and timezone-range query shape accepted",async()=>{
  for(const path of ["/api/fmc/not-a-uuid/today?date=2026-10-16",
    "/api/fmc/"+ID+"/today?date=2026-02-30",
    "/api/fmc/"+ID+"/today?date=2026-10-16&x=1",
    "/api/fmc/"+ID+"/today?date=2026-10-16&date=2026-10-17",
    "/api/fmc/"+ID+"/calendar?start=x&end=y",
    "/api/fmc/"+ID+"/calendar?start=2026-10-16T10:00:00Z&end=2026-10-15T10:00:00Z",
    "/api/fmc/"+ID+"/calendar?start=2026-10-16T10:00:00Z&end=2026-12-16T10:00:00Z",
    "/api/me?token=secret","/api/fmc/organizations?x=1"]){
    const r=await harness(request(path));
    assert.equal(r.status,422,path);
    assert.equal(r.calls.length,0,path);
  }
});
test("No cross-origin browser requests; no external/misconfigured upstream hosts",async()=>{
  const origin=await harness(request("/api/me", {headers:{
    authorization:"Bearer fixture-staging-user",origin:"https://example.test"}}));
  assert.equal(origin.status,403);
  assert.equal(origin.calls.length,0);
  for(const bad of ["http://"+OPS.slice(8),
    "https://example.test","https://fmc-core-api-staging.up.railway.app",
    "https://fmc-operations-api-staging.up.railway.app.evil.test",
    "https://fmc-operations-api-staging.up.railway.app/other"]){
    const r=await harness(request("/api/me"),bad);
    assert.equal(r.status,503,String(bad));
    assert.equal(r.calls.length,0);
  }
});
test("No env var required, but wrong Netlify project/invalid configured URL fails shut",async()=>{
  const correct=await harness(request("/api/me"),null);
  assert.equal(correct.status,200);
  assert.equal(correct.calls.length,1);
  assert.equal(correct.calls[0].url,OPS+"/api/me");
  for(const invalidSite of [OTHER_SITE_ID,"",null]){
    const r=await harness(request("/api/me"),null,200,invalidSite);
    assert.equal(r.status,503);
    assert.equal(r.calls.length,0);
  }
});

test("Permitted GETs forward bearer ONLY to Operations with no redirects/cache",async()=>{
  for(const path of paths){
    const r=await harness(request(path));
    assert.equal(r.status,200,path);
    assert.equal(r.calls.length,1,path);
    assert.equal(r.calls[0].method,"GET");
    assert.equal(r.calls[0].authorization,"Bearer fixture-staging-user");
    assert.equal(r.calls[0].redirect,"manual");
    assert.ok(r.calls[0].url.startsWith(OPS+"/api/"));
    assert.equal(r.headers.get("cache-control"),"no-store, private");
    assert.equal(r.headers.get("access-control-allow-origin"),null);
  }
});
test("Operations rejects expired or unauthorized bearer without inventing session",async()=>{
  const r=await harness(request("/api/me"),OPS,401);
  assert.equal(r.status,401);
  assert.equal(r.calls.length,1);
  assert.equal(r.body.error,"PERMISSION_DENIED");
  assert.equal(r.headers.get("cache-control"),"no-store, private");
});

test("Private Fill root always redirects to Operator, even though GetACourt index exists",()=>{
  const conf=readFileSync("platform/netlify.toml","utf8");
  const root=readFileSync("platform/public/index.html","utf8");
  assert.match(root,/<title>GetACourt /,"Shared platform publishes a GetACourt root document");
  // Netlify otherwise shadows a non-forced / redirect with the physical index.html.
  // This MUST only apply to the isolated private platform/netlify.toml, not public sites.
  assert.match(conf,/\[\[redirects\]\]\s+from = "\/"\s+to = "\/fill\/"\s+status = 302\s+force = true/);
});


test("Cross-tenant denial remains a 403 and cannot become visible operator data",async()=>{
  const OTHER_ORG="33333333-3333-4333-8333-333333333333";
  for(const path of [
    "/api/fmc/"+OTHER_ORG+"/today?date=2026-10-16",
    "/api/fmc/"+OTHER_ORG+"/calendar?start=2026-10-16T00%3A00%3A00%2B01%3A00&end=2026-10-17T00%3A00%3A00%2B01%3A00"
  ]){
    const result=await harness(request(path),OPS,403);
    assert.equal(result.status,403);
    assert.equal(result.body.error,"PERMISSION_DENIED");
    assert.equal(result.calls.length,1);
    assert.equal(result.calls[0].method,"GET");
    assert.match(result.calls[0].url,/\/api\/fmc\/33333333-3333-4333-8333-333333333333\//);
    assert.equal(result.headers.get("access-control-allow-origin"),null);
    assert.equal(result.headers.get("cache-control"),"no-store, private");
  }
});

test("No bearer, malformed origin or wrong Netlify site cannot reach another org",async()=>{
  const OTHER_ORG="33333333-3333-4333-8333-333333333333";
  const path="/api/fmc/"+OTHER_ORG+"/today?date=2026-10-16";
  const trials=[
    await harness(request(path,{headers:{}})),
    await harness(request(path,{headers:{authorization:"Bearer fixture-staging-user",origin:"https://attacker.test"}})),
    await harness(request(path),OPS,200,OTHER_SITE_ID)
  ];
  assert.deepEqual(trials.map(x=>x.status),[401,403,503]);
  assert.ok(trials.every(x=>x.calls.length===0));
});


test("Unicode byte-size limit rejects oversized no-Content-Length upstream data",async()=>{
  const oldFetch=globalThis.fetch, oldNetlify=globalThis.Netlify;
  const body=JSON.stringify({private_data:"€".repeat(420000)});
  assert.ok(body.length<1024*1024,"fixture is below character limit");
  assert.ok(new TextEncoder().encode(body).byteLength>1024*1024,"fixture is above BYTE limit");
  let calls=0;
  globalThis.Netlify={env:{get:()=>null}};
  globalThis.fetch=async(url,init)=>{
    calls++;
    assert.equal(init.method,"GET");
    assert.ok(String(url).startsWith(OPS+"/api/"));
    return new Response(body,{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const r=await proxy(request("/api/me"),{site:{id:FILL_SITE_ID}});
    assert.equal(r.status,502);
    assert.deepEqual(await r.json(),{error:"OPERATIONS_RESPONSE_LIMIT"});
    assert.equal(r.headers.get("cache-control"),"no-store, private");
    assert.equal(calls,1);
  }finally{
    globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;
  }
});

test("Upstream lying about Content-Length cannot bypass UTF-8 response limit",async()=>{
  const oldFetch=globalThis.fetch, oldNetlify=globalThis.Netlify;
  const body=JSON.stringify({notes:"界".repeat(400000)});
  globalThis.Netlify={env:{get:()=>null}};
  globalThis.fetch=async()=>new Response(body,{status:200,headers:{
    "content-type":"application/json","content-length":"100"
  }});
  try{
    const r=await proxy(request("/api/me"),{site:{id:FILL_SITE_ID}});
    assert.equal(r.status,502);
    assert.deepEqual(await r.json(),{error:"OPERATIONS_RESPONSE_LIMIT"});
  }finally{
    globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;
  }
});


test("Oversize streaming response is cancelled before consuming more than allowed bytes",async()=>{
  const oldFetch=globalThis.fetch, oldNetlify=globalThis.Netlify;
  let cancelled=false, pulls=0;
  const oversized = new ReadableStream({
    pull(controller){
      pulls++;
      if(pulls===1)controller.enqueue(new Uint8Array(1024));
      else if(pulls===2)controller.enqueue(new Uint8Array(1024*1024));
      else controller.close();
    },
    cancel(){cancelled=true;}
  },{highWaterMark:0});
  globalThis.Netlify={env:{get:()=>null}};
  globalThis.fetch=async()=>new Response(oversized,{status:200,headers:{
    "content-type":"application/json"
  }});
  try{
    const response=await proxy(request("/api/me"),{site:{id:FILL_SITE_ID}});
    assert.equal(response.status,502);
    assert.deepEqual(await response.json(),{error:"OPERATIONS_RESPONSE_LIMIT"});
    assert.equal(cancelled,true,"Body stream must be explicitly cancelled at byte ceiling");
    assert.equal(pulls,2,"Never request additional upstream chunks beyond the limit");
  }finally{
    globalThis.fetch=oldFetch;globalThis.Netlify=oldNetlify;
  }
});
