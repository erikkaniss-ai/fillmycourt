import { body, coreJson, errorResponse, idempotency, requireAuth, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    const input = await body(req);
    if (!input.holdId) return response({ error:"INVALID_BOOKING", message:"holdId is required" }, 400);
    const data = await coreJson("/api/holds/" + encodeURIComponent(input.holdId) + "/confirm", {
      method:"POST",
      headers:{ "idempotency-key": idempotency(req) },
      body:JSON.stringify({ participants:Number(input.participants || 1), accept_policy:Boolean(input.acceptPolicy) }),
    }, req);
    return response({
      bookingId:data.id,
      reference:String(data.id || "").slice(0,8).toUpperCase(),
      status:data.status,
      startsAt:data.starts_at,
      endsAt:data.ends_at,
      currency:data.currency,
      grossAmountMinor:data.gross_amount_minor,
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/book" };
