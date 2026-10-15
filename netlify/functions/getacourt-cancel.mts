import { body, coreJson, errorResponse, requireAuth, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    const input = await body(req);
    if (!input.bookingId) return response({ error:"INVALID_BOOKING", message:"bookingId is required" }, 400);
    const data = await coreJson("/api/bookings/" + encodeURIComponent(input.bookingId) + "/cancel", {
      method:"POST",
      body:JSON.stringify({}),
    }, req);
    return response(data);
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/cancel" };
