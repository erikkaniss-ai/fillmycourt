import { body, bookingStore, response, slotKey } from "../lib/getacourt.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  const input = await body(req);
  if (!input.slotId) return response({ error:"slotId is required" }, 400);

  const store = bookingStore();
  const key = slotKey(input.date, input.slotId);
  const booked = await store.get("slot-booking/" + key, { type:"json" });
  if (booked) return response({ error:"This slot is already booked" }, 409);

  const existing = await store.get("slot-hold/" + key, { type:"json" });
  if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
    return response({ error:"This slot is currently held by another player" }, 409);
  }

  const holdId = crypto.randomUUID();
  const hold = {
    holdId, slotId:input.slotId, date:input.date, provider:input.provider || "demo",
    slotKey:key, createdAt:new Date().toISOString(),
    expiresAt:new Date(Date.now() + 8 * 60 * 1000).toISOString()
  };
  await store.setJSON("hold/" + holdId, hold);
  await store.setJSON("slot-hold/" + key, hold);
  return response(hold, 201);
};

export const config = { path:"/api/gac/hold" };
