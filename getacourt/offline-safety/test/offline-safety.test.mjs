import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const worker=require("../sw.js");
const source=readFileSync(new URL("../sw.js",import.meta.url),"utf8");
const offline=readFileSync(new URL("../offline.html",import.meta.url),"utf8");
const scope="http://127.0.0.1:4177/getacourt/offline-safety/";
const navigation=(path,opts={})=>({
  url:new URL(path,scope).href,
  mode:opts.mode??"navigate",
  method:opts.method??"GET"
});

test("fallback only applies to same-origin GET navigation in isolated scope",()=>{
  assert.equal(worker.shouldHandle(navigation("./missing"),scope),true);
  assert.equal(worker.shouldHandle(navigation("./demo"),scope),true);
  assert.equal(worker.shouldHandle(navigation("./demo",{method:"POST"}),scope),false);
  assert.equal(worker.shouldHandle(navigation("./demo",{mode:"cors"}),scope),false);
  assert.equal(worker.shouldHandle(navigation("https://other.example/getacourt/offline-safety/demo"),scope),false);
  assert.equal(worker.shouldHandle(navigation("/getacourt/player-profile"),scope),false);
});

test("deny all auth, token, provider, API, booking, payment and personal paths",()=>{
  const denied=[
    "./api/gac/search","./api/slots","./auth/callback","./oauth/callback",
    "./login","./logout","./session","./token","./player-profile",
    "./my-bookings","./book","./hold","./checkout","./payment",
    "./provider/playtomic","./account","./private/invoice",
    "./search?token=secret","./home?authorization=Bearer",
    "./%61pi/private","./%62ook","./%70ayment","./%73earch",
    "./misc?access_token=fake"
  ];
  for(const target of denied)assert.equal(worker.shouldHandle(navigation(target),scope),false,target);
});

test("cache namespace is isolated and no dynamic responses or credentials can be stored",()=>{
  assert.match(source,/gac-offline-shell-v1/);
  assert.doesNotMatch(source,/\bcaches\.match\(\s*event\.request\s*\)/);
  assert.doesNotMatch(source,/\bstore\.put\(\s*(?:event\.request|request)\s*,/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|authorization\s*:/i);
  assert.match(source,/credentials:\s*"omit"/);
  assert.match(source,/cache:\s*"no-store"/);
  assert.match(source,/request\.mode\s*!==\s*"navigate"/);
});

test("offline page is static, informative, and does not imply real availability or payments",()=>{
  assert.match(offline,/Offline/);
  assert.match(offline,/not available while offline/i);
  assert.match(offline,/No current court availability/i);
  assert.doesNotMatch(offline,/<script\b|<form\b|<input\b|<iframe\b/i);
  assert.doesNotMatch(offline,/\b(?:available court times|book now|confirm payment)\b/i);
});

test("no GetACourt production/staging service worker registration is introduced",()=>{
  const app=readFileSync(new URL("../../assets/app.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
  assert.doesNotMatch(app,/offline-safety\/sw\.js/);
  assert.doesNotMatch(html,/offline-safety\/sw\.js/);
});
