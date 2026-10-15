import { body, coreJson, errorResponse, requireAuth, response } from "../lib/platform.mts";

export default async (req) => {
  if (!["GET","POST","PATCH"].includes(req.method)) return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    if (req.method === "GET") {
      return response(await coreJson("/api/play-routines", { method:"GET" }, req));
    }
    const input = await body(req);
    if (req.method === "PATCH") {
      const routineId = String(input.routineId || "").trim();
      if (!routineId) return response({ error:"ROUTINE_REQUIRED", message:"routineId is required." }, 400);
      return response(await coreJson("/api/play-routines/" + encodeURIComponent(routineId), {
        method:"PATCH",
        body:JSON.stringify({ status:input.status }),
      }, req));
    }
    return response(await coreJson("/api/play-routines", {
      method:"POST",
      body:JSON.stringify({
        sport:input.sport,
        days_of_week:Array.isArray(input.daysOfWeek) ? input.daysOfWeek : [],
        window_start:input.windowStart,
        window_end:input.windowEnd,
        duration_minutes:Number(input.durationMinutes || 90),
        location_label:input.locationLabel || "",
        center_lat:input.centerLat == null ? null : Number(input.centerLat),
        center_lon:input.centerLon == null ? null : Number(input.centerLon),
        radius_km:Number(input.radiusKm || 10),
        max_price_minor:input.maxPriceMinor == null ? null : Number(input.maxPriceMinor),
        currency:input.currency || "EUR",
        indoor_preference:input.indoorPreference || "all",
        preferred_venue_ids:Array.isArray(input.preferredVenueIds) ? input.preferredVenueIds : [],
        excluded_venue_ids:Array.isArray(input.excludedVenueIds) ? input.excludedVenueIds : [],
        timezone:input.timezone || "Europe/Lisbon",
        start_date:input.startDate || null,
        valid_until:input.validUntil || null,
      }),
    }, req), 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/play-routines" };
