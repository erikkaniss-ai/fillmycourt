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
let query=null,revision=0,pendingBridge=null,pendingAuto=null,autoAckTimer=null,autoResultTimer=null,timer=null,additionalPending=null,additionalTimer=null;
const additionalStates=new Map();
const observations=new Map();
const make=(tag,label,cls)=>{const el=document.createElement(tag);if(label!==undefined)el.textContent=String(label);if(cls)el.className=cls;return el;};
const allowed=()=>Boolean(query);
function clearPending(){
  pendingBridge=null;
  delete document.documentElement.dataset.gacPersonalBridgeRequest;
}
function cancelAuto(){
  clearTimeout(autoAckTimer);clearTimeout(autoResultTimer);
  autoAckTimer=autoResultTimer=null;pendingAuto=null;
}
function cancelAdditional(){
  clearTimeout(additionalTimer);additionalTimer=null;additionalPending=null;
}
// Only bounded protocol fields may reach the UI; never render raw exceptions.
const readerCodes=new Set(['REQUEST_REJECTED','CONNECT_REQUIRED','SITE_ACCESS_REQUIRED',
  'READ_BUSY','RATE_LIMITED','CONSENT_WITHDRAWN','QUERY_INVALID','READ_FAILED',
  'READER_UNAVAILABLE','CHALLENGE_REQUIRED','TAB_ACCESS_REQUIRED',
  'COMPACT_VIEW_REQUIRED','NO_EXPANDED_OFFERS','OFFER_SECTION_MISSING','SCHEDULE_NOT_READY']);
const readerCode=result=>readerCodes.has(result?.code)?result.code:'UNKNOWN';
const readerVersion=result=>typeof result?.version==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(result.version)
  ?' · Reader '+result.version:' · Reader version not reported';
