import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {webcrypto} from "node:crypto";
const require=createRequire(import.meta.url);
const auth=require("../../getacourt/assets/auth-pkce.js");
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
test("Google OAuth generates cryptographically secure S256 PKCE challenge",async()=>{
 const verifier=auth.verifier(webcrypto);
 assert.match(verifier,/^[A-Za-z0-9_-]{43}$/);
 const challenge=await auth.challenge(webcrypto,verifier);
 assert.match(challenge,/^[A-Za-z0-9_-]{43}$/);
 const url=new URL(auth.authorizeUrl("https://abc123.supabase.co/","https://getacourt.com/",challenge));
 assert.equal(url.origin,"https://abc123.supabase.co");
 assert.equal(url.pathname,"/auth/v1/authorize");
 assert.equal(url.searchParams.get("provider"),"google");
 assert.equal(url.searchParams.get("code_challenge_method"),"s256");
 assert.equal(url.searchParams.get("code_challenge"),challenge);
 assert.equal(url.searchParams.get("redirect_to"),"https://getacourt.com/");
});
test("Only valid Google OAuth origins, redirect and challenge accepted",async()=>{
 const ch=await auth.challenge(webcrypto,auth.verifier(webcrypto));
 for(const base of ["http://abc123.supabase.co/","https://evil.example/","https://abc123.supabase.co.evil.com/"]){
  assert.throws(()=>auth.authorizeUrl(base,"https://getacourt.com/",ch));
 }
 assert.throws(()=>auth.authorizeUrl("https://abc123.supabase.co/","http://getacourt.com/",ch));
 assert.throws(()=>auth.authorizeUrl("https://abc123.supabase.co/","https://getacourt.com/","bad"));
});
test("PKCE verifier can be consumed only once, expires after five minutes",()=>{
 const store=memory(),v=auth.verifier(webcrypto),url="https://getacourt.com/";
 auth.savePending(store,v,url,1000);
 assert.equal(auth.takePending(store,2000).codeVerifier,v);
 assert.equal(auth.takePending(store,2000),null);
 auth.savePending(store,v,url,1000);
 assert.equal(auth.takePending(store,1000+300001),null);
});
test("Callback strips authorization code and error before network activity",()=>{
 const result=auth.captureCallback("https://getacourt.com/?code=1234&x=1");
 assert.equal(result.code,"1234");
 assert.equal(result.cleanUrl,"/?x=1");
 assert.equal(result.originPath,"https://getacourt.com/");
 assert.equal(auth.captureCallback("https://getacourt.com/?a=1"),null);
});
test("Get interface and entrypoint keep Google sign-in gated",()=>{
 const html=require("node:fs").readFileSync("getacourt/index.html","utf8");
 const js=require("node:fs").readFileSync("getacourt/assets/app.js","utf8");
 assert.match(html,/id="googleSignInButton"[^>]+hidden/);
 assert.match(html,/assets\/auth-pkce\.js/);
 assert.match(js,/googleSignInEnabled/);
 assert.match(js,/startGoogleSignIn/);
 assert.match(js,/completeGoogleSignIn/);
 assert.match(js,/history\.replaceState\(null,"",googleCallback\.cleanUrl\)/);
});

test("OAuth callback page forbids Referer propagation before loading any assets",()=>{
 const html=require("node:fs").readFileSync("getacourt/index.html","utf8");
 const meta=html.indexOf('<meta name="referrer" content="no-referrer"');
 const css=html.indexOf('<link rel="stylesheet"');
 const script=html.indexOf('<script');
 assert.ok(meta>=0&&css>meta&&script>meta);
});

test("Implicit URL access/refresh tokens cannot initiate a Get player session",()=>{
 const js=require("node:fs").readFileSync("getacourt/assets/app.js","utf8");
 assert.match(js,/rejectImplicitAuthHash\(\)/);
 const start=js.indexOf("  function rejectImplicitAuthHash(){");
 const end=js.indexOf("  async function completeGoogleSignIn(){",start);
 assert.ok(start>=0&&end>start);
 const source=js.slice(start,end);
 assert.match(source,/hash\.has\("access_token"\)/);
 assert.match(source,/hash\.has\("refresh_token"\)/);
 assert.match(source,/history\.replaceState\(null,"",location\.pathname\+location\.search\)/);
 assert.doesNotMatch(source,/saveSession\(|localStorage\.setItem\(/);
 assert.doesNotMatch(js,/function consumeAuthHash\(/);
});
