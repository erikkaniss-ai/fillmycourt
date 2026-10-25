import {SOURCES, directoryMatches, safeSourceUrl} from './source-catalog.mjs';
const SPORTS=new Set(['padel','tennis','squash','badminton','pickleball']);
const STATES=new Set(['ok','not_configured','directory_only','personal_reader_only','needs_auth','timeout','error','invalid_response']);
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID=/^[a-zA-Z0-9_-]{1,80}$/;
const INSTANT=/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
function fail(){throw new Error('INVALID_SEARCH');}
function text(v,max=160){return typeof v==='string' && v.length>0 && v.length<=max && !/[\u0000-\u001f\u007f]/.test(v);}
export function localDay(now=new Date(),timeZone='Europe/Lisbon') {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${v.year}-${v.month}-${v.day}`;
}
export function validateQuery(input,now=new Date()) {
  if(!input || typeof input!=='object' || Array.isArray(input))fail();
  if(Object.keys(input).some(k=>!['location','sport','date','from','to','duration'].includes(k)))fail();
  const q={location:typeof input.location==='string'?input.location.trim():'',sport:input.sport||'padel',date:input.date||localDay(now),from:input.from||'00:00',to:input.to||'23:59',duration:input.duration||'any'};
  if(!text(q.location,80)||!SPORTS.has(q.sport)||!TIME.test(q.from)||!TIME.test(q.to)||q.from>=q.to||!['any','60','90'].includes(q.duration))fail();
  if(typeof q.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(q.date))fail();
  const day=Date.parse(q.date+'T00:00:00Z');
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==q.date)fail();
  const today=localDay(now), latest=new Date(Date.parse(today+'T00:00:00Z')+90*86400000).toISOString().slice(0,10);
  if(q.date<today||q.date>latest)fail();
  return Object.freeze(q);
}
export function normalizeCoreSlot(row,query,approved) {
  if(!row||typeof row!=='object'||!approved.has(String(row.venue_id).toLowerCase()))return null;
  if(String(row.venue_id).toLowerCase()==='d6dbceca-3cca-4053-bcb7-5491a9225cb0'||row.venue_name==='GetACourt Cascais Test Venue'||row.address?.label==='Cascais staging inventory')return null;
  if(typeof row.id!=='string'||typeof row.venue_id!=='string'||!ID.test(row.id)||!ID.test(row.venue_id)||!text(row.name)||!text(row.venue_name)||row.sport!==query.sport)return null;
  if(!Number.isSafeInteger(row.amount_minor)||row.amount_minor<0||typeof row.currency!=='string'||!/^[A-Z]{3}$/.test(row.currency))return null;
  if(!Number.isInteger(row.duration_minutes)||![60,90].includes(row.duration_minutes)||(query.duration!=='any'&&row.duration_minutes!==Number(query.duration)))return null;
  if(typeof row.starts_at!=='string'||!INSTANT.test(row.starts_at)||!Number.isFinite(Date.parse(row.starts_at))||!text(row.timezone,80))return null;
  let date,time,displayTime;
  try {
    const start=new Date(row.starts_at); date=localDay(start,row.timezone);
    time=new Intl.DateTimeFormat('en-GB',{timeZone:row.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(start);
    displayTime=new Intl.DateTimeFormat('en-GB',{timeZone:row.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'}).format(start);
  } catch {return null;}
  if(date!==query.date||time<query.from||time>=query.to)return null;
  const startsAt=new Date(row.starts_at).toISOString();
  return {id:['core',row.venue_id,row.id,startsAt,row.duration_minutes].join('|'),clubId:'core:'+row.venue_id,
    clubName:row.venue_name,courtId:row.id,courtName:row.name,sport:row.sport,date,time,displayTime,startsAt,
    timezone:row.timezone,duration:row.duration_minutes,priceMinor:row.amount_minor,currency:row.currency,
    sourceId:'core',evidence:'core_reported',providerFreshness:'unknown',bookingEnabled:false};
}
export function directorySource(id,query) {
  return {id,status:id==='club_internal'?'not_configured':id==='playtomic'?'personal_reader_only':'directory_only',
    offers:[],clubs:directoryMatches(query).filter(c=>c.sources.some(s=>s.id===id)),coverage:'directory_only'};
}
export function mergeResults(query,results,now=new Date()) {
  const clubs=new Map(), offers=new Map(), conflicts=new Set(), sources=[];
  for(const source of SOURCES){
    const result=results.find(r=>r?.id===source.id);
    const status=STATES.has(result?.status)?result.status:'invalid_response';
    const isCore=source.id==='core' && status==='ok';
    const sourceOffers=[];
    if(isCore)for(const offer of (Array.isArray(result.offers)?result.offers:[]).slice(0,1000)){
      // Only the native adapter supplies server offers in this release.
      if(offer?.sourceId!=='core'||offer.evidence!=='core_reported'||offer.date!==query.date||offer.bookingEnabled!==false)continue;
      if(conflicts.has(offer.id))continue;
      const prev=offers.get(offer.id);
      if(prev && (prev.priceMinor!==offer.priceMinor||prev.currency!==offer.currency||prev.clubName!==offer.clubName||prev.courtName!==offer.courtName)){
        conflicts.add(offer.id);offers.delete(offer.id);continue;
      }
      offers.set(offer.id,{...offer});sourceOffers.push(offer);
    }
    // Directory is always taken from the reviewed registry, not arbitrary upstream metadata.
    for(const c of directoryMatches(query).filter(c=>c.sources.some(s=>s.id===source.id))){
      if(!clubs.has(c.id))clubs.set(c.id,{id:c.id,name:c.name,area:c.area,sports:[...c.sports],sources:[],website:safeSourceUrl('club_website',c.website),availability:'unknown'});
      const target=clubs.get(c.id);
      for(const s of c.sources.filter(s=>s.id===source.id)){
        const url=safeSourceUrl(s.id,s.url);if(url)target.sources.push({id:s.id,label:source.label,url,kind:s.kind,reviewedOn:s.reviewedOn});
      }
    }
    sources.push({id:source.id,label:source.label,status,offerCount:sourceOffers.length,coverage:isCore?'approved_core_only':'no_live_feed',invalidRows:Number.isSafeInteger(result?.invalidRows)?result.invalidRows:0});
  }
  const ordered=[...offers.values()].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.priceMinor-b.priceMinor||a.id.localeCompare(b.id));
  sources.find(s=>s.id==='core').offerCount=ordered.length;
  return {version:'gac-federated-search/v1',query:{...query},generatedAt:now.toISOString(),expiresAt:new Date(now.getTime()+60000).toISOString(),
    coverage:'partial',complete:false,sources,offers:ordered,directory:[...clubs.values()],conflictingOffers:conflicts.size,
    bookingEnabled:false,notice:'Directory entries are not free courts. Missing or empty source results do not establish that clubs are sold out.'};
}
export async function searchFederated(query,adapters,{now=new Date(),timeoutMs=6000}={}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw new Error('INVALID_TIMEOUT');
  const results=await Promise.all(SOURCES.map(async source=>{
    const adapter=adapters[source.id];if(typeof adapter!=='function')return {id:source.id,status:'not_configured'};
    const controller=new AbortController();let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(()=>adapter(query,controller.signal)).then(value=>({...value,id:source.id})),
        new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({id:source.id,status:'timeout'});},timeoutMs);})
      ]);
    }catch(error){return {id:source.id,status:[401,403].includes(error?.status)?'needs_auth':error?.message==='INVALID_SOURCE'?'invalid_response':'error'};}
    finally{clearTimeout(timer);}
  }));
  return mergeResults(query,results,now);
}
