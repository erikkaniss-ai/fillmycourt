import type { Config } from '@netlify/functions';
import { bookingStore, id } from './lib/store.js';

type BookingInput={holdId?:string;venueId?:string;slotId?:string;date?:string;time?:string;duration?:number;price?:number;sport?:string;name?:string;email?:string;players?:number;payment?:string};

export default async (req:Request) => {
  const store=bookingStore();
  if(req.method==='GET'){
    const u=new URL(req.url);const bookingId=u.searchParams.get('id');if(!bookingId)return Response.json({error:'id is required'},{status:400});
    const booking=await store.get(`booking-id:${bookingId}`,{type:'json'});return booking?Response.json(booking):Response.json({error:'Not found'},{status:404});
  }
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  const body=await req.json().catch(()=>null) as BookingInput|null;
  const required=['holdId','venueId','slotId','date','time','sport','name','email'] as const;
  if(!body||required.some(k=>!body[k]))return Response.json({error:'Missing booking fields'},{status:400});
  const hold=await store.get(`hold-id:${body.holdId}`,{type:'json'}) as null|{slotId:string;date:string;expiresAt:string};
  if(!hold||hold.slotId!==body.slotId||hold.date!==body.date||new Date(hold.expiresAt)<=new Date())return Response.json({error:'Hold missing or expired'},{status:409});
  const booking={...body,id:id('GAC'),status:'confirmed',demo:true,createdAt:new Date().toISOString()};
  await store.setJSON(`booking:${body.date}:${body.slotId}`,booking);await store.setJSON(`booking-id:${booking.id}`,booking);await store.delete(`hold:${body.date}:${body.slotId}`);await store.delete(`hold-id:${body.holdId}`);
  return Response.json(booking,{status:201});
};
export const config: Config = { path:'/api/bookings' };