function autoError(result){
  const code=result?.code;
  return ({
    CONNECT_REQUIRED:'Connect Playtomic once: open its official club page, sign in, then select Connect in the GetACourt extension.',
    SITE_ACCESS_REQUIRED:'Allow Playtomic site access once from the GetACourt extension icon.',
    RATE_LIMITED:'Playtomic was checked recently. Wait up to 60 seconds before searching again.',
    CHALLENGE_REQUIRED:'Playtomic needs you to sign in or complete its own security check. No automatic bypass is attempted.',
    TAB_ACCESS_REQUIRED:'The Playtomic page could not be loaded. Check your browser and connection.',
    COMPACT_VIEW_REQUIRED:'The Playtomic club layout could not be prepared. Open it in a narrow Chrome window.',
    NO_EXPANDED_OFFERS:'No explicit priced offers found in the inspected portion of this club. Other slots may exist.',
    OFFER_SECTION_MISSING:'Playtomic has changed its visible booking layout; offers could not be verified.',
    SCHEDULE_NOT_READY:'Playtomic did not confirm the requested date or sport. Search again later.',
    READ_BUSY:'A Playtomic search is already running. Finish that search first.'
  })[code]||'This provider search could not be verified ('+readerCode(result)+'). Check the Playtomic page or connection.';
}
function startAutomaticSearch(){
  if(!query)return;
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
  const request={nonce,query,revision,acked:false};
  cancelAuto();cancelAdditional();pendingAuto=request;
  additionalPending={nonce,query,revision};
  additionalTimer=setTimeout(()=>{
    if(additionalPending?.nonce===nonce){
      additionalPending=null;
      additionalStates.set('additional','Additional provider search timed out; connection and availability unverified');
      renderSources();
    }
  },45000);
  status.textContent='Searching your connected personal booking systems…';
  window.dispatchEvent(new CustomEvent('gac:additional-sources-request',{detail:{nonce,query}}));
  autoAckTimer=setTimeout(()=>{
    if(pendingAuto!==request||request.acked)return;
    cancelAuto();
    personalStatus.textContent='GetACourt Reader did not acknowledge this search. Browser connection and availability are unverified.';
  },1500);
  window.dispatchEvent(new CustomEvent('gac:auto-search-request',{detail:{nonce,query}}));
}
window.addEventListener('gac:auto-search-accepted',event=>{
  const request=pendingAuto;
  if(!request||event.detail?.nonce!==request.nonce||request.revision!==revision)return;
  request.acked=true;clearTimeout(autoAckTimer);autoAckTimer=null;
  personalStatus.textContent='Reading only the normal Playtomic court-search interface in your browser…';
  autoResultTimer=setTimeout(()=>{
    if(pendingAuto!==request)return;
    cancelAuto();
    personalStatus.textContent='Playtomic search did not finish in time. The site may need attention. No result is assumed.';
  },45000);
});
window.addEventListener('gac:auto-search-response',event=>{
  const request=pendingAuto,detail=event.detail;
  if(!request||!detail||detail.nonce!==request.nonce||
     request.revision!==revision||query!==request.query)return;
  cancelAuto();
  if(detail.result?.status==='observed'){
    // Compatibility with existing single-club reader in the protected beta.
    let raw;
    try{raw=JSON.stringify(detail.result.observation);}catch{
      personalStatus.textContent='The player observation could not be validated.';return;
    }
    if(importPersonal(raw,request.query,request.revision))
      status.textContent='Verified personal observation received. Select a court to continue with Playtomic.';
  }else if(detail.result?.status==='partial'&&Array.isArray(detail.result.sources)){
    // One first-party Playtomic site grant, several independently checked named
    // clubs. Absence of an offer from a club is NEVER a sold-out claim.
    const checked=detail.result.sources.slice(0,4);
    let accepted=0,unavailable=0;
    for(const result of checked){
      if(result?.provider!=='playtomic'){unavailable++;continue;}
      if(result.status==='observed'){
        let raw;
        try{raw=JSON.stringify(result.observation);}catch{raw='';}
        if(raw&&importPersonal(raw,request.query,request.revision))accepted++;
        else unavailable++;
      }else unavailable++;
    }
    if(accepted>0){
      status.textContent='Compared '+checked.length+' reviewed Playtomic club(s); '+accepted+
        ' supplied fresh personally observed priced court offers. Confirm on the official site.';
      personalStatus.textContent=unavailable+
        ' club(s) incomplete or unverified; no provider-wide sold-out conclusion.';
    }else if(checked.length===0){
      status.textContent='No reviewed Playtomic club in this exact area yet. Try Cascais, Parede, Carcavelos or Alcabideche.';
      personalStatus.textContent='No availability claim was made for unsupported areas.';
    }else{
      status.textContent='Checked '+checked.length+
        ' reviewed Playtomic club page(s), but no complete priced offer was verified.';
      personalStatus.textContent='One or more clubs require a valid login, compatible booking layout or a different date. Other slots may exist.';
    }
  }else{
    personalStatus.textContent=autoError(detail.result)+readerVersion(detail.result);
    status.textContent='No verified available offers received. Other courts may exist.';
  }
});

window.addEventListener('gac:additional-sources-response',event=>{
  const pending=additionalPending,detail=event?.detail;
  if(!pending||!detail||detail.nonce!==pending.nonce||
    pending.revision!==revision||pending.query!==query)return;
  cancelAdditional();
  const result=detail.result,entries=result?.sources;
  const version=readerVersion(result);
  let failure;
  if(result?.status==='unavailable')
    failure='Additional provider search failed ('+readerCode(result)+'); connection and availability unverified';
  else if(result?.status!=='partial'||!Array.isArray(entries)||entries.length>4)
    failure='Additional provider response unsupported; connection and availability unverified';
  else if(!entries.length)
    failure='No additional booking sources reported by Reader; connection and availability unverified';
  if(failure){
    additionalStates.set('additional',failure+version);
    renderSources();return;
  }
  const supported=new Set(['tiesports','racket_id','smashpro','matchi']);
  let accepted=0,checked=0;
  for(const row of entries){
    if(!row||!supported.has(row.provider))continue;
    checked++;
    if(row.status==='observed'){
      let raw;
      try{raw=JSON.stringify(row.observation);}catch{raw='';}
      if(raw&&importPersonal(raw,pending.query,pending.revision)){
        accepted++;additionalStates.set(row.provider,'Fresh player-visible priced observation · partial'+version);
      }else additionalStates.set(row.provider,'Client observation rejected; availability unverified'+version);
    }else{
      const reasons={
        SITE_ACCESS_REQUIRED:'Chrome site permission not granted',
        CHALLENGE_REQUIRED:'Provider sign-in or security check required',
        OFFER_SECTION_MISSING:'Booking layout unsupported; no verified slots',
        DATE_AMBIGUOUS:'Exact date not verified in player UI',
        SPORT_AMBIGUOUS:'Sport not verified in player UI',
        SCHEDULE_NOT_READY:'Provider booking filters not confirmed',
        NO_EXPANDED_OFFERS:'No complete priced offers in inspected UI subset',
        SOURCE_UNCLAIMED:'Club listing unclaimed; not a booking source',
        RATE_LIMITED:'Wait before rechecking this provider'
      };
      additionalStates.set(row.provider,(reasons[row.code]||'Provider unavailable or not verified')+version);
    }
  }
  if(!checked)additionalStates.set('additional',
    'Additional provider response unsupported; connection and availability unverified'+version);
  if(accepted>0)status.textContent='Retrieved '+accepted+' additional player-visible source(s). Recheck on the official booking site.';
  renderSources();
});

