import type { Config } from '@netlify/functions';
import { bookingStore, id } from './lib/store.js';

export default async (req:Request) => {
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  const body=await req.json().catch(()=>null) as null|{venueId?:string;slotId?:string;date?:string};
  if(!body?.venueId||!body.slotId||!body.date) return Response.json({error:'Missing booking fields'},{status:400});
  const store=bookingStore();const holdKey=`hold:${body.date}:${body.slotId}`;const existing=await store.get(holdKey,{type:'json'}) as null|{expiresAt:string};
  if(existing&&new Date(existing.expiresAt)>new Date()) return Response.json({error:'Slot already held'},{status:409});
  const hold={id:id('HOLD'),venueId:body.venueId,slotId:body.slotId,date:body.date,expiresAt:new Date(Date.now()+10*60_000).toISOString()};
  await store.setJSON(holdKey,hold);await store.setJSON(`hold-id:${hold.id}`,hold);return Response.json(hold,{status:201});
};
export const config: Config = { path:'/api/hold' };
