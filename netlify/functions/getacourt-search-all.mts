import {coreJson,response} from '../lib/platform.mts';
import {SOURCES} from '../../getacourt/assets/source-catalog.mjs';
import {validateQuery,normalizeCoreSlot,directorySource,searchFederated} from '../../getacourt/assets/federated-search.mjs';
import {clubSource} from '../lib/club-availability.mjs';

export function approvedIds() {
  return new Set(String(globalThis.Netlify?.env?.get('GETACOURT_APPROVED_VENUE_IDS')||'').split(',')
    .map(v=>v.trim().toLowerCase()).filter(v=>/^[a-z0-9-]{1,80}$/.test(v)).slice(0,200));
}
export async function coreSource(query,signal) {
  const approved=approvedIds();
  if(!approved.size)return {status:'not_configured',offers:[],invalidRows:0};
  const durations=query.duration==='any'?[60,90]:[Number(query.duration)];
  // Read-only existing Core endpoint; never forwards user credentials to external providers.
  const pages=await Promise.all(durations.map(duration=>coreJson('/api/availability?'+new URLSearchParams({
    sport:query.sport,location:query.location,date:query.date,time:query.from,end_time:query.to,
    duration:String(duration),indoor:'all'
  }),{signal,redirect:'error'})));
  const offers=[];let invalidRows=0;
  for(const payload of pages){
    if(!Array.isArray(payload?.slots)||payload.slots.length>1000)throw new Error('INVALID_SOURCE');
    for(const row of payload.slots){const offer=normalizeCoreSlot(row,query,approved);if(offer)offers.push(offer);else invalidRows++;}
  }
  return {status:'ok',offers,invalidRows};
}
export default async function handler(req) {
  if(req.method!=='GET')return response({error:'METHOD_NOT_ALLOWED'},405);
  try{
    const params=new URL(req.url).searchParams;
    if([...params.keys()].some(k=>params.getAll(k).length!==1))return response({error:'INVALID_SEARCH'},422);
    const now=new Date(),query=validateQuery(Object.fromEntries(params),now);
    const adapters=Object.fromEntries(SOURCES.map(s=>[s.id,s.id==='core'?coreSource:s.id==='club_internal'?
      (q,signal)=>clubSource(q,signal,{raw:globalThis.Netlify?.env?.get('GETACOURT_CLUB_FEEDS')||'',excludedClubIds:approvedIds()}):q=>directorySource(s.id,q)]));
    const data=await searchFederated(query,adapters,{now});
    return response(data);
  }catch{return response({error:'INVALID_SEARCH',message:'Choose a city or club, a valid date within 90 days, and a start-time range.'},422);}
}
export const config={path:'/api/gac/search-all'};
