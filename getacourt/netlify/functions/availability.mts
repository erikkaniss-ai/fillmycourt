import type { Config } from '@netlify/functions';
import { buildDemoVenues } from './lib/data.js';
import { bookingStore } from './lib/store.js';

export default async (req:Request) => {
  const u=new URL(req.url);const sport=u.searchParams.get('sport')||'padel';const date=u.searchParams.get('date')||new Date().toISOString().slice(0,10);const time=u.searchParams.get('time')||undefined;const duration=Math.max(30,Math.min(180,Number(u.searchParams.get('duration')||90)));
  const store=bookingStore();const venues=buildDemoVenues({sport,date,time,duration});
  const bookings=await store.list({prefix:`booking:${date}:`});
  const booked=new Set(bookings.blobs.map((b:{key:string})=>b.key.split(':').slice(2).join(':')));
  for(const v of venues) v.slots=v.slots.filter(s=>!booked.has(s.id));
  return Response.json({query:{sport,date,time,duration},venues,source:'demo-provider'});
};
export const config: Config = { path:'/api/availability' };
