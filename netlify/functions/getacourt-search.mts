import { coreJson, errorResponse, response } from "../lib/platform.mts";

function areaFrom(address) {
  if (!address) return "";
  if (typeof address === "string") return address;
  return address.city || address.locality || address.town || address.municipality || address.region || "";
}

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  const url = new URL(req.url);
  const sport = (url.searchParams.get("sport") || "padel").toLowerCase();
  const location = url.searchParams.get("location") || "";
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0,10);
  const from = url.searchParams.get("from") || "00:00";
  const to = url.searchParams.get("to") || "23:59";

  try {
    const durations = [60, 90];
    const payloads = await Promise.all(durations.map(duration => {
      const qs = new URLSearchParams({
        sport, location, date, time: from, end_time: to, duration: String(duration), indoor: "all"
      });
      return coreJson("/api/availability?" + qs.toString());
    }));

    const byVenue = new Map();
    const seen = new Set();
    for (const payload of payloads) {
      for (const slot of payload.slots || []) {
        const key = [slot.id, slot.starts_at, slot.duration_minutes].join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        const venueId = slot.venue_id;
        if (!byVenue.has(venueId)) {
          byVenue.set(venueId, {
            id: venueId,
            name: slot.venue_name,
            area: areaFrom(slot.address),
            distanceKm: null,
            indoor: Boolean(slot.indoor),
            tags: [],
            sport: slot.sport,
            source: "FillMyCourt booking core",
            slots: [],
          });
        }
        const venue = byVenue.get(venueId);
        const courtTag = slot.name || "Court";
        if (!venue.tags.includes(courtTag)) venue.tags.push(courtTag);
        const start = new Date(slot.starts_at);
        venue.slots.push({
          id: key,
          courtId: slot.id,
          courtName: slot.name,
          venueId,
          date,
          time: start.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", hour12:false, timeZone: slot.timezone }),
          startsAt: slot.starts_at,
          price: Number(slot.amount_minor || 0) / 100,
          duration: Number(slot.duration_minutes || 0),
          currency: slot.currency || "EUR",
          status: "available",
          provider: "fillmycourt",
        });
      }
    }

    const venues = Array.from(byVenue.values()).map(v => ({
      ...v,
      tags: [v.indoor ? "Indoor" : "Outdoor", ...v.tags].slice(0,4),
      slots: v.slots.sort((a,b) => a.startsAt.localeCompare(b.startsAt) || a.duration-b.duration),
    }));
    return response({ mode:"platform", query:{ sport,location,date,from,to }, venues });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/search" };