function clearOffers(message){
  revision++;clearPending();cancelAuto();cancelAdditional();additionalStates.clear();clearTimeout(timer);timer=null;
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
  const has=id=>[...observations.values()].some(record=>record.sourceId===id);
  const text=(id,initial)=>has(id)?'Player-visible offer loaded · partial · expires shortly':
    additionalStates.get(id)||(id!=='playtomic'&&additionalStates.get('additional'))||initial;
  const names=[
    ['Playtomic',text('playtomic','One login for up to four reviewed Cascais-area clubs per Find; additional areas are not verified')],
    ['TiePlayer / TieSports',text('tiesports','Not connected: open an official player booking page and grant access once')],
    ['Racket ID',text('racket_id','Not connected: player booking UI access unverified')],
    ['Smashpro',text('smashpro','Not connected: only claimed, real bookable club pages qualify')],
    ['MATCHi',text('matchi','Not connected: client booking UI read not yet live-accepted')]
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
    const names={playtomic:'Playtomic',tiesports:'TiePlayer / TieSports',racket_id:'Racket ID',
      smashpro:'Smashpro',matchi:'MATCHi'};
    card.append(make('span',(names[o.sourceId]||'Unknown source')+' · personally observed · partial','badge'),
      make('h3',o.clubName),make('p','Court: '+o.courtName),
      make('p',o.date+' · '+o.startLabel+'–'+o.endLabel+' · '+o.duration+' min'),
      make('p',new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(o.priceMinor/100),'price'),
      make('small','Observed '+captured+' UTC · provider freshness/timezone unknown · not reserved'));
    const a=make('a','Continue on '+(names[o.sourceId]||'official provider')+' (recheck availability)');
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
  status.textContent='Searching reviewed clubs through your own first-party Playtomic browser session. No server inventory request was made.';
  personalStatus.textContent='Waiting for the installed GetACourt Reader to respond.';
  startAutomaticSearch();
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
  let raw;
  try{raw=JSON.stringify(detail.observation);}catch{personalStatus.textContent='Invalid browser observation.';return;}
  if(importPersonal(raw,request.query,request.revision)){
    // Synchronous confirmation is consumed by the injected extension script.
    window.dispatchEvent(new CustomEvent('gac:personal-observation-accepted',{detail:{nonce:request.nonce}}));
    clearPending();
  }
});
byId('comparePersonal').addEventListener('click',()=>{
  if(!allowed()){personalStatus.textContent='Prepare a search first.';payload.value='';return;}
  cancelAuto();
  importPersonal(payload.value,query,revision);
});
byId('clearPersonal').addEventListener('click',()=>clearOffers('Personal observations cleared. No provider account was signed out.'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)paint();});
window.addEventListener('pagehide',()=>reset('Page closed. Personal observations cleared.'));
window.addEventListener('pageshow',event=>{if(event.persisted)reset('Page restored. Search again to avoid stale offers.');});
