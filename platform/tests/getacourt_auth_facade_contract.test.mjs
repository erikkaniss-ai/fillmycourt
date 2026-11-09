import test from "node:test";
import assert from "node:assert/strict";
import config from "../../netlify/functions/getacourt-platform-config.mts";
import exchange from "../../netlify/functions/getacourt-auth-google-exchange.mts";
import signOut from "../../netlify/functions/getacourt-auth-sign-out.mts";
import magicLink from "../../netlify/functions/getacourt-auth-magic-link.mts";
const previous={};
async function run(handler,req,flag="false",emailFlag="false"){
 const savedFetch=globalThis.fetch,savedEnv=globalThis.Netlify;
 const calls=[];
 globalThis.Netlify={env:{get:key=>({
 GETACOURT_CORE_API_BASE:"https://core.fixture.test",
 GETACOURT_SUPABASE_URL:"https://fixture.supabase.co",
 GETACOURT_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_ci",
 GETACOURT_GOOGLE_SIGNIN_ENABLED:flag,
 GETACOURT_EMAIL_SIGNIN_ENABLED:emailFlag,
 GETACOURT_AUTH_REDIRECT_URL:"https://deploy-preview-5--getacourt-preview.netlify.app/"
 })[key]||null}};
 globalThis.fetch=async(url,init)=>{
   calls.push({url:String(url),init});
   if(String(url).includes("/api/config"))return Response.json({booking_enabled:false,online_payments:false,auth:"supabase"});
   if(String(url).includes("grant_type=pkce"))return Response.json({access_token:"user.jwt",refresh_token:"refresh.fake",expires_in:3600,provider_token:"DO_NOT_RETURN"});
   if(String(url).includes("/logout"))return Response.json({});
   if(String(url).includes("/auth/v1/otp"))return Response.json({});
   throw Error("Unexpected network");
 };
 try{const out=await handler(req);return {status:out.status,data:await out.json(),calls};}
 finally{globalThis.fetch=savedFetch;globalThis.Netlify=savedEnv;}
}
const req=(path,method="GET",obj=null,headers={})=>new Request("https://getacourt.test"+path,{
 method,headers:{...headers,...(obj?{"content-type":"application/json"}:{})},
 ...(obj?{body:JSON.stringify(obj)}:{})
});
test("Public config defaults Google disabled, no public API credentials",async()=>{
 const r=await run(config,req("/api/gac/platform-config"),"false");
 assert.equal(r.data.googleSignInEnabled,false);
 assert.equal(r.data.supabaseAuthUrl,null);
 assert.equal(r.data.bookingEnabled,false);
 assert.equal(r.data.onlinePayments,false);
 assert.ok(!("supabasePublishableKey" in r.data));
});
test("Staging Google flag explicitly enables public auth URL only",async()=>{
 const r=await run(config,req("/api/gac/platform-config"),"true");
 assert.equal(r.data.googleSignInEnabled,true);
 assert.equal(r.data.supabaseAuthUrl,"https://fixture.supabase.co");
});
test("PKCE code exchange is disabled by default and validates verifier",async()=>{
 const disabled=await run(exchange,req("/api/gac/auth/google/exchange","POST",{authCode:"12345678-1234-1234-1234-123456789abc",codeVerifier:"A".repeat(43)}));
 assert.equal(disabled.status,503);assert.equal(disabled.calls.length,0);
 const bad=await run(exchange,req("/api/gac/auth/google/exchange","POST",{authCode:"evil",codeVerifier:"x"}),"true");
 assert.equal(bad.status,400);assert.equal(bad.calls.length,0);
});
test("PKCE exchange returns own app session, never Google provider token",async()=>{
 const r=await run(exchange,req("/api/gac/auth/google/exchange","POST",{authCode:"12345678-1234-1234-1234-123456789abc",codeVerifier:"A".repeat(43)}),"true");
 assert.equal(r.status,200);
 assert.equal(r.data.access_token,"user.jwt");
 assert.ok(!("provider_token" in r.data));
 assert.equal(r.calls.length,1);
 assert.equal(r.calls[0].init.headers.apikey,"sb_publishable_ci");
 assert.equal(JSON.parse(r.calls[0].init.body).code_verifier,"A".repeat(43));
});
test("Sign-out requires bearer before upstream call",async()=>{
 const noAuth=await run(signOut,req("/api/gac/auth/sign-out","POST"),"true");
 assert.equal(noAuth.status,401);assert.equal(noAuth.calls.length,0);
 const authed=await run(signOut,req("/api/gac/auth/sign-out","POST",null,{authorization:"Bearer user.jwt"}),"true");
 assert.equal(authed.status,200);
 assert.equal(authed.calls[0].init.headers.authorization,"Bearer user.jwt");
});

test("Auth exchange and sign-out reject cross-origin browser posts before upstream",async()=>{
 const code={authCode:"12345678-1234-1234-1234-123456789abc",codeVerifier:"A".repeat(43)};
 const r=await run(exchange,req("/api/gac/auth/google/exchange","POST",code,{origin:"https://attacker.test"}),"true");
 assert.equal(r.status,403);assert.equal(r.data.error,"INVALID_ORIGIN");assert.equal(r.calls.length,0);
 const o=await run(signOut,req("/api/gac/auth/sign-out","POST",null,{
   origin:"https://attacker.test",authorization:"Bearer fake.jwt"
 }),"true");
 assert.equal(o.status,403);assert.equal(o.calls.length,0);
});

test("P0 disabled magic-link API rejects unsolicited POST before Supabase delivery",async()=>{
 const payload={email:"fixture-person@example.invalid"};
 for(const enabled of ["false","","True ","off"]){
  const r=await run(magicLink,req("/api/gac/auth/magic-link","POST",payload),"false",enabled);
  assert.equal(r.status,503,enabled);
  assert.equal(r.data.error,"EMAIL_SIGNIN_DISABLED",enabled);
  assert.equal(r.calls.length,0,"No upstream OTP or sign-up network call on disabled email flow");
 }
});

test("P0 enabled magic-link uses fixture Supabase OTP only behind explicit opt-in",async()=>{
 const r=await run(magicLink,req("/api/gac/auth/magic-link","POST",
  {email:"fixture-person@example.invalid"}),"false","true");
 assert.equal(r.status,200);
 assert.equal(r.data.ok,true);
 assert.equal(r.calls.length,1);
 const uri=new URL(r.calls[0].url);
 assert.equal(uri.hostname,"fixture.supabase.co");
 assert.equal(uri.pathname,"/auth/v1/otp");
 assert.equal(uri.searchParams.get("redirect_to"),
  "https://deploy-preview-5--getacourt-preview.netlify.app/");
 assert.equal(r.calls[0].init.method,"POST");
 assert.equal(r.calls[0].init.headers.apikey,"sb_publishable_ci");
 const payload=JSON.parse(r.calls[0].init.body);
 assert.equal(payload.email,"fixture-person@example.invalid");
 assert.equal(payload.create_user,true);
});

test("P0 cross-origin magic-link request never sends email even with flag enabled",async()=>{
 const r=await run(magicLink,req("/api/gac/auth/magic-link","POST",
  {email:"fixture-person@example.invalid"},{origin:"https://attacker.invalid"}),"false","true");
 assert.equal(r.status,403);
 assert.equal(r.data.error,"INVALID_ORIGIN");
 assert.equal(r.calls.length,0);
});
