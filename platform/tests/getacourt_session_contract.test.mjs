import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Execute the real accessToken function under a synthetic client environment;
// no account, provider API, credentials, payments or network calls.
const source=fs.readFileSync("getacourt/assets/app.js","utf8");
const start=source.indexOf("  let refreshInFlight=null;");
const end=source.indexOf("  function updateAuthUI(){",start);
assert.ok(start>=0&&end>start,"Actual refresh implementation must be present");
const implementation=source.slice(start,end);

function harness({fail=false}={}){
 let calls=0,finish,session={accessToken:"old.jwt",refreshToken:"old.refresh",expiresAt:0};
 const ctx={
   Date,
   state:{get session(){return session}},
   api:async(path,opts,auth)=>{
     assert.equal(path,"/api/gac/auth/refresh");
     assert.equal(auth,false);
     assert.equal(JSON.parse(opts.body).refreshToken,"old.refresh");
     calls++;
     if(fail)throw Error("no refresh");
     return await new Promise(resolve=>{finish=()=>resolve({
       access_token:"new.jwt",refresh_token:"new.refresh",expires_in:3600
     });});
   },
   saveSession:value=>{
     if(value==null){session=null;return;}
     session={accessToken:value.access_token,refreshToken:value.refresh_token,expiresAt:Date.now()+3600000};
   },
 };
 vm.runInNewContext(implementation+"\nthis.accessToken=accessToken;",ctx);
 return {ctx,get calls(){return calls},get finish(){return finish},get session(){return session},signout(){session=null}};
}
test("Refresh is single-flight for simultaneous Get profile/bookings requests",async()=>{
 const h=harness();
 const first=h.ctx.accessToken(),second=h.ctx.accessToken();
 assert.equal(h.calls,1);
 h.finish();
 const results=await Promise.all([first,second]);
 assert.deepEqual(results,["new.jwt","new.jwt"]);
 assert.equal(h.calls,1);
 assert.equal(h.session.refreshToken,"new.refresh");
});
test("Concurrent sign out cannot resurrect session after refresh completes",async()=>{
 const h=harness(),pending=h.ctx.accessToken();
 assert.equal(h.calls,1);
 h.signout();
 h.finish();
 assert.equal(await pending,null);
 assert.equal(h.session,null);
});
test("Rejected refresh invalidates stale Get client session",async()=>{
 const h=harness({fail:true});
 assert.equal(await h.ctx.accessToken(),null);
 assert.equal(h.session,null);
 assert.equal(h.calls,1);
});
