import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

// Real GetAcourt source scope test, with no network or user data.
const js=readFileSync("getacourt/assets/app.js","utf8");
const saveStart=js.indexOf("  function clearPrivateViews(){");
const saveEnd=js.indexOf("  function jwtPayload(token){",saveStart);
assert.ok(saveStart>=0&&saveEnd>saveStart,"Client identity and view lifecycle must exist");

function client(){
  const db=new Map();
  let replaced=0,closed=0,refresh=0;
  const dialog=()=>({open:true,close(){this.open=false;closed++}});
  const lists=()=>({replaceChildren(){replaced++}});
  const state={session:null,profile:{full_name:"Old person"},routines:[{id:"one"}],watchNotifications:[{id:"two"}],authEpoch:0};
  const elements={bookingsList:lists(),watchesList:lists(),watchAlerts:lists(),
    bookingsDialog:dialog(),watchesDialog:dialog(),profileDialog:dialog(),watchDialog:dialog()};
  const payload=token=>token?{sub:token.split(":")[0]}:{};
  const ctx={
    localStorage:{getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k)},
    state,el:elements,Date,
    jwtPayload:payload,
    updateAuthUI:()=>{refresh++},
    loadSession:()=>{let s=db.get("gac.session");return s?JSON.parse(s):null;}
  };
  vm.runInNewContext(js.slice(saveStart,saveEnd)+
    "\nthis.saveSession=saveSession;this.syncExternalSession=syncExternalSession;",ctx);
  return {state,ctx,db,elements,get replaced(){return replaced},get closed(){return closed},get refresh(){return refresh}};
}
test("Local sign out instantly removes private bookings, profile and watch alerts",()=>{
 const c=client();
 c.ctx.saveSession({access_token:"uid1:jwt",refresh_token:"ref1",expires_in:3600});
 c.state.profile={full_name:"Secret"};
 c.state.routines=[{id:1}];c.state.watchNotifications=[{id:2}];
 const oldEpoch=c.state.authEpoch;
 c.ctx.saveSession(null);
 assert.equal(c.state.session,null);
 assert.equal(c.state.profile,null);
 assert.equal(c.state.routines.length,0);
 assert.equal(c.state.watchNotifications.length,0);
 assert.ok(c.replaced>=3);
 assert.equal(c.closed,4);
 assert.ok(c.state.authEpoch>oldEpoch);
});
test("Logout in another tab invalidates current tab and clears sensitive dialogs",()=>{
 const c=client();
 c.ctx.saveSession({access_token:"uid1:jwt",refresh_token:"ref1",expires_in:3600});
 c.state.profile={full_name:"private"};
 c.db.delete("gac.session");
 c.ctx.syncExternalSession();
 assert.equal(c.state.session,null);
 assert.equal(c.state.profile,null);
 assert.ok(c.replaced>=3);
});
test("Changing account clears previous account profile before displaying new one",()=>{
 const c=client();
 c.ctx.saveSession({access_token:"uid1:jwt",refresh_token:"ref1",expires_in:3600});
 c.state.profile={full_name:"person-1"};
 c.ctx.saveSession({access_token:"uid2:jwt",refresh_token:"ref2",expires_in:3600});
 assert.equal(c.state.profile,null);
 assert.equal(c.state.session.accessToken,"uid2:jwt");
});
test("Response handlers explicitly guard stale auth epochs",()=>{
 assert.match(js,/const epoch=state\.authEpoch;[\s\S]*?const bookings=\(await api\("\/api\/gac\/bookings"/);
 assert.match(js,/const data=await api\("\/api\/gac\/player-profile"/);
 assert.match(js,/if\(epoch!==state\.authEpoch \|\| !state\.session\)return null/);
 assert.match(js,/if\(epoch!==state\.authEpoch \|\| !state\.session\)return/);
 assert.match(js,/window\.addEventListener\("storage"/);
 assert.match(js,/window\.addEventListener\("pageshow"/);
 assert.match(js,/auth && res\.status===401/);
});

test("Same-user refresh rotation preserves epoch and private read contexts",()=>{
 const c=client();
 c.ctx.saveSession({access_token:"uid1:jwt",refresh_token:"ref1",expires_in:3600});
 c.state.profile={full_name:"Still same player"};
 const epoch=c.state.authEpoch,cleared=c.replaced;
 c.ctx.saveSession({access_token:"uid1:updatedjwt",refresh_token:"ref2",expires_in:3600});
 assert.equal(c.state.authEpoch,epoch);
 assert.equal(c.state.profile.full_name,"Still same player");
 assert.equal(c.replaced,cleared);
 c.ctx.syncExternalSession();
 assert.equal(c.state.authEpoch,epoch);
});

test("Sign out clears client session before any awaited revoke network request",()=>{
 const begin=js.indexOf("  async function signOut(){");
 const end=js.indexOf("  function openAuth(",begin);
 assert.ok(begin>=0&&end>begin,"Signout implementation found");
 const body=js.slice(begin,end);
 assert.ok(body.indexOf("saveSession(null);")>=0);
 assert.ok(body.indexOf("saveSession(null);")<body.indexOf('await api("/api/gac/auth/sign-out"'),"Local data purged before revocation");
 assert.match(body,/remote session revocation is unconfirmed/);
});
test("Profile, routine, booking mutations drop stale responses after sign-out",()=>{
 const scopes=[
  ["saveProfile","async function saveProfile(e){","async function signOut(){"],
  ["saveWatch","async function saveWatch(e){","function renderWatches(){"],
  ["setRoutineStatus","async function setRoutineStatus(","async function loadWatches("],
  ["cancelBooking","async function cancelBooking(id){","async function loadProfile("],
  ["openProfile","async function openProfile(){","async function saveProfile("]
 ];
 for(const [name,start,end] of scopes){
  const a=js.indexOf(start),b=js.indexOf(end,a);
  assert.ok(a>=0&&b>a,name);
  const code=js.slice(a,b);
  assert.match(code,/const epoch=state\.authEpoch;/,name);
  assert.match(code,/epoch!==state\.authEpoch \|\| !state\.session/,name);
 }
});
