// Direct club-owned availability feed. No provider endpoint discovery or writes.
import {fold} from '../../getacourt/assets/source-catalog.mjs';
import {normalizeCoreSlot} from '../../getacourt/assets/federated-search.mjs';
const ID=/^[a-zA-Z0-9_-]{1,80}$/;
const INSTANT=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/;
const own=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const text=(v,n=160)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v);
const instant=v=>typeof v==='string'&&INSTANT.test(v)&&Number.isFinite(Date.parse(v));
const deny=()=>{throw Error('INVALID_SOURCE');};
const caches=new WeakMap(); // Per runtime, bounded; no database or disk writes.
function publicUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||
    !/^[a-z][a-z0-9.-]*\.[a-z]{2,}$/.test(u.hostname)||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(u.hostname))deny();
  return u;
}
export function readClubFeeds(raw,now=new Date()){
  if(!raw)return [];
  if(typeof raw!=='string'||raw.length>16384)deny();
  const feeds=JSON.parse(raw);if(!Array.isArray(feeds)||feeds.length>5)deny();
  const seen=new Set();
  for(const f of feeds){
    if(!own(f,['id','clubId','clubName','areas','timezone','feedUrl','bookingUrl','courts','approvalRef','validUntil','maxAgeSeconds','authority'])||
      !ID.test(f.id??'')||!ID.test(f.clubId??'')||!text(f.clubName)||f.authority!=='club_canonical'||
      !Array.isArray(f.areas)||!f.areas.length||f.areas.length>10||!f.areas.every(a=>text(a,80)&&fold(a))||
      !text(f.timezone,80)||!text(f.approvalRef,120)||!instant(f.validUntil)||Date.parse(f.validUntil)<=now.getTime()||
      !Number.isInteger(f.maxAgeSeconds)||f.maxAgeSeconds<1||f.maxAgeSeconds>300||
      !Array.isArray(f.courts)||!f.courts.length||f.courts.length>50||
      !f.courts.every(c=>own(c,['id','name','sport'])&&ID.test(c.id??'')&&text(c.name)&&['padel','tennis','squash','badminton','pickleball'].includes(c.sport))||
      new Set(f.courts.map(c=>c.id)).size!==f.courts.length||seen.has(f.id)||seen.has('club:'+f.clubId))deny();
    try{new Intl.DateTimeFormat('en',{timeZone:f.timezone}).format(now);}catch{deny();}
    const feed=publicUrl(f.feedUrl),book=publicUrl(f.bookingUrl);
    // The club must control both URLs. This adapter cannot impersonate a
    // Playtomic/TieSports/Racket ID/Smashpro API or accept their session cookies.
    if(feed.origin!==book.origin||/(?:^|\.)(?:playtomic\.com|playtomic\.io|tiesports\.com|racket\.id|smashpro\.pt|smashpro\.co)$/.test(feed.hostname))deny();
    seen.add(f.id);seen.add('club:'+f.clubId);
  }
  return feeds;
}
export function normalizeClubFeed(payload,f,query,now=new Date()){
  if(!own(payload,['version','clubId','date','sport','observedAt','expiresAt','offers'])||
    payload.version!=='gac-club-availability/v1'||payload.clubId!==f.clubId||payload.date!==query.date||payload.sport!==query.sport||
    !instant(payload.observedAt)||!instant(payload.expiresAt)||!Array.isArray(payload.offers)||payload.offers.length>500)deny();
  const observed=Date.parse(payload.observedAt),expires=Date.parse(payload.expiresAt),t=now.getTime();
  if(observed>t||expires<=t||expires<=observed||expires-observed>f.maxAgeSeconds*1000||t-observed>=f.maxAgeSeconds*1000)deny();
  const until=new Date(Math.min(t+60000,expires,Date.parse(f.validUntil))).toISOString();
  const offers=new Map(),conflicts=new Set();let invalidRows=0;
  for(const row of payload.offers){
    if(!own(row,['id','courtId','startsAt','endsAt','priceMinor','currency'])||!ID.test(row.id??'')||!instant(row.startsAt)||!instant(row.endsAt))deny();
    const court=f.courts.find(c=>c.id===row.courtId),minutes=(Date.parse(row.endsAt)-Date.parse(row.startsAt))/60000;
    if(!court||court.sport!==query.sport||Date.parse(row.startsAt)<=t||row.currency!=='EUR'){invalidRows++;continue;}
    // Reuse the existing date/range/DST/price validation, then give the result
    // its distinct club-feed identity and provenance (never Core provenance).
    const o=normalizeCoreSlot({venue_id:f.clubId,venue_name:f.clubName,id:court.id,name:court.name,
      sport:query.sport,starts_at:row.startsAt,timezone:f.timezone,duration_minutes:minutes,
      amount_minor:row.priceMinor,currency:row.currency},query,new Set([f.clubId]));
    if(!o){invalidRows++;continue;}
    const offer={...o,id:['club',f.id,row.id].join('|'),clubId:'club:'+f.clubId,sourceId:'club_internal',evidence:'club_feed',
      observedAt:new Date(observed).toISOString(),expiresAt:until,providerFreshness:'source_timestamped',
      handoffUrl:f.bookingUrl,handoffKind:'club_page'};
    if(conflicts.has(offer.id))continue;
    const previous=offers.get(offer.id);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(offer)){offers.delete(offer.id);conflicts.add(offer.id);invalidRows++;continue;}
    offers.set(offer.id,offer);
  }
  return {offers:[...offers.values()],invalidRows,expiresAt:until};
}
async function boundedJson(response){
  if(!response.ok)throw Object.assign(Error('SOURCE_UNAVAILABLE'),{status:response.status});
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)deny();
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)deny();chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{deny();}
}
export async function clubSource(query,signal,{raw='',clock=()=>new Date(),fetcher=globalThis.fetch,excludedClubIds=new Set()}={}){
  const feeds=readClubFeeds(raw,clock()).filter(f=>f.areas.some(a=>fold(a)===fold(query.location))||fold(f.clubName)===fold(query.location));
  if(!feeds.length)return {status:'not_configured',offers:[],invalidRows:0};
  if(feeds.some(f=>excludedClubIds.has(f.clubId.toLowerCase())))deny();
  if(!caches.has(fetcher))caches.set(fetcher,new Map());const cache=caches.get(fetcher);
  const results=await Promise.allSettled(feeds.map(async f=>{
    const url=new URL(f.feedUrl);for(const [key,value]of Object.entries(query))if(key!=='location')url.searchParams.set(key,value);
    const key=JSON.stringify(f)+'|'+url.href,cached=cache.get(key);
    if(cached&&Date.parse(cached.expiresAt)>clock().getTime())return cached;
    const response=await fetcher(url,{method:'GET',signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',headers:{accept:'application/json'}});
    const payload=await boundedJson(response),checkedAt=clock();
    readClubFeeds(JSON.stringify([f]),checkedAt); // Expiry can occur in flight.
    const normalized=normalizeClubFeed(payload,f,query,checkedAt);
    if(cache.size>=20)cache.delete(cache.keys().next().value);cache.set(key,normalized);
    return normalized;
  }));
  const passed=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!passed.length)throw results.find(r=>r.status==='rejected').reason;
  return {status:'ok',offers:passed.flatMap(r=>r.offers),invalidRows:passed.reduce((n,r)=>n+r.invalidRows,0),failedFeeds:results.length-passed.length};
}
