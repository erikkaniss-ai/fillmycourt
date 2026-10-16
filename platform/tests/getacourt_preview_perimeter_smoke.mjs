// QA-PREVIEW-02: read-only external acceptance for a GetACourt Deploy Preview.
// No API credentials or Netlify project-admin access. Only fixed first-party hosts.
// NOT a test of authenticated content, Google OAuth, map tiles or booking.
import assert from "node:assert/strict";
import {setTimeout as sleep} from "node:timers/promises";

const raw=process.env.GAC_PREVIEW_PR_NUMBER||"";
assert.match(raw,/^[1-9][0-9]{0,5}$/,"A validated PR number is required");
const preview="https://deploy-preview-"+raw+"--getacourt-preview.netlify.app/";
const production="https://getacourt.com/";
async function status(url){
 const response=await fetch(url,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(15000),
  headers:{"cache-control":"no-cache"}});
 // Body is NOT read, stored, logged or interpreted. No user token/cookie.
 await response.body?.cancel();
 return response.status;
}
let last=null;
for(let attempt=1;attempt<=8;attempt++){
 try{
  last=await status(preview);
  if(last===401)break;
  // Before a deploy is built the preview may be 404; a live 200 is NOT
  // an acceptable transient state and must immediately fail closed.
  if(last===200)throw new Error("Unprotected Deploy Preview returned HTTP 200");
  if(attempt===8)throw new Error("Preview must return HTTP 401; got "+last);
 }catch(error){
  if(/Unprotected Deploy Preview/.test(String(error)))throw error;
  if(attempt===8)throw error;
 }
 await sleep(8000);
}
assert.equal(last,401,"Anonymous requests must not be able to read Get RC");
const productionStatus=await status(production);
assert.equal(productionStatus,200,"Public getacourt.com must remain publicly available");
console.log("GET RC preview perimeter: anonymous HTTP 401, production HTTP 200.");
console.log("No preview credentials, user accounts, booking or external provider actions.");
