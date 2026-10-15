// End-to-end NETLIFY-FUNCTION ↔ Core CONTRACT regression, with a fake Core.
// No real network, account access, bookings, payments, messages, or data changes.
import test from "node:test";
import assert from "node:assert/strict";

import searchHandler from "../../netlify/functions/getacourt-search.mts";
import holdHandler from "../../netlify/functions/getacourt-hold.mts";
import confirmHandler from "../../netlify/functions/getacourt-book.mts";
import routinesHandler from "../../netlify/functions/getacourt-play-routines.mts";
import evaluateHandler from "../../netlify/functions/getacourt-play-routine-evaluate.mts";
import profileHandler from "../../netlify/functions/getacourt-player-profile.mts";
import notificationsHandler from "../../netlify/functions/getacourt-demand-notifications.mts";
import configHandler from "../../netlify/functions/getacourt-platform-config.mts";
import bookingsHandler from "../../netlify/functions/getacourt-bookings.mts";

const ORIGIN = "https://getacourt.test";
const CORE = "https://core.fixture.test";
const path = (uri, method="GET", data=undefined, auth=null) =>
  new Request(ORIGIN + uri, {
    method,
    ...(auth ? { headers: { Authorization: auth, "Idempotency-Key": "fixture-key" } } : {}),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });

async function harness(handler, fakeCore, req) {
  const previousFetch = globalThis.fetch;
  const previousNetlify = globalThis.Netlify;
  const calls = [];
  globalThis.Netlify = {env: {get: key => ({
    GETACOURT_CORE_API_BASE: CORE,
    GETACOURT_EMAIL_SIGNIN_ENABLED: "false",
    GETACOURT_SUPABASE_URL: "https://fixture.supabase.co",
    GETACOURT_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  })[key] ?? null}};
  globalThis.fetch = async (url, init={}) => {
    assert.ok(String(url).startsWith(CORE + "/api/"), "Only synthetic Core may be called");
    calls.push({url:String(url), init});
    const outcome = await fakeCore(new URL(url), init);
    if (outcome instanceof Response) return outcome;
    return Response.json(outcome.body ?? {}, {status:outcome.status ?? 200});
  };
  try {
    const result=await handler(req);
    return {status:result.status, body:await result.json(), calls,
      cacheControl:result.headers.get("cache-control")};
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Netlify = previousNetlify;
  }
}

const SLOT = {
  id:"court-1", venue_id:"venue-1",venue_name:"CI Cascais",name:"Indoor CI",
  starts_at:"2026-10-19T18:00:00+01:00",timezone:"Europe/Lisbon",
  duration_minutes:90,amount_minor:3200,currency:"EUR",indoor:true,
  sport:"padel",address:{city:"Cascais"},venue_lat:38.7,venue_lon:-9.42,
};

test("Get discovery preserves Core slot identity, price, timezone and no-store", async () => {
  const r=await harness(searchHandler, (url) => {
    assert.equal(url.pathname,"/api/availability");
    return {body:{slots:[SLOT]}};
  },path("/api/gac/search?sport=padel&location=Cascais&date=2026-10-19&from=17:00&to=21:00"));
  assert.equal(r.status,200);
  assert.equal(r.cacheControl,"no-store");
  assert.equal(r.calls.length,2,"one Core search per 60/90-minute duration");
  assert.equal(r.body.venues.length,1,"duplicate overlapping slot results deduplicated");
  const venue=r.body.venues[0],slot=venue.slots[0];
  assert.equal(venue.name,"CI Cascais");
  assert.equal(slot.courtId,"court-1");
  assert.equal(slot.time,"18:00");
  assert.equal(slot.date,"2026-10-19");
  assert.equal(slot.currency,"EUR");
  assert.equal(slot.price,32);
  assert.equal(slot.provider,"fillmycourt");
});

test("Get geosearch expands radius adaptively and stops once enough slots", async () => {
  const seen=[];
  const r=await harness(searchHandler,(url) => {
    const radius=Number(url.searchParams.get("radius_km"));
    seen.push(radius);
    const items=radius<10 ? [SLOT] : Array.from({length:8},(_,i)=>({
      ...SLOT,id:"court-"+i,venue_id:"venue-"+i,venue_name:"CI Venue "+i,
    }));
    return {body:{slots:items}};
  },path("/api/gac/search?sport=padel&date=2026-10-19&from=17:00&to=21:00&lat=38.7&lon=-9.42"));
  assert.equal(r.status,200);
  assert.deepEqual(r.body.search.attemptedRadii,[5,10]);
  assert.equal(r.body.search.radiusUsedKm,10);
  assert.equal(r.body.search.expanded,true);
  assert.deepEqual(seen,[5,5,10,10]);
  assert.ok(r.body.venues.length>=3);
});

test("Get coordinates reject partial/blank/nonfinite/out-of-range without contacting Core", async () => {
  const invalid=[
    "?lat=&lon=","?lat=38.7","?lon=-9.42","?lat=38.7&lon=",
    "?lat=nan&lon=-9.42","?lat=91&lon=0","?lat=40&lon=-181",
  ];
  for(const suffix of invalid){
    const result=await harness(searchHandler,()=>{throw Error("Core must not be called")},
       path("/api/gac/search"+suffix));
    assert.equal(result.status,422,suffix);
    assert.equal(result.body.error,"LOCATION_COORDS");
    assert.equal(result.calls.length,0);
  }
});

