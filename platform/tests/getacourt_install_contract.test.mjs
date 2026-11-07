import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
const m=JSON.parse(readFileSync("getacourt/manifest.webmanifest","utf8"));
const html=readFileSync("getacourt/index.html","utf8"),js=readFileSync("getacourt/assets/app.js","utf8");
test("Get is correctly installable under root or branch context",()=>{
  assert.equal(m.start_url,"./");assert.equal(m.scope,"./");assert.equal(m.display,"standalone");
  for(const size of [192,512]){
    const icon=m.icons.find(x=>x.sizes===size+"x"+size);
    assert.ok(icon && icon.type==="image/png");
    const filepath="getacourt/"+icon.src,bin=readFileSync(filepath);
    assert.ok(statSync(filepath).size>500);assert.equal(bin.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(bin.readUInt32BE(16),size);assert.equal(bin.readUInt32BE(20),size);
  }
});
test("Get install CTA is user-initiated, no offline false availability",()=>{
  assert.match(html,/id="installAppButton"/);assert.match(html,/id="installStatus" aria-live="polite"/);
  assert.match(html,/apple-touch-icon/);assert.match(js,/beforeinstallprompt/);assert.match(js,/appinstalled/);
  assert.match(js,/Add to Home Screen/);assert.doesNotMatch(js,/serviceWorker\.register/);
});
