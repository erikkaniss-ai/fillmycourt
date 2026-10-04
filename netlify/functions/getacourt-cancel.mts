import { body, bookingStore, response, slotKey } from "../lib/getacourt.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  const input = await body(req);
  if (!input.bookingId || !input.email) return response({ error:"bookingId and email are required" }, 400);

  const store = bookingStore();
  const booking = await store.get("booking/" + input.bookingId, { type:"json" });
  if (!booking) return response({ error:"Booking not found" }, 404);
  if (String(booking.customer?.email || "").toLowerCase() !== String(input.email).toLowerCase()) {
    return response({ error:"Booking identity mismatch" }, 403);
  }
  if (booking.status !== "confirmed") return response({ booking });

  booking.status = "cancelled";
  booking.cancelledAt = new Date().toISOString();
  await store.setJSON("booking/" + input.bookingId, booking);
  await store.delete("slot-booking/" + slotKey(booking.slot?.date, booking.slot?.id));
  return response({ booking });
};

export const config = { path:"/api/gac/cancel" };
