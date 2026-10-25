import {SOURCES,safeSourceUrl} from './source-catalog.mjs';
import {localDay,validateQuery,directorySource,mergeResults} from './federated-search.mjs';
const form=document.querySelector('#search'),status=document.querySelector('#searchStatus');
const sourceBox=document.querySelector('#sourceStatus'),offerBox=document.querySelector('#offers'),clubBox=document.querySelector('#clubs');
const date=form.elements.namedItem('date');date.value=localDay();date.min=localDay();
date.max=new Date(Date.parse(date.min+'T00:00:00Z')+90*86400000).toISOString().slice(0,10);
let generation=0,controller=null,expiry=null;
const labels={ok:'Core read completed',not_configured:'Not connected',directory_only:'Directory only — availability not checked',personal_reader_only:'Personal extension only — no web availability feed',needs_auth:'Source requires access',timeout:'Source timed out',error:'Source temporarily unavailable',invalid_response:'Source response could not be verified'};
function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(className)e.className=className;return e;}
function empty(box,message){box.replaceChildren(element('p',message,'empty'));}
function clear(message){generation++;controller?.abort();controller=null;clearTimeout(expiry);expiry=null;sourceBox.replaceChildren();offerBox.replaceChildren();clubBox.replaceChildren();status.textContent=message;form.querySelector('button').disabled=false;}
function sourceRows(rows){sourceBox.replaceChildren();for(const source of SOURCES){const row=rows.find(r=>r.id===source.id),card=element('article',undefined,'source');card.append(element('strong',source.label),element('span',labels[row?.status]||labels.invalid_response),element('small',source.id==='core'?'Only approved, non-fixture Core venues are eligible.':'No automated provider availability request in this web search.'));sourceBox.append(card);}}
function link(text,url){const a=element('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function render(data,query,localFallback=false){
  if(data?.version!=='gac-federated-search/v1'||data.complete!==false||data.bookingEnabled!==false||!Array.isArray(data.sources)||!Array.isArray(data.offers)||!Array.isArray(data.directory))throw new Error('INVALID_RESULT');
  if(Object.keys(query).some(k=>data.query?.[k]!==query[k])||data.offers.length>1000||data.directory.length>200)throw new Error('INVALID_RESULT');
  const created=Date.parse(data.generatedAt),expires=Date.parse(data.expiresAt),now=Date.now();
  if(!Number.isFinite(created)||!Number.isFinite(expires)||created>now+5000||expires-created!==60000)throw new Error('INVALID_RESULT');
  const offers=data.offers.filter(o=>o.sourceId==='core'&&o.evidence==='core_reported'&&o.bookingEnabled===false&&o.date===query.date&&Number.isSafeInteger(o.priceMinor)&&o.priceMinor>=0&&/^[A-Z]{3}$/.test(o.currency)&&expires>now);
  sourceRows(data.sources);offerBox.replaceChildren();clubBox.replaceChildren();
  for(const offer of offers){
    const card=element('article',undefined,'card');
    card.append(element('span','Core-reported offer','badge'),element('h3',offer.clubName),element('p',offer.courtName),element('p',`${offer.date} · ${offer.displayTime} · ${offer.duration} min`),element('small',`Timezone: ${offer.timezone} · ${offer.startsAt}`),element('p',new Intl.NumberFormat('en-GB',{style:'currency',currency:offer.currency}).format(offer.priceMinor/100),'price'),element('small','Not reserved. No booking or payment is performed here.'));
    offerBox.append(card);
  }
  if(!offers.length)empty(offerBox,'No verified Core offers were returned. This does not mean that other systems or clubs are sold out.');
  for(const club of data.directory){
    const card=element('article',undefined,'card');card.append(element('span','Availability unknown','badge'),element('h3',club.name),element('p',club.area));
    for(const source of Array.isArray(club.sources)?club.sources:[]){
      const url=safeSourceUrl(source.id,source.url);if(!url)continue;
      const label=source.kind==='player_portal'?'Open player portal — choose this club':source.kind==='unclaimed_listing'?'View unclaimed directory entry':'Open club page';
      card.append(link(`${source.label}: ${label}`,url),element('small',`Directory reviewed ${source.reviewedOn}; not an availability timestamp.`));
    }
    const website=safeSourceUrl('club_website',club.website);if(website)card.append(link('Official club website',website));
    clubBox.append(card);
  }
  if(!data.directory.length)empty(clubBox,'No reviewed directory entry matches this area and sport. The initial catalogue is incomplete.');
  status.textContent=localFallback?'Search server unavailable. Showing the local reviewed directory only; no availability check completed.':`${offers.length} native offer${offers.length===1?'':'s'} · ${data.directory.length} listed club${data.directory.length===1?'':'s'} · partial source coverage`;
  if(offers.length){const ticket=generation;expiry=setTimeout(()=>{if(ticket!==generation)return;empty(offerBox,'Offer snapshot expired. Search again to recheck.');status.textContent='Offer snapshot expired. Directory entries remain unverified for availability.';},Math.max(0,expires-now));}
}
form.addEventListener('input',()=>clear('Search changed. Previous offers cleared; press Search to check again.'));
form.addEventListener('change',()=>clear('Search changed. Previous offers cleared; press Search to check again.'));
form.addEventListener('submit',async event=>{
  event.preventDefault();clear('Searching connected sources…');const ticket=generation;
  let query;try{query=validateQuery(Object.fromEntries(new FormData(form)));}catch{status.textContent='Choose a city or club, a valid date within 90 days, and a start-time range.';return;}
  controller=new AbortController();const current=controller;form.querySelector('button').disabled=true;
  try{
    const res=await fetch('/api/gac/search-all?'+new URLSearchParams(query),{method:'GET',cache:'no-store',credentials:'same-origin',signal:current.signal});
    if(!res.ok)throw new Error('SEARCH_UNAVAILABLE');const data=await res.json();if(ticket!==generation)return;render(data,query);
  }catch{
    if(ticket!==generation)return;
    render(mergeResults(query,SOURCES.map(s=>s.id==='core'?{id:s.id,status:'error'}:directorySource(s.id,query))),query,true);
  }finally{if(ticket===generation)form.querySelector('button').disabled=false;}
});
window.addEventListener('pagehide',()=>clear('Previous search cleared.'));
window.addEventListener('pageshow',event=>{if(event.persisted)clear('Previous search cleared. Search again for current results.');});
