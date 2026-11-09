import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../assets/styles.css",import.meta.url),"utf8");
const js=readFileSync(new URL("../assets/app.js",import.meta.url),"utf8");

function buttonTags(className){
  return [...html.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).filter(t=>
    new RegExp('class="[^"]*\\b'+className+'\\b').test(t));
}

test("mobile navigation retains account and booking controls",()=>{
  for(const id of ["myBookingsButton","myWatchesButton","authButton"]){
    assert.match(html,new RegExp('<button\\b[^>]*id="'+id+'"'));
  }
  const responsive=css.slice(css.indexOf("@media (max-width: 920px)"));
  assert.match(responsive,/\.nav\s*\{\s*display:\s*flex\b/);
  assert.match(responsive,/\.nav\s*\{[^}]*overflow-x:\s*auto\b/);
  assert.doesNotMatch(responsive,/\.nav\s*\{\s*display:\s*none\s*;?\s*\}/);
});

test("sport and filter groups expose their single selected state",()=>{
  for(const cls of ["sport-chip","filter-pill"]){
    const buttons=buttonTags(cls);
    assert.ok(buttons.length>=4,cls);
    assert.equal(buttons.filter(b=>/\baria-pressed="true"/.test(b)).length,1,cls);
    assert.equal(buttons.filter(b=>/\baria-pressed="false"/.test(b)).length,buttons.length-1,cls);
  }
  assert.match(js,/function syncToggleState\(/);
  assert.match(js,/setAttribute\("aria-pressed",String\(selected\)\)/);
  assert.match(js,/syncToggleState\("\.sport-chip",b\)/);
  assert.match(js,/syncToggleState\("\.filter-pill",b\)/);
});

test("async search exposes busy state and reliable live count",()=>{
  assert.match(html,/id="resultCount"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html,/id="resultsGrid"[^>]*aria-busy="false"/);
  assert.match(js,/function loading\(\)\s*\{[^}]*setAttribute\("aria-busy","true"\)/);
  assert.match(js,/finally\s*\{\s*if\(revision===state\.searchRevision\)el\.grid\.setAttribute\("aria-busy","false"\)/,
    "Only the current search may clear the busy announcement");
});

test("keyboard skip link and visible focus are available",()=>{
  assert.match(html,/<a class="skip-link" href="#discover">Skip to court search<\/a>/);
  assert.match(html,/id="discover" tabindex="-1"/);
  assert.match(css,/\.skip-link:focus-visible/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/\.field:focus-within/);
});

test("reduced motion and disabled staging controls remain accessible",()=>{
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^]*?\.skeleton\s*\{\s*animation:\s*none;/);
  assert.match(js,/matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(js,/behavior:reduceMotion\?"auto":"smooth"/);
  assert.match(html,/data-mode="preview"/);
  assert.match(js,/bookingEnabled:false/);
});

test("navigation changes are client-side only, not provider/API/auth modifications",()=>{
  assert.doesNotMatch(html,/CONTROL_TOWER_GITHUB_READ_TOKEN|Bearer\s+ghp_/);
  assert.doesNotMatch(js,/CONTROL_TOWER_GITHUB_READ_TOKEN/);
});