test("All protected Get routes reject missing bearer without any Core call", async () => {
  const protectedCases=[
    [holdHandler,path("/api/gac/hold","POST",{courtId:"court-1",startsAt:SLOT.starts_at,duration:90})],
    [confirmHandler,path("/api/gac/book","POST",{holdId:"hold-1",acceptPolicy:true})],
    [routinesHandler,path("/api/gac/play-routines")],
    [routinesHandler,path("/api/gac/play-routines","POST",{sport:"padel"})],
    [evaluateHandler,path("/api/gac/play-routine-evaluate","POST",{routineId:"routine-1"})],
    [profileHandler,path("/api/gac/player-profile")],
    [notificationsHandler,path("/api/gac/demand-notifications")],
  ];
  for(const [handler,req] of protectedCases){
    const r=await harness(handler,()=>{throw Error("No Core call permitted")},req);
    assert.equal(r.status,401);
    assert.equal(r.body.error,"AUTH_REQUIRED");
    assert.equal(r.calls.length,0);
  }
});

test("Core booking gate 503 is propagated; no fabricated hold or booking", async () => {
  for(const [handler,req] of [
    [holdHandler,path("/api/gac/hold","POST",{courtId:"court-1",startsAt:SLOT.starts_at,duration:90},"Bearer player.fixture")],
    [confirmHandler,path("/api/gac/book","POST",{holdId:"hold-1",acceptPolicy:true},"Bearer player.fixture")],
  ]){
    const r=await harness(handler,(url,init)=>{
      assert.equal(init.headers.get("authorization"),"Bearer player.fixture");
      assert.equal(init.headers.get("idempotency-key"),"fixture-key");
      return {status:503,body:{error:"BOOKING_UNAVAILABLE",message:"Direct booking is not enabled."}};
    },req);
    assert.equal(r.status,503);
    assert.equal(r.body.error,"BOOKING_UNAVAILABLE");
    assert.equal(r.calls.length,1);
    assert.ok(!("bookingId" in r.body) && !("holdId" in r.body));
  }
});

test("Get routine and notifications preserve auth / map contract to Core", async () => {
  const req=path("/api/gac/play-routines","POST",{
    sport:"padel",daysOfWeek:[1,3],windowStart:"18:00",windowEnd:"21:00",
    durationMinutes:90,locationLabel:"Cascais",centerLat:38.7,centerLon:-9.42,
    radiusKm:10,maxPriceMinor:4000,currency:"EUR",
  },"Bearer player.fixture");
  const p=await harness(routinesHandler,async(url,init)=>{
    assert.equal(url.pathname,"/api/play-routines");
    assert.equal(init.headers.get("authorization"),"Bearer player.fixture");
    const body=JSON.parse(init.body);
    assert.deepEqual(body.days_of_week,[1,3]);
    assert.equal(body.max_price_minor,4000);
    assert.equal(body.center_lat,38.7);
    return {body:{id:"routine-1",status:"active"}};
  },req);
  assert.equal(p.status,201);
  const e=await harness(evaluateHandler,(url)=>{
    assert.equal(url.pathname,"/api/play-routines/routine-1/evaluate");
    return {body:{created:2,ready_matches:1}};
  },path("/api/gac/play-routine-evaluate","POST",{routineId:"routine-1"},"Bearer player.fixture"));
  assert.equal(e.status,200);
  const n=await harness(notificationsHandler,(url)=>{
    assert.equal(url.searchParams.get("limit"),"100","upper bound enforced");
    return {body:{items:[]}};
  },path("/api/gac/demand-notifications?limit=99999","GET",undefined,"Bearer player.fixture"));
  assert.equal(n.status,200);
});

test("Get public config truthfully mirrors Core booking OFF / payments OFF", async()=>{
  const r=await harness(configHandler,(url)=>{
    assert.equal(url.pathname,"/api/config");
    return {body:{booking_enabled:false,online_payments:false,auth:"supabase"}};
  },path("/api/gac/platform-config"));
  assert.equal(r.status,200);
  assert.equal(r.body.bookingEnabled,false);
  assert.equal(r.body.onlinePayments,false);
  assert.equal(r.body.emailSignInEnabled,false);
  assert.equal(r.cacheControl,"no-store");
});

test("Get booking history uses venue timezone in both summer and winter (DST)", async () => {
  for (const [instant,expected] of [
    ["2026-10-19T17:00:00Z","18:00"], // Portugal summer UTC+1
    ["2026-12-19T17:00:00Z","17:00"], // Portugal winter UTC+0
  ]) {
    const result=await harness(bookingsHandler,(url,init)=>{
      assert.equal(url.pathname,"/api/bookings");
      assert.equal(init.headers.get("authorization"),"Bearer player.fixture");
      return {body:{items:[{
        id:"booking-1",starts_at:instant,ends_at:new Date(Date.parse(instant)+90*60000).toISOString(),
        status:"confirmed",venue_name:"Cascais CI",venue_timezone:"Europe/Lisbon",
        currency:"EUR",gross_amount_minor:3200,source:"getacourt",
      }]}};
    },path("/api/gac/bookings","GET",undefined,"Bearer player.fixture"));
    assert.equal(result.status,200);
    assert.equal(result.body.bookings[0].slot.time,expected);
    assert.equal(result.body.bookings[0].slot.duration,90);
    assert.equal(result.body.bookings[0].venue.timezone,"Europe/Lisbon");
  }
});
