import { body, coreJson, errorResponse, idempotency, requireAuth, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    const input = await body(req);
    if (!input.courtId || !input.startsAt || !input.duration) {
      return response({ error:"INVALID_HOLD", message:"courtId, startsAt and duration are required" }, 400);
    }
    const data = await coreJson("/api/holds", {
      method:"POST",
      headers:{ "idempotency-key": idempotency(req) },
      body:JSON.stringify({ court_id:input.courtId, starts_at:input.startsAt, duration:Number(input.duration) }),
    }, req);
    return response({
      holdId:data.id,
      startsAt:data.starts_at,
      endsAt:data.ends_at,
      expiresAt:data.expires_at,
      quote:data.quote,
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/hold" };
