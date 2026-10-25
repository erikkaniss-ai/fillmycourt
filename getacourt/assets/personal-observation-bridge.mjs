// User-initiated, browser-memory-only bridge for Playtomic personal observations.
// It is NOT provider API evidence, cannot authorize booking or create native slots.
import {safeSourceUrl,CLUBS} from './source-catalog.mjs';
const KEYSET=(obj,keys)=>obj && typeof obj==='object' && !Array.isArray(obj) &&
  Reflect.ownKeys(obj).every(k=>typeof k==='string'&&keys.includes(k));
const ROOT=['provider','source','sourceUrl','venue','date','sport','capturedAt','timezone','sourceFreshness','coverage','offers'];
const OFFER=['court','startLabel','endLabel','durationMinutes','priceEur'];
const MINUTE=/^([1-9]|1[0-2]):([0-5]\d) ([AP]M)$/;
function minute(s){const m=MINUTE.exec(s);return m?(Number(m[1])%12)*60+Number(m[2])+(m[3]==='PM'?720:0):null;}
const dateMs=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))return NaN;
 const v=Date.parse(value);return Number.isFinite(v)&&new Date(v).toISOString()===value?v:NaN;
};
function observedOnly(data) {
 if(!KEYSET(data,ROOT)||ROOT.some(k=>!Object.hasOwn(data,k)))throw Error('INVALID_OBSERVATION');
 if(!Array.isArray(data.offers)||data.offers.length<1||data.offers.length>20||
    data.offers.some(o=>!KEYSET(o,OFFER)||OFFER.some(k=>!Object.hasOwn(o,k))))throw Error('INVALID_OBSERVATION');
 if(data.provider!=='playtomic'||data.source!=='user_ui_observation'||data.sourceFreshness!=='unknown'||
    data.coverage!=='expanded_offers_only'||data.timezone!==null)throw Error('INVALID_OBSERVATION');
 if(!safeSourceUrl('playtomic',data.sourceUrl))throw Error('INVALID_OBSERVATION');
 return data;
}
/**
 * Takes a strict copy of source data from the packaged extension; never
 * accepts a provider session, email, cookie, token, arbitrary URL or PII keys.
 * All offers are labelled USER_OBSERVED / PARTIAL, never native inventory.
 * Two wall-clock instants in a DST transition cannot be distinguished because
 * the provider displayed no time zone. Their UTC is deliberately NULL.
 */
export function normalizePersonalObservation(raw,query,{now=Date.now(),validator}={}) {
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16384)throw Error('INVALID_OBSERVATION');
 const parsed=observedOnly(JSON.parse(raw));
 if(typeof validator!=='function')throw Error('VALIDATOR_REQUIRED');
 const v=validator(parsed);
 const timestamp=dateMs(v.capturedAt);
 if(!Number.isFinite(timestamp)||timestamp>now+5000||now-timestamp>=60000)throw Error('OBSERVATION_EXPIRED');
 if(query.sport!==v.sport.toLowerCase()||query.date!==v.date)throw Error('OBSERVATION_QUERY_MISMATCH');
 const known=CLUBS.find(c=>c.sources.some(s=>s.id==='playtomic'&&s.url===v.sourceUrl));
 const qfrom=Number(query.from.slice(0,2))*60+Number(query.from.slice(3));
 const qto=Number(query.to.slice(0,2))*60+Number(query.to.slice(3));
 const offers=v.offers.flatMap((offer,i)=>{
   const start=minute(offer.startLabel),end=minute(offer.endLabel);
   if(start===null||end===null||start<qfrom||start>=qto||
     (query.duration!=='any'&&Number(query.duration)!==offer.durationMinutes)||
     !Number.isSafeInteger(Math.round(offer.priceEur*100)))return [];
   // If duration does not fit the displayed start/end labels, it may be a
   // cross-midnight or inconsistent provider row. Never infer a free slot.
   const elapsed=(end-start+1440)%1440;
   if(!elapsed||elapsed!==offer.durationMinutes)return [];
   return [Object.freeze({
     id:'personal:'+i,sourceId:'playtomic',evidence:'user_ui_observation',
     clubId:known?.id||null,clubName:known?.name||v.venue,
     courtName:offer.court,date:v.date,startLabel:offer.startLabel,endLabel:offer.endLabel,
     duration:offer.durationMinutes,priceMinor:Math.round(offer.priceEur*100),
     currency:'EUR',startsAt:null,timezone:null,sourceUrl:v.sourceUrl,
     providerFreshness:'unknown',coverage:'expanded_offers_only',bookingEnabled:false
   })];
 });
 if(!offers.length)throw Error('NO_MATCHING_OBSERVED_OFFERS');
 return Object.freeze({
   sourceId:'playtomic',status:'personal_observed',clubId:known?.id||null,
   capturedAt:v.capturedAt,expiresAt:new Date(timestamp+60000).toISOString(),
   venue:v.venue,sourceUrl:v.sourceUrl,
   offers:Object.freeze(offers),
   notice:'Offers were copied by this player from a partial visible UI observation. Provider freshness/time zone unknown. Not a live availability feed or booking confirmation.'
 });
}
export function exportPersonalObservation(observation,{validator,now=Date.now()}={}){
 if(typeof validator!=='function')throw Error('VALIDATOR_REQUIRED');
 const v=validator(observedOnly(observation));
 const captured=dateMs(v.capturedAt);
 if(!Number.isFinite(captured)||captured>now+5000||now-captured>=60000)throw Error('OBSERVATION_EXPIRED');
 return JSON.stringify(v);
}
