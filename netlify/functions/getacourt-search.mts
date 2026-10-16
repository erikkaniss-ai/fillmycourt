import { coreJson, errorResponse, response } from "../lib/platform.mts";

function areaFrom(address) {
  if (!address) return "";
  if (typeof address === "string") return address;
  return address.city || address.locality || address.town || address.municipality || address.region || "";
}

async function fetchInventory({ sport, location, date, from, to, lat, lon, radiusKm }) {
  const durations = [60, 90];
  return Promise.all(durations.map(duration => {
    const qs = new URLSearchParams({
      sport, location, date, time: from, end_time: to, duration: String(duration), indoor: "all"
    });
    if (lat != null && lon != null) {
      qs.set("lat", String(lat));
      qs.set("lon", String(lon));
      qs.set("radius_km", String(radiusKm));
    }
    return coreJson("/api/availability?" + qs.toString());
  }));
}

// Approved venue IDs are a public-catalog release gate, NOT booking authorization.
// An absent or invalid allowlist fails closed: no fixture or unapproved real
// club may appear as verified availability in GetACourt.
const CASCAIS_STAGING_FIXTURE_ID = "d6dbceca-3cca-4053-bcb7-5491a9225cb0";
function approvedVenueIds() {
  const raw = String(globalThis.Netlify?.env?.get("GETACOURT_APPROVED_VENUE_IDS") || "");
  return new Set(raw.split(",").map(s => s.trim().toLowerCase())
    .filter(s => /^[a-z0-9-]{1,80}$/.test(s)).slice(0, 200));
}
function isKnownStagingFixture(slot) {
  const address = slot.address;
  return String(slot.venue_id || "").toLowerCase() === CASCAIS_STAGING_FIXTURE_ID ||
    slot.venue_name === "GetACourt Cascais Test Venue" ||
    (address && typeof address === "object" && address.label === "Cascais staging inventory");
}

function normalize(payloads, approved) {
  const byVenue = new Map();
  const seen = new Set();
  for (const payload of payloads) {
    for (const slot of payload.slots || []) {
      if (!approved.has(String(slot.venue_id || "").toLowerCase()) ||
          isKnownStagingFixture(slot)) continue;
      const key = [slot.id, slot.starts_at, slot.duration_minutes].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const venueId = slot.venue_id;
      if (!byVenue.has(venueId)) {
        byVenue.set(venueId, {
          id: venueId,
          name: slot.venue_name,
          area: areaFrom(slot.address),
          distanceKm: slot.distance_km == null ? null : Number(slot.distance_km),
          indoor: null,
          tags: [],
          sport: slot.sport,
          source: "FillMyCourt booking core",
          slots: [],
        });
      }
      const venue = byVenue.get(venueId);
      if (slot.distance_km != null) venue.distanceKm = Number(slot.distance_km);
      if (slot.venue_lat != null) venue.lat = Number(slot.venue_lat);
      if (slot.venue_lon != null) venue.lon = Number(slot.venue_lon);
      const courtTag = slot.name || "Court";
      if (!venue.tags.includes(courtTag)) venue.tags.push(courtTag);
      const start = new Date(slot.starts_at);
      venue.slots.push({
        id: key,
        courtId: slot.id,
        courtName: slot.name,
        venueId,
        date: start.toLocaleDateString("en-CA", { timeZone: slot.timezone }),
        time: start.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", hour12:false, timeZone: slot.timezone }),
        startsAt: slot.starts_at,
        price: Number(slot.amount_minor || 0) / 100,
        duration: Number(slot.duration_minutes || 0),
        currency: slot.currency || "EUR",
        status: "available",
        indoor: Boolean(slot.indoor),
        provider: "fillmycourt",
      });
    }
  }

  return Array.from(byVenue.values()).map(v => {
    const surface = new Set((v.slots || []).map(s => s.indoor === true ? "indoor" : s.indoor === false ? "outdoor" : "unknown"));
    const courtType = surface.has("indoor") && surface.has("outdoor")
      ? "Indoor + outdoor"
      : surface.has("indoor") ? "Indoor"
      : surface.has("outdoor") ? "Outdoor"
      : "Court";
    return {
      ...v,
      tags: [courtType, ...v.tags].slice(0,4),
      slots: v.slots.sort((a,b) => a.startsAt.localeCompare(b.startsAt) || a.duration-b.duration),
    };
  }).sort((a,b) => {
    if (a.distanceKm == null && b.distanceKm == null) return a.name.localeCompare(b.name);
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  const url = new URL(req.url);
  const sport = (url.searchParams.get("sport") || "padel").toLowerCase();
  const location = url.searchParams.get("location") || "";
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0,10);
  const from = url.searchParams.get("from") || "00:00";
  const to = url.searchParams.get("to") || "23:59";
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");
  // Never coerce empty coordinates to 0,0 or silently discard a malformed
  // geolocation. Explicit location data is an all-or-nothing contract.
  const hasLat = latRaw != null && latRaw.trim() !== "";
  const hasLon = lonRaw != null && lonRaw.trim() !== "";
  if ((latRaw != null && !hasLat) || (lonRaw != null && !hasLon) || hasLat !== hasLon) {
    return response({ error:"LOCATION_COORDS", message:"Provide both valid latitude and longitude." }, 422);
  }
  const lat = hasLat ? Number(latRaw) : null;
  const lon = hasLon ? Number(lonRaw) : null;
  const hasCoords = hasLat && hasLon;
  if (hasCoords && (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180)) {
    return response({ error:"LOCATION_COORDS", message:"Latitude/longitude are out of range." }, 422);
  }

  try {
    const approved = approvedVenueIds();
    // No vetted venue => no Core query, no inferred live inventory and no
    // discovery fallback to staging fixtures.
    if (!approved.size) return response({
      mode: "platform",
      query: { sport, location, date, from, to, lat: hasCoords ? lat : null, lon: hasCoords ? lon : null },
      search: { radiusUsedKm: null, attemptedRadii: [], expanded: false },
      venues: []
    });
    let venues = [];
    let radiusUsedKm = null;
    const attemptedRadii = [];
    if (hasCoords) {
      const radii = [5, 10, 25, 50];
      for (const radiusKm of radii) {
        attemptedRadii.push(radiusKm);
        venues = normalize(await fetchInventory({ sport,location,date,from,to,lat,lon,radiusKm }), approved);
        const availableSlots = venues.reduce((n,v) => n + (v.slots || []).length, 0);
        radiusUsedKm = radiusKm;
        if (venues.length >= 3 || availableSlots >= 8) break;
      }
    } else {
      venues = normalize(await fetchInventory({ sport,location,date,from,to,lat:null,lon:null,radiusKm:25 }), approved);
    }

    return response({
      mode:"platform",
      query:{ sport,location,date,from,to,lat:hasCoords?lat:null,lon:hasCoords?lon:null },
      search:{ radiusUsedKm, attemptedRadii, expanded: attemptedRadii.length > 1 },
      venues
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/search" };
