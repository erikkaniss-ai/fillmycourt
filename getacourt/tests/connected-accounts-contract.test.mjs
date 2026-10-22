// Synthetic connected-account UX guard, no browser/runtime service.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const supply=require("../assets/provider-supply-contract.js");
const html=readFileSync("getacourt/qa/connected-accounts-demo.html","utf8");
const source=readFileSync("getacourt/qa/connected-accounts-demo.js","utf8");

test("Fixture page is isolated from live app with explicit refusal to claim connected rights",()=>{
  assert.match(html,/LOCAL FIXTURE · NOT CONNECTED/);
  assert.match(html,/not active GetACourt integrations/);
  assert.match(html,/provider-supply-contract\.js/);
  assert.match(html,/connected-accounts-demo\.js/);
  assert.match(html,/content="noindex,nofollow,noarchive"/);
  assert.match(html,/connect-src 'none'/);
  assert.match(html,/form-action 'none'/);
  assert.doesNotMatch(readFileSync("getacourt/index.html","utf8"),/connected-accounts-demo/);
  assert.doesNotMatch(readFileSync("getacourt/assets/app.js","utf8"),/connected-accounts-demo/);
});

test("Demo source calls only pure fail-closed supply contract, never any remote capability",()=>{
  assert.match(source,/supply\.planExternalAccount/);
  assert.match(source,/supply\.planProviderSupply/);
  assert.match(source,/supply\.searchAvailableSlots/);
  assert.match(source,/state\.consent="withdrawn"/);
  assert.match(source,/state\.consent="not_requested"/);
  assert.match(source,/NOT connected/);
  assert.match(source,/Provider HTTP requests:/);
  for(const re of [
    /\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/sendBeacon/,
    /\blocalStorage\b/,/\bsessionStorage\b/,/\bindexedDB\b/,
    /\bdocument\.cookie\b/,/\bnavigator\.credentials\b/,
    /\bpostMessage\s*\(/,/\/auth\/v1\//,/\/api\//,/https?:\/\//
  ])assert.doesNotMatch(source,re,"Only local UI and pure contract permitted: "+re);
});

test("No provider can be mistaken as live or qualified based on fixture selection",()=>{
  for(const provider of supply.registry()){
    const c=supply.planExternalAccount({
      provider:provider.id,user_ref:"fixture-player-01",consent_ref:"fixture-consent-01",
      consented_at:"2026-10-22T00:00:00Z"
    });
    const result=supply.searchAvailableSlots(c,{
      requester_ref:"fixture-player-01",request_ref:"fixture-query-01",
      starts_at:"2026-10-22T01:00:00Z",ends_at:"2026-10-22T02:00:00Z",
      now:"2026-10-22T00:00:00Z"
    });
    assert.equal(result.provider_requests,0);
    assert.equal(result.status,"unknown");
    assert.equal(result.can_display_available_slots,false);
    assert.equal(result.authoritative,false);
    assert.deepEqual(result.slots,[]);
  }
});

test("Core Get authorization, anti-cache and CI audit guards remain present",()=>{
  const ci=readFileSync(".github/workflows/platform-ci.yml","utf8");
  assert.match(ci,/run: node getacourt\/tests\/connected-accounts-browser.mjs/);
  assert.match(ci,/node --test getacourt\/tests\/connected-accounts-contract\.test\.mjs/);
  assert.match(ci,/getacourt\/tests\/browser-accessibility\.mjs/);
  assert.match(ci,/getacourt\/offline-safety\/test\/browser-offline\.mjs/);
  assert.match(ci,/pytest -q platform\/tests/);
  assert.doesNotMatch(readFileSync("getacourt/index.html","utf8"),/provider-supply-contract\.js/);
});
