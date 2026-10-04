import { getDeployStore, getStore } from "@netlify/blobs";

export function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

export function bookingStore() {
  const netlify = globalThis.Netlify;
  const isProduction = netlify?.context?.deploy?.context === "production";
  return isProduction
    ? getStore("getacourt-booking", { consistency: "strong" })
    : getDeployStore("getacourt-booking");
}

export function normalizeDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value;
  return new Date().toISOString().slice(0, 10);
}

export function slotKey(date, slotId) {
  return normalizeDate(date) + ":" + String(slotId || "");
}

export function demoInventory({ sport = "padel", location = "Cascais", date, from = "17:00", to = "22:00" }) {
  const d = normalizeDate(date);
  const raw = [
    { id:"demo-cascais-01", name:"Cascais Court Club", area:"Cascais", distanceKm:1.8, sport:"padel", indoor:true, tags:["Indoor","Panoramic","Parking"], slots:[["17:30",32,90],["19:00",38,90],["20:30",36,90],["22:00",27,60]] },
    { id:"demo-estoril-02", name:"Estoril Racket Lab", area:"Estoril", distanceKm:4.2, sport:"padel", indoor:false, tags:["Outdoor","Rental rackets","Café"], slots:[["18:00",28,90],["19:30",34,90],["21:00",30,90]] },
    { id:"demo-oeiras-03", name:"Oeiras Indoor Arena", area:"Oeiras", distanceKm:11.6, sport:"padel", indoor:true, tags:["Indoor","Changing rooms","Parking"], slots:[["17:00",26,60],["18:00",26,60],["20:00",31,90],["21:30",24,60]] },
  ];
  const within = time => time >= from && time <= to;
  const venues = raw.filter(v => v.sport === sport).map(v => ({
    ...v,
    source:"GetACourt demo provider",
    slots:v.slots.filter(s => within(s[0])).map(([time, price, duration], i) => ({
      id:v.id + "-" + String(time).replace(":","") + "-" + i,
      venueId:v.id, date:d, time, duration, price, currency:"EUR",
      status:"available", bookingType:"native", provider:"demo"
    }))
  })).filter(v => v.slots.length);
  return { mode:"demo", provider:"demo", query:{ sport, location, date:d, from, to }, venues };
}

export function reference() {
  return "GAC-" + Math.random().toString(36).slice(2,8).toUpperCase();
}
