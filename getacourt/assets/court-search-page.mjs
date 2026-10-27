import {validateQuery,localDay} from './federated-search.mjs';
const form=document.querySelector('#search'),status=document.querySelector('#searchStatus');
const offers=document.querySelector('#offers'),sources=document.querySelector('#sourceStatus');
const date=form.elements.namedItem('date');date.value=date.min=localDay();
date.max=new Date(Date.parse(date.min+'T00:00:00Z')+90*86400000).toISOString().slice(0,10);
let generation=0,controller=null,timer=null;
const element=(tag,text,css)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(css)e.className=css;return e;};
const labels={ok:'Checked',not_configured:'Not connected',directory_only:'Not connected',personal_reader_only:'Not connected',needs_auth:'Access unavailable',timeout:'Timed out',error:'Temporarily unavailable',invalid_response:'Response could not be verified'};
function clear(message){generation++;controller?.abort();controller=null;clearTimeout(timer);timer=null;offers.replaceChildren();sources.replaceChildren();status.textContent=message;form.querySelector('button').disabled=false;}
function bookingUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash?u.href:null;}catch{return null;}}
function render(data,query,ticket){
  const now=Date.now(),created=Date.parse(data?.generatedAt),until=Date.parse(data?.expiresAt);
  if(data?.version!=='gac-federated-search/v1'||data.complete!==false||data.bookingEnabled!==false||
    !Array.isArray(data.offers)||data.offers.length>1000||!Array.isArray(data.sources)||data.sources.length>10||
    Object.keys(query).some(k=>data.query?.[k]!==query[k])||!Number.isFinite(created)||created>now+5000||until-created!==60000||until<=now)throw Error('INVALID_RESULT');
  sources.replaceChildren();
  for(const source of data.sources){const card=element('article',undefined,'source');
    card.append(element('strong',source.label),element('span',labels[source.status]||labels.invalid_response));
    if(source.failedFeeds)card.append(element('small','Some club sources could not be checked.'));
    sources.append(card);
  }
  const accepted=data.offers.filter(o=>['core_reported','club_feed'].includes(o.evidence)&&
    ((o.sourceId==='core'&&o.evidence==='core_reported')||(o.sourceId==='club_internal'&&o.evidence==='club_feed'))&&
    o.bookingEnabled===false&&o.date===query.date&&o.sport===query.sport&&Number.isSafeInteger(o.priceMinor)&&o.priceMinor>=0&&
    /^[A-Z]{3}$/.test(o.currency)&&Number.isFinite(Date.parse(o.startsAt))&&Date.parse(o.startsAt)>now&&[60,90].includes(o.duration));
  function paint(){
    if(ticket!==generation)return;
    const t=Date.now(),current=accepted.filter(o=>Math.min(until,Date.parse(o.expiresAt||data.expiresAt))>t);
    offers.replaceChildren();
    for(const o of current){const card=element('article',undefined,'card');
      card.append(element('span',o.sourceId==='core'?'FillMyCourt / Core':'Club availability feed','badge'),
        element('h3',o.clubName),element('p',o.courtName),element('p',`${o.date} · ${o.displayTime} · ${o.duration} min`),
        element('p',new Intl.NumberFormat('en-GB',{style:'currency',currency:o.currency}).format(o.priceMinor/100),'price'));
      if(o.observedAt)card.append(element('small','Source checked: '+o.observedAt));
      const url=o.evidence==='club_feed'?bookingUrl(o.handoffUrl):null;
      if(url){const a=element('a','Open club booking');a.href=url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
      offers.append(card);
    }
    if(!current.length)offers.append(element('p',accepted.length?'Offers expired. Search again to recheck.':'No verified available courts were returned for this search.','empty'));
    const connected=data.sources.some(s=>s.status==='ok');
    status.textContent=accepted.length&&!current.length?'Offers expired. Search again to recheck.':!connected?
      'Court availability is not connected for this search yet. No free courts have been verified.':`${current.length} court offer${current.length===1?'':'s'} · partial coverage`;
    if(current.length){const next=Math.min(...current.map(o=>Math.min(until,Date.parse(o.expiresAt||data.expiresAt))));timer=setTimeout(paint,Math.max(1,next-t));}
  }
  paint();
}
form.addEventListener('input',()=>clear('Search changed. Find courts again to check current offers.'));
form.addEventListener('change',()=>clear('Search changed. Find courts again to check current offers.'));
form.addEventListener('submit',async event=>{
  event.preventDefault();clear('Checking court availability…');const ticket=generation;
  let query;try{query=validateQuery(Object.fromEntries(new FormData(form)));}catch{status.textContent='Choose a place, a valid date and a start-time range.';return;}
  controller=new AbortController();const active=controller;form.querySelector('button').disabled=true;
  try{const r=await fetch('/api/gac/search-all?'+new URLSearchParams(query),{method:'GET',cache:'no-store',credentials:'same-origin',signal:active.signal});
    if(!r.ok)throw Error('SEARCH_UNAVAILABLE');const data=await r.json();if(ticket!==generation)return;render(data,query,ticket);
  }catch{if(ticket===generation){offers.replaceChildren();sources.replaceChildren();status.textContent='Search is temporarily unavailable. No court availability has been verified.';}}
  finally{if(ticket===generation)form.querySelector('button').disabled=false;}
});
window.addEventListener('pagehide',()=>clear('Search again to check current offers.'));
window.addEventListener('pageshow',event=>{if(event.persisted)clear('Search again to check current offers.');});
