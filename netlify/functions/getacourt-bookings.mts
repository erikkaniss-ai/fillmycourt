import { coreJson, errorResponse, requireAuth, response } from "../lib/platform.mts";

function localParts(value) {
  const d = new Date(value);
  return {
    date: d.toISOString().slice(0,10),
    time: d.toISOString().slice(11,16),
  };
}

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    const data = await coreJson("/api/bookings", { method:"GET" }, req);
    const bookings = (data.items || []).map(item => {
      const p = localParts(item.starts_at);
      const duration = Math.max(0, Math.round((new Date(item.ends_at) - new Date(item.starts_at)) / 60000));
      return {
        bookingId:item.id,
        reference:String(item.id || "").slice(0,8).toUpperCase(),
        status:item.status,
        venue:{ name:item.venue_name || "Court booking" },
        slot:{ date:p.date, time:p.time, duration },
        currency:item.currency,
        grossAmountMinor:item.gross_amount_minor,
        source:item.source,
      };
    });
    return response({ bookings });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/bookings" };
