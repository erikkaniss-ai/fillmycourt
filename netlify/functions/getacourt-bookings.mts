import { bookingStore, response } from "../lib/getacourt.mts";

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return response({ error:"email is required" }, 400);

  const store = bookingStore();
  const { blobs } = await store.list({ prefix:"booking/" });
  const bookings = [];
  for (const item of blobs.slice(0,100)) {
    const booking = await store.get(item.key, { type:"json" });
    if (booking?.customer?.email === email) bookings.push(booking);
  }
  bookings.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return response({ bookings });
};

export const config = { path:"/api/gac/bookings" };
