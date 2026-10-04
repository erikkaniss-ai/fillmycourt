export type Slot = { id:string; time:string; price:number; duration:number; provider:string };
export type Venue = { id:string; name:string; city:string; distance:number; sports:string[]; indoor:boolean; rating:number; surfaces:string; amenities:string[]; live:boolean; slots:Slot[] };

export const venueSeeds = [
  {id:'demo-cascais',name:'GetACourt Demo Club — Cascais',city:'Cascais',distance:2.4,sports:['padel','tennis'],indoor:true,rating:4.8,surfaces:'Panoramic · synthetic turf',amenities:['Parking','Showers','Racket rental'],basePrice:28,times:['07:30','09:00','12:00','18:00','19:30','21:00']},
  {id:'demo-estoril',name:'GetACourt Demo Club — Estoril',city:'Estoril',distance:4.1,sports:['padel','squash'],indoor:true,rating:4.7,surfaces:'Indoor · competition courts',amenities:['Cafe','Lockers','Access code'],basePrice:24,times:['08:00','10:30','13:00','18:30','20:00','21:30']},
  {id:'demo-lisbon',name:'GetACourt Demo Club — Lisboa',city:'Lisboa',distance:18.6,sports:['padel','tennis','badminton','pickleball'],indoor:false,rating:4.6,surfaces:'Outdoor · mixed surfaces',amenities:['Pro shop','Coaches','Free parking'],basePrice:20,times:['07:00','11:00','15:30','17:30','19:00','20:30']}
] as const;

export function buildDemoVenues(input:{sport:string;date:string;time?:string;duration:number}): Venue[] {
  return venueSeeds.filter(v=>(v.sports as readonly string[]).includes(input.sport)).map((v,venueIndex)=>({
    id:v.id,name:v.name,city:v.city,distance:v.distance,sports:[...v.sports],indoor:v.indoor,rating:v.rating,surfaces:v.surfaces,amenities:[...v.amenities],live:false,
    slots:v.times.filter(t=>!input.time || t>=input.time).slice(0,4).map((time,i)=>({id:`${v.id}:${input.date}:${time}:${input.duration}`,time,price:v.basePrice+((venueIndex+i)%3)*4,duration:input.duration,provider:'demo'}))
  }));
}
