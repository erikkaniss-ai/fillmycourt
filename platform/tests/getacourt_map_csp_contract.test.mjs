import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync("getacourt/index.html","utf8");
const toml=readFileSync("getacourt/netlify.toml","utf8");
const app=readFileSync("getacourt/assets/app.js","utf8");
const policy=toml.match(/Content-Security-Policy = "([^"]+)"/)?.[1];
const rule=name=>policy?.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+" "));

test("Map's external Leaflet scripts and styles are permitted by strict CDN CSP",()=>{
 assert.ok(policy,"GetAcourt headers must declare CSP");
 assert.match(rule("script-src"),/https:\/\/unpkg\.com/);
 assert.match(rule("style-src"),/https:\/\/unpkg\.com/);
 assert.doesNotMatch(rule("script-src"),/unsafe-inline/);
 assert.match(rule("connect-src"),/^connect-src 'self'$/);
 assert.match(rule("frame-ancestors"),/^frame-ancestors 'none'$/);
 assert.match(toml,/geolocation=\(self\)/);
});
test("External Leaflet CSS and JS use official pinned SHA-256 integrity metadata",()=>{
 assert.match(html,/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css" integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY=" crossorigin="anonymous"/);
 assert.match(html,/<script src="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo=" crossorigin="anonymous" defer>/);
 assert.ok(html.indexOf("leaflet.js")<html.indexOf("assets/app.js"),"Leaflet initialized before GetAcourt app");
});
test("Map fallback returns the player to the list if Leaflet is unavailable",()=>{
 const begin=app.indexOf("  function renderMap(){");
 const end=app.indexOf("  function renderQuickPicks(",begin);
 assert.ok(begin>0&&end>begin);
 const calls=[];
 const state={view:"map"};
 const el={resultsMap:{},grid:{}};
 const ctx={
  window:{L:null},state,el,
  updateView:()=>calls.push("list"),
  toast:m=>calls.push(m),
  sortedVenues:()=>{throw Error("Map library absent, must not reach inventory")}
 };
 vm.runInNewContext(app.slice(begin,end)+"\nthis.renderMap=renderMap;",ctx);
 ctx.renderMap();
 assert.equal(state.view,"list");
 assert.equal(calls[0],"list");
 assert.match(calls[1],/Map is temporarily unavailable/);
});
