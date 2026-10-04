import { body, bookingStore, reference, response } from "../lib/getacourt.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  const input = await body(req);
  if (!input.holdId || !input.customer?.email || !input.slot?.id) {
    return response({ error:"holdId, slot and customer email are required" }, 400);
  }

  const store = bookingStore();
  const hold = await store.get("hold/" + input.holdId, { type:"json" });
  if (!hold) return response({ error:"Hold not found or expired" }, 409);
  if (new Date(hold.expiresAt).getTime() <= Date.now()) return response({ error:"Hold expired" }, 409);

  const existing = await store.get("slot-booking/" + hold.slotKey, { type:"json" });
  if (existing) return response({ error:"This slot has already been booked" }, 409);

  const bookingId = crypto.randomUUID();
  const booking = {
    bookingId,
    reference:reference(),
    status:"confirmed",
    paymentStatus:"test_authorized",
    paymentMode:input.paymentMode === "split" ? "split" : "full",
    createdAt:new Date().toISOString(),
    customer:{
      name:String(input.customer.name || "").slice(0,120),
      email:String(input.customer.email).toLowerCase().slice(0,254)
    },
    venue:input.venue,
    slot:input.slot,
    provider:hold.provider,
    providerBookingId:null
  };

  await store.setJSON("booking/" + bookingId, booking);
  await store.setJSON("slot-booking/" + hold.slotKey, { bookingId, status:"confirmed", createdAt:booking.createdAt });
  await store.delete("slot-hold/" + hold.slotKey);
  await store.delete("hold/" + input.holdId);
  return response(booking, 201);
};

export const config = { path:"/api/gac/book" };
