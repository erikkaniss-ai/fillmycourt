// Standalone GetACourt player-session module. No server inventory or API access.
import {validateQuery,localDay} from './federated-search.mjs';
import './personal-source-observation.js';
import {normalizePersonalObservation} from './personal-observation-bridge.mjs';
const byId=id=>document.getElementById(id);
const form=byId('search'),status=byId('searchStatus'),personalStatus=byId('personalStatus');
const offersHost=byId('offers'),sourcesHost=byId('sourceStatus'),payload=byId('personalPayload');
const date=form.elements.namedItem('date');
const today=localDay();date.value=date.min=today;
date.max=new Date(Date.parse(today+'T00:00:00Z')+14*86400000).toISOString().slice(0,10);
let query=null,revision=0,pendingBridge=null,timer=null;
const observations=new Map();
const make=(tag,label,cls)=>{const el=document.createElement(tag);if(label!==undefined)el.textContent=String(label);if(cls)el.className=cls;return el;};
const allowed=()=>Boolean(query);
function clearPending(){
  pendingBridge=null;
  delete document.documentElement.dataset.gacPersonalBridgeRequest;
}
function clearOffers(message){
  revision++;clearPending();clearTimeout(timer);timer=null;
  observations.clear();payload.value='';
  offersHost.replaceChildren(make('p','No fresh personal offers yet.','empty'));
  personalStatus.textContent=message||'No personal offers imported.';
  renderSources();
}
function reset(message){
  query=null;clearOffers('Search changed. Previous private observations cleared.');
  byId('requestPersonalBridge').disabled=true;
  byId('comparePersonal').disabled=true;
  status.textContent=message||'Choose filters and press Find courts.';
}
function minute(value){
  const m=/^([1-9]|1[0-2]):([0-5]\d) ([AP]M)$/.exec(value);
  return m?(Number(m[1])%12)*60+Number(m[2])+(m[3]==='PM'?720:0):1441;
}
function renderSources(){
  sourcesHost.replaceChildren();
  const names=[
    ['Playtomic', observations.size ? 'Personal observation loaded — partial and expires' : 'Requires your own Reader and club-tab approval'],
    ['TiePlayer / TieSports','Not connected: player UI verification pending'],
    ['Racket ID','Not connected: player UI verification pending'],
    ['Smashpro','Not connected: player UI verification pending']
  ];
  for(const [name,detail] of names){
    const card=make('article',undefined,'source');
    card.append(make('strong',name),make('small',detail));
    sourcesHost.append(card);
  }
}
function paint(){
  clearTimeout(timer);
  const now=Date.now();
  for(const [key,v] of observations)if(Date.parse(v.expiresAt)<=now)observations.delete(key);
  const rows=[...observations.values()].flatMap(v=>v.offers.map(o=>({o,captured:v.capturedAt,expires:v.expiresAt})))
    .sort((a,b)=>minute(a.o.startLabel)-minute(b.o.startLabel)||
      a.o.priceMinor-b.o.priceMinor||a.o.clubName.localeCompare(b.o.clubName));
  offersHost.replaceChildren();
  for(const {o,captured} of rows){
    const card=make('article',undefined,'card');
    card.append(make('span','Playtomic · personally observed · partial','badge'),
      make('h3',o.clubName),make('p','Court: '+o.courtName),
      make('p',o.date+' · '+o.startLabel+'–'+o.endLabel+' · '+o.duration+' min'),
      make('p',new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(o.priceMinor/100),'price'),
      make('small','Observed '+captured+' UTC · provider freshness/timezone unknown · not reserved'));
    const a=make('a','Continue on Playtomic (recheck availability)');
    a.href=o.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';
    card.append(a);offersHost.append(card);
  }
  if(!rows.length)offersHost.append(make('p','No fresh personally observed offers. Other courts may be available.','empty'));
  personalStatus.textContent=rows.length
    ? rows.length+' personally observed offer(s) · incomplete coverage · original provider must recheck the booking.'
    : 'No fresh personal offers. Search the club again if the earlier report has expired.';
  renderSources();
  if(observations.size){
    const expires=Math.min(...[...observations.values()].map(v=>Date.parse(v.expiresAt)));
    timer=setTimeout(paint,Math.max(1,expires-Date.now()));
  }
}
function errorText(error){
  return ({
    OBSERVATION_EXPIRED:'The Reader observation expired. Search the club again (60-second lifetime).',
    OBSERVATION_QUERY_MISMATCH:'Reader date or sport differs from this search.',
    OBSERVATION_LOCATION_MISMATCH:'The observed club does not match the searched area or exact club name.',
    NO_MATCHING_OBSERVED_OFFERS:'No observed offers match the selected start range and duration. Other times may exist.'
  })[error?.message]||'The report was rejected. Use only a fresh sanitized GetACourt Reader observation.';
}
function importPersonal(raw,expectedQuery,expectedRevision){
  if(expectedRevision!==revision||query!==expectedQuery||!allowed())return false;
  try{
    const validator=globalThis.GetACourtPersonalSourceObservation?.validateObservation;
    const v=normalizePersonalObservation(raw,expectedQuery,{now:Date.now(),validator});
    // One club report is a partial snapshot, never a global stock count.
    if(!observations.has(v.sourceUrl)&&observations.size===5)
      observations.delete(observations.keys().next().value);
    observations.set(v.sourceUrl,v);
    payload.value='';paint();return true;
  }catch(error){
    payload.value='';personalStatus.textContent=errorText(error);
    return false;
  }
}
renderSources();
form.addEventListener('input',()=>reset('Filters changed. Press Find courts to prepare a new personal search.'));
form.addEventListener('change',()=>reset('Filters changed. Press Find courts to prepare a new personal search.'));
form.addEventListener('submit',event=>{
  event.preventDefault();reset('Validating your private search…');
  let next;
  try{
    next=validateQuery(Object.fromEntries(new FormData(form)));
    if(next.date>date.max)throw Error('OUT_OF_READER_RANGE');
  }catch{
    status.textContent='Select a location, day within 14 days, sport, and valid start-time range.';return;
  }
  query=next;
  byId('requestPersonalBridge').disabled=false;
  byId('comparePersonal').disabled=false;
  status.textContent='Ready: use your Playtomic Reader on a club page for '+next.date+'. Then transfer its short-lived observations here. No server inventory request was made.';
  personalStatus.textContent='Waiting for your Reader observation.';
});
byId('requestPersonalBridge').addEventListener('click',()=>{
  if(!allowed()){personalStatus.textContent='Prepare a search first.';return;}
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
  pendingBridge={nonce,query,revision};
  document.documentElement.dataset.gacPersonalBridgeRequest=nonce;
  personalStatus.textContent='Requested. Click the GetACourt extension icon in THIS tab and choose Deliver prepared Reader offers here.';
  window.dispatchEvent(new CustomEvent('gac:request-personal-observation',{detail:{nonce}}));
});
window.addEventListener('gac:personal-observation',event=>{
  const detail=event.detail,request=pendingBridge;
  if(!request||!detail||typeof detail!=='object'||Array.isArray(detail)||
    Object.keys(detail).sort().join(',')!=='nonce,observation'||detail.nonce!==request.nonce)return;
  if(importPersonal(JSON.stringify(detail.observation),request.query,request.revision)){
    // Synchronous confirmation is consumed by the injected extension script.
    window.dispatchEvent(new CustomEvent('gac:personal-observation-accepted',{detail:{nonce:request.nonce}}));
    clearPending();
  }
});
byId('comparePersonal').addEventListener('click',()=>{
  if(!allowed()){personalStatus.textContent='Prepare a search first.';payload.value='';return;}
  importPersonal(payload.value,query,revision);
});
byId('clearPersonal').addEventListener('click',()=>clearOffers('Personal observations cleared. No provider account was signed out.'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint();});
window.addEventListener('pagehide',()=>reset('Page closed. Personal observations cleared.'));
window.addEventListener('pageshow',event=>{if(event.persisted)reset('Page restored. Search again to avoid stale offers.');});
