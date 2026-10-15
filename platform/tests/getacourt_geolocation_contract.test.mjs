import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const netlify=readFileSync("getacourt/netlify.toml","utf8");
const js=readFileSync("getacourt/assets/app.js","utf8");
const begin=js.indexOf("  function useCurrentLocation(){");
const end=js.indexOf("  function filteredSlots(",begin);
assert.ok(begin>=0&&end>begin,"Use real Near me source");

function client(){
 let pending,searchCount=0;
 const toasts=[];
 const state={geo:null,geoRequestEpoch:0};
 const el={nearMe:{disabled:false,textContent:"◎ Near me"},location:{value:"Cascais"},
   radiusNote:{textContent:""}};
 const ctx={state,el,navigator:{geolocation:{getCurrentPosition:(good,bad,options)=>{
    pending={good,bad,options};
 }}},toast:m=>toasts.push(m),search:()=>{searchCount++;},Number,Math};
 vm.runInNewContext(js.slice(begin,end)+"\nthis.useCurrentLocation=useCurrentLocation;",ctx);
 return {ctx,state,el,toasts,get pending(){return pending},get searches(){return searchCount}};
}

test("Netlify permits same-origin geolocation, still blocks camera and microphone",()=>{
 assert.match(netlify,/Permissions-Policy = "camera=\(\), microphone=\(\), geolocation=\(self\)"/);
 assert.doesNotMatch(netlify,/geolocation=\(\)/);
 assert.match(netlify,/X-Frame-Options = "DENY"/);
});
test("Near me is explicitly user initiated and sends accurate coordinates to search",()=>{
 const p=client();
 assert.equal(p.pending,undefined,"not requested automatically");
 p.ctx.useCurrentLocation();
 assert.equal(p.el.nearMe.disabled,true);
 assert.equal(p.pending.options.enableHighAccuracy,false);
 p.pending.good({coords:{latitude:38.698,longitude:-9.42}});
 assert.equal(p.searches,1);
 assert.equal(p.state.geo.lat,38.698);
 assert.equal(p.state.geo.lon,-9.42);
 assert.equal(p.el.location.value,"Current location");
 assert.equal(p.el.nearMe.disabled,false);
});
test("Location permission denied leaves typed search functional",()=>{
 const p=client();
 p.ctx.useCurrentLocation();
 p.pending.bad({code:1});
 assert.equal(p.state.geo,null);
 assert.equal(p.el.nearMe.disabled,false);
 assert.equal(p.searches,0);
 assert.ok(p.toasts.some(t=>t.includes("permission was denied")));
});
test("In-flight device position cannot overwrite a subsequently typed location",()=>{
 const p=client();
 p.ctx.useCurrentLocation();
 p.state.geoRequestEpoch++;
 p.el.location.value="Lisbon";
 p.pending.good({coords:{latitude:38.7,longitude:-9.4}});
 assert.equal(p.el.location.value,"Lisbon");
 assert.equal(p.state.geo,null);
 assert.equal(p.searches,0);
});
test("Invalid browser position must not be sent upstream",()=>{
 const p=client();
 p.ctx.useCurrentLocation();
 p.pending.good({coords:{latitude:200,longitude:-9.4}});
 assert.equal(p.state.geo,null);
 assert.equal(p.searches,0);
 assert.ok(p.toasts.some(t=>t.includes("invalid")));
});
test("Typed area input explicitly invalidates any pending near-me request",()=>{
 assert.match(js,/el\.location\.addEventListener\("input",\(\)=>\{/);
 assert.match(js,/state\.geoRequestEpoch\+\+; \/\/ discard any in-flight device position/);
 assert.match(js,/state\.geo=null/);
 assert.match(js,/el\.nearMe\.disabled=false/);
});
