import test from "node:test";
import assert from "node:assert/strict";
import login,{config} from "../netlify/functions/fill-operator-password-login.mts";
import {readFileSync} from "node:fs";

const SITE="d763b7a1-dccd-4638-8876-ac1670171698";
const HOST="https://fill-pr8-ab12345--fillmycourt-preview.netlify.app";
const make=(body,opts={})=>new Request(HOST+"/api/fmc-auth/login",{
 method:opts.method||"POST",
 headers:opts.headers||{"content-type":"application/json",origin:HOST},
 ...(opts.method==="GET"?{}:{body:typeof body==="string"?body:JSON.stringify(body)})
});
const context=(id=SITE)=>({site:{id}});
const JWT="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2ln";
async function mockFetch(fn,run){
 const prev=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return fn(url,init)};
 try{return {...await run(),calls};}
 finally{globalThis.fetch=prev;}
}
test("Only private site accepts password login; no signup or privileged API",async()=>{
 assert.equal(config.path,"/api/fmc-auth/login");
 const s=readFileSync("platform/netlify/functions/fill-operator-password-login.mts","utf8");
 assert.match(s,/sb_publishable_/);
 assert.doesNotMatch(s,/sb_secret_|service_role|admin\/users|\/signup|\/recover/);
 const invalid=await mockFetch(()=>{throw Error("Should not reach network");},async()=>({
  badSite:await login(make({email:"x@example.test",password:"example"}),context("other")),
  badMethod:await login(make(null,{method:"GET"}),context())
 }));
 assert.equal(invalid.badSite.status,403);
 assert.equal(invalid.badMethod.status,405);
 assert.equal(invalid.calls.length,0);
});
test("Reject invalid, cross-origin, oversized and malformed requests before network",async()=>{
 const result=await mockFetch(()=>{throw Error("network blocked");},async()=>({
  invalidEmail:await login(make({email:"broken",password:"test"}),context()),
  invalidPassword:await login(make({email:"x@example.test",password:""}),context()),
  invalidJSON:await login(make("{oops"),context()),
  crossOrigin:await login(make({email:"x@example.test",password:"test"},{
    headers:{"content-type":"application/json",origin:"https://other.example.test"}
  }),context()),
  oversized:await login(make({email:"x@example.test",password:"a".repeat(1200)}),context())
 }));
 for(const [kind,response] of Object.entries(result)){
  if(kind!=="calls")assert.ok([400,403,413].includes(response.status),kind);
 }
 assert.equal(result.calls.length,0);
});
test("Authenticates through only staging Supabase password endpoint and returns access token, not refresh token",async()=>{
 const result=await mockFetch((url,init)=>{
  assert.equal(String(url),"https://yclqnbcrchwieyzkyumx.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(init.method,"POST");
  assert.match(init.headers.apikey,/^sb_publishable_/);
  assert.equal(init.redirect,"manual");
  assert.equal(init.cache,"no-store");
  const data=JSON.parse(init.body);
  assert.deepEqual(data,{email:"operator@example.test",password:"fictional-password"});
  return Response.json({access_token:JWT,refresh_token:"NEVER_RETURN",expires_in:3600});
 },async()=>{
  const response=await login(make({email:"operator@example.test",password:"fictional-password"}),context());
  return {status:response.status,headers:response.headers,body:await response.json()};
 });
 assert.equal(result.status,200);
 assert.equal(result.body.access_token,JWT);
 assert.equal(result.body.expires_in,3600);
 assert.equal(result.body.refresh_token,undefined);
 assert.equal(result.headers.get("cache-control"),"no-store, private");
 assert.equal(result.headers.get("access-control-allow-origin"),null);
 assert.equal(result.calls.length,1);
});
test("Auth failure hides user enumeration and doesn't return upstream token contents",async()=>{
 const r=await mockFetch(()=>Response.json({msg:"this address not found"}, {status:401}),async()=>{
  const response=await login(make({email:"missing@example.test",password:"pass"}),context());
  return {status:response.status,body:await response.json()};
 });
 assert.equal(r.status,401);
 assert.deepEqual(r.body,{error:"INVALID_CREDENTIALS"});
});
test("App offers explicit non-signup login form and browser-session token, not token-in-URL submission",()=>{
 const html=readFileSync("platform/public/fill/index.html","utf8");
 const app=readFileSync("platform/public/fill/app.js","utf8");
 assert.match(html,/id="operatorSignIn"/);
 assert.match(html,/<form[^>]*id="operatorSignIn"[^>]*method="post"[^>]*action="\/api\/fmc-auth\/login"/);
 assert.match(html,/id="operatorEmail"/);
 assert.match(html,/id="operatorPassword"/);
 assert.match(app,/"\/api\/fmc-auth\/login"/);
 assert.match(app,/sessionStorage\.setItem\("fill\.access"/);
 assert.match(app,/localStorage\.removeItem\("fill\.access"\)/);
 assert.doesNotMatch(html,/register|sign up|Sign up|create account/i);
});

test("Password-only operator never trusts URL fragment or persistent localStorage bearer",()=>{
  const app=readFileSync("platform/public/fill/app.js","utf8");
  assert.match(app,/sessionStorage\.getItem\("fill\.access"\)/);
  assert.match(app,/history\.replaceState\(null, "", location\.pathname \+ location\.search\)/);
  assert.match(app,/fragment\.has\("access_token"\)/);
  assert.match(app,/fragment\.has\("refresh_token"\)/);
  assert.doesNotMatch(app,/localStorage\.getItem\("fill\.access"\)/);
  assert.doesNotMatch(app,/localStorage\.setItem\("fill\.access"\)/);
});
