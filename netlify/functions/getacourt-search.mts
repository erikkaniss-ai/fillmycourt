import { bookingStore, demoInventory, response, slotKey } from "../lib/getacourt.mts";

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  const url = new URL(req.url);
  const query = {
    sport:(url.searchParams.get("sport") || "padel").toLowerCase(),
    location:url.searchParams.get("location") || "Cascais",
    date:url.searchParams.get("date") || "",
    from:url.searchParams.get("from") || "00:00",
    to:url.searchParams.get("to") || "23:59",
  };

  const providerUrl = globalThis.Netlify?.env?.get("GETACOURT_SLOT_PROVIDER_URL");
  const providerToken = globalThis.Netlify?.env?.get("GETACOURT_SLOT_PROVIDER_TOKEN");
  let data = null;

  if (providerUrl) {
    try {
      const upstream = new URL(providerUrl);
      Object.entries(query).forEach(([k,v]) => upstream.searchParams.set(k,v));
      const headers = providerToken ? { authorization:"Bearer " + providerToken } : {};
      const res = await fetch(upstream, { headers });
      if (res.ok) {
        const candidate = await res.json();
        if (candidate && Array.isArray(candidate.venues)) data = { ...candidate, mode:"provider" };
      }
    } catch (error) {
      console.error("GetACourt provider adapter failed", error);
    }
  }

  if (!data) data = demoInventory(query);
  const store = bookingStore();

  for (const venue of data.venues || []) {
    for (const slot of venue.slots || []) {
      const key = slotKey(slot.date || query.date, slot.id);
      const booked = await store.get("slot-booking/" + key, { type:"json" });
      const hold = await store.get("slot-hold/" + key, { type:"json" });
      const activeHold = hold && new Date(hold.expiresAt).getTime() > Date.now();
      if (booked || activeHold) slot.status = "unavailable";
    }
  }
  return response(data);
};

export const config = { path:"/api/gac/search" };
