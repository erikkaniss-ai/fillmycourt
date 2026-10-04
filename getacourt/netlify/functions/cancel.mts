import type { Config } from '@netlify/functions';
import { bookingStore } from './lib/store.js';

export default async (req:Request) => {
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  const body=await req.json().catch(()=>null) as null|{id?:string};if(!body?.id)return Response.json({error:'id is required'},{status:400});
  const store=bookingStore();const booking=await store.get(`booking-id:${body.id}`,{type:'json'}) as any;if(!booking)return Response.json({error:'Not found'},{status:404});
  booking.status='cancelled';booking.cancelledAt=new Date().toISOString();await store.setJSON(`booking-id:${body.id}`,booking);await store.delete(`booking:${booking.date}:${booking.slotId}`);return Response.json(booking);
};
export const config: Config = { path:'/api/cancel' };
