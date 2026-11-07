// Pure, non-persistent event projection. This slice admits FICTIONAL fixtures only.
// A provider product feature is never an event read/display/join grant.
export const DEMO_PROVIDERS=Object.freeze({
  'demo-alpha':Object.freeze({name:'Demo Source A',origin:'https://source-a.invalid'}),
  'demo-beta':Object.freeze({name:'Demo Source B',origin:'https://source-b.invalid'}),
  'demo-gamma':Object.freeze({name:'Demo Source C',origin:'https://source-c.invalid'}),
  'demo-delta':Object.freeze({name:'Demo Source D',origin:'https://source-d.invalid'})
});
export const EVENT_KINDS=Object.freeze(['open_match','start_open_match','player_needed','tournament','mini_tournament']);
const kinds=new Set(EVENT_KINDS), units=new Set(['person','pair','team','event']);
const text=(v,max=180)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').trim().slice(0,max):'';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(v)?v:null;
const choice=(v,values,fallback='unknown')=>values.includes(v)?v:fallback;
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&validLocalDay(v.slice(0,10))&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const iso=v=>instant(v)===null?null:new Date(instant(v)).toISOString();
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000?v:null;
export const eventKey=(provider,sourceEventId)=>JSON.stringify([provider,sourceEventId]);
export function validLocalDay(day){
  return typeof day==='string'&&/^\d{4}-\d\d-\d\d$/.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
}
export function localEventTime(stamp,timezone){
  const value=instant(stamp);
  if(value===null||typeof timezone!=='string')return null;
  try{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'})
      .formatToParts(value).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    return Object.freeze({day:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute,
      offset:parts.timeZoneName,timezone});
  }catch{return null;}
}
export function safeEventUrl(raw,provider,sourceEventId){
  const source=DEMO_PROVIDERS[provider];
  if(!source||!id(sourceEventId)||typeof raw!=='string')return null;
  // Literal exact event URL only: no query, fragment, userinfo, normalization or club fallback.
  const expected=source.origin+'/events/'+sourceEventId;
  if(raw!==expected)return null;
  try{const u=new URL(raw);return u.origin===source.origin&&u.username===''&&u.password===''?raw:null;}catch{return null;}
}
function sourceCounts(raw){
  const empty={capacity:null,confirmed:null,remaining:null,unit:'unknown',proven:false};
  if(!raw||raw.sourceProven!==true||!['people','pairs','teams'].includes(raw.unit))return Object.freeze(empty);
  const capacity=integer(raw.capacity),confirmed=integer(raw.confirmed),remaining=integer(raw.remaining);
  if((capacity!==null&&((confirmed!==null&&confirmed>capacity)||(remaining!==null&&remaining>capacity)))||
     (capacity!==null&&confirmed!==null&&remaining!==null&&confirmed+remaining!==capacity))return Object.freeze(empty);
  // Never derive missing counts from another count, a roster, or court locks.
  return Object.freeze({capacity,confirmed,remaining,unit:raw.unit,proven:true});
}
function sourcePrice(raw){
  if(!raw||raw.currency!=='EUR'||!units.has(raw.unit)||!Number.isSafeInteger(raw.amountMinor)||raw.amountMinor<0||raw.amountMinor>1000000)return null;
  return Object.freeze({amountMinor:raw.amountMinor,currency:'EUR',unit:raw.unit,
    feesStatus:choice(raw.feesStatus,['included','additional','unknown']),
    changed:raw.changed===true});
}
function identity(raw){
  if(!raw||typeof raw!=='object'||!Object.hasOwn(DEMO_PROVIDERS,raw.provider)||!id(raw.sourceEventId))return null;
  const parent=kinds.has(raw.kind)&&['tournament','mini_tournament'].includes(raw.kind)&&id(raw.parentSourceEventId);
  return {provider:raw.provider,sourceEventId:parent||raw.sourceEventId,parent:Boolean(parent)};
}
const rank=r=>r?.revoked===true?100:r?.lifecycle==='cancelled'?90:r?.lifecycle==='completed'?80:r?.registration==='full'?60:r?.registration==='closed'?50:0;
function later(a,b){
  const aTime=instant(a.sourceUpdatedAt)??instant(a.observedAt)??-Infinity;
  const bTime=instant(b.sourceUpdatedAt)??instant(b.observedAt)??-Infinity;
  return bTime>aTime||(bTime===aTime&&rank(b)>rank(a))?b:a;
}
function normalize(raw,{viewerScope,now}){
  const ident=identity(raw);
  if(!ident||raw.fictional!==true||raw.revoked===true||raw.private===true||!kinds.has(raw.kind))return null;
  const scope=choice(raw.accessScope,['public','personal','private'],'private');
  if(scope==='private'||(scope==='personal'&&(!viewerScope||raw.viewerScope!==viewerScope)))return null;
  const title=text(ident.parent?raw.parentTitle:raw.title), organizer=text(raw.organizer);
  if(!title||!organizer)return null;
  const timezone=text(raw.timezone,80)||null;
  const startsAt=iso(raw.startsAt),endsAt=iso(raw.endsAt),deadline=iso(raw.registrationDeadline);
  const localStart=localEventTime(startsAt,timezone),localEnd=localEventTime(endsAt,timezone);
  if(raw.kind!=='player_needed'&&(!localStart||!localEnd||instant(endsAt)<=instant(startsAt)))return null;
  if(raw.kind==='player_needed'&&((raw.startsAt!=null&&!startsAt)||(raw.endsAt!=null&&!endsAt)||
    (startsAt&&!localStart)||(endsAt&&!localEnd)||(startsAt&&endsAt&&instant(endsAt)<=instant(startsAt))))return null;
  const observedAt=iso(raw.observedAt),validUntil=iso(raw.validUntil),sourceUpdatedAt=iso(raw.sourceUpdatedAt);
  const freshness=!observedAt||!validUntil||instant(observedAt)>now?'unknown':instant(validUntil)<=now?'stale':'fresh';
  const counts=sourceCounts(raw.counts);
  let kind=raw.kind;
  if(kind==='open_match'&&counts.proven&&counts.confirmed===0&&counts.capacity===4&&counts.unit==='people')kind='start_open_match';
  const lifecycle=choice(raw.lifecycle,['scheduled','cancelled','completed','draft']);
  const registration=choice(raw.registration,['open','full','waitlist','closed','pending','unknown']);
  const deadlinePassed=deadline!==null&&instant(deadline)<=now;
  const eligibility=choice(raw.eligibility,['eligible','approval_required','membership_only','partner_pending','ineligible']);
  let venue=null;
  if(raw.venue&&id(raw.venue.id)&&text(raw.venue.name)){
    const p=raw.venue.position;
    const position=p?.fictional===true&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180
      ?Object.freeze({lat:p.lat,lon:p.lon,fictional:true}):null;
    venue=Object.freeze({id:raw.venue.id,key:eventKey(raw.provider,raw.venue.id),name:text(raw.venue.name),position});
  }
  const court=Object.freeze({state:ident.parent?'unknown':choice(raw.court?.state,['confirmed','pending','unknown']),
    name:!ident.parent&&raw.court?.state==='confirmed'?text(raw.court.name,100)||null:null});
  const sourceUrl=safeEventUrl(ident.parent?raw.parentSourceUrl:raw.sourceUrl,ident.provider,ident.sourceEventId);
  const rights=Object.freeze(Object.fromEntries(['eventRead','redisplay','personalScope','liveCapacity','eligibility','priceBasis','eventDeeplink','joinWrite','freshness']
    .map(k=>[k,choice(raw.rights?.[k],['verified','unverified','unsupported'],'unverified')])));
  const rating=raw.rating&&text(raw.rating.scheme,80)&&text(raw.rating.level,80)
    ?Object.freeze({scheme:text(raw.rating.scheme,80),level:text(raw.rating.level,80)}):null;
  const blocked=lifecycle==='cancelled'?'Cancelled':lifecycle==='completed'||(endsAt&&instant(endsAt)<=now)?'Ended':
    freshness==='stale'?'Stale information':registration==='full'||(counts.proven&&counts.remaining===0&&registration!=='waitlist')?'Full':
    registration==='waitlist'?'Waitlist':deadlinePassed||registration==='closed'?'Registration closed':
    eligibility==='approval_required'?'Approval required':eligibility==='membership_only'?'Members only':
    eligibility==='partner_pending'?'Partner approval pending':eligibility==='ineligible'?'Not eligible':
    registration==='pending'?'Registration pending':registration==='open'?'Source reports open registration':'Registration unknown';
  return Object.freeze({key:eventKey(ident.provider,ident.sourceEventId),provider:ident.provider,sourceEventId:ident.sourceEventId,
    sourceName:DEMO_PROVIDERS[ident.provider].name,kind,title,organizer,venue,position:venue?.position||null,
    area:text(raw.area,100),sport:choice(raw.sport,['padel','tennis'],'unknown'),
    format:choice(raw.format,['social','competitive']),entry:choice(raw.entry,['solo','pair','team']),
    timezone,startsAt,endsAt,localStart,localEnd,registrationDeadline:deadline,
    localDeadline:localEventTime(deadline,timezone),counts,price:sourcePrice(raw.price),rating,court,
    eligibility,lifecycle,registration,freshness,deadlinePassed,status:blocked,
    observedAt,sourceUpdatedAt,validUntil,rights,sourceUrl,fictional:true,
    // Deliberately no enabled live CTA or read path, even for a forged verified-right fixture.
    handoff:Object.freeze({enabled:false,url:sourceUrl,reason:'Fictional demo — registration and payments are unavailable'})});
}
export function projectEvents(records,{mode='real',viewerScope=null,now=Date.now()}={}){
  if(mode!=='demo'||!Array.isArray(records)||!Number.isFinite(now))return [];
  const latest=new Map();
  for(const raw of records.slice(0,200)){
    const ident=identity(raw);if(!ident)continue;
    const key=eventKey(ident.provider,ident.sourceEventId);
    latest.set(key,latest.has(key)?later(latest.get(key),raw):raw);
  }
  // Dedupe/tombstones precede access projection: an older visible row cannot resurface after revocation.
  return [...latest.values()].map(raw=>normalize(raw,{viewerScope,now})).filter(Boolean);
}
export function projectEventSources(records,{mode='real'}={}){
  if(mode!=='demo'||!Array.isArray(records))return [];
  const latest=new Map(),sources=[];
  const sourceRank=raw=>raw?.revoked===true||raw?.private===true||raw?.accessScope!=='public'?3:raw?.state==='offline'?2:raw?.state==='empty'?1:0;
  for(const raw of records.slice(0,16)){
    if(!raw||!Object.hasOwn(DEMO_PROVIDERS,raw.provider))continue;
    const previous=latest.get(raw.provider);
    const stamp=instant(raw.checkedAt)??-Infinity,previousStamp=instant(previous?.checkedAt)??-Infinity;
    if(!previous||stamp>previousStamp||(stamp===previousStamp&&sourceRank(raw)>sourceRank(previous)))latest.set(raw.provider,raw);
  }
  for(const raw of latest.values()){
    if(raw.fictional!==true||raw.accessScope!=='public'||raw.private===true||raw.revoked===true)continue;
    const state=choice(raw.state,['examples','offline','empty'],'unknown');
    const row=Object.freeze({provider:raw.provider,name:DEMO_PROVIDERS[raw.provider].name,state,
      checkedAt:iso(raw.checkedAt),fictional:true,
      message:state==='offline'?'Offline fictional example — other sources may still have events':
        state==='empty'?'Empty fictional response — not a provider-wide sold-out claim':
        state==='examples'?'Local fictional event examples — no live source was queried':'Fictional source state unknown'});
    sources.push(row);
  }
  return sources;
}
const minute=t=>typeof t==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)?Number(t.slice(0,2))*60+Number(t.slice(3)):null;
export function filterEvents(events,{intent='games',location='',sport='padel',date='',from='00:00',to='23:59',
  entry='any',format='any',rating='any',space='any',priceUnit='any',budget='any',includeUnscheduled=true,
  origin=null,radius='any',sort='time',distance=()=>null}={}){
  const place=text(location).toLowerCase(),lo=minute(from),hi=minute(to);
  if((date&&!validLocalDay(date))||lo===null||hi===null||lo>=hi||
    !['games','tournaments'].includes(intent)||!['padel','tennis'].includes(sport)||
    !['any','solo','pair','team'].includes(entry)||!['any','social','competitive'].includes(format)||
    !['any','known','unknown','waitlist'].includes(space)||!['any','person','pair','team','event'].includes(priceUnit)||
    !['time','price','distance'].includes(sort)||
    (budget!=='any'&&(!/^\d+(?:\.\d{1,2})?$/.test(String(budget))||!Number.isFinite(Number(budget))))||
    (radius!=='any'&&(!/^\d+(?:\.\d{1,2})?$/.test(String(radius))||!Number.isFinite(Number(radius)))))return [];
  const result=[];
  for(const event of events||[]){
    if(event.fictional!==true||(['tournament','mini_tournament'].includes(event.kind))!==(intent==='tournaments'))continue;
    if(event.sport!==sport|| (place&&place!=='demo'&&![event.area,event.venue?.name,event.title].some(s=>s?.toLowerCase().includes(place))))continue;
    if(!event.localStart){if(!includeUnscheduled||event.kind!=='player_needed')continue;}
    else if((date&&event.localStart.day!==date)||minute(event.localStart.time)<lo||minute(event.localStart.time)>=hi)continue;
    if(entry!=='any'&&event.entry!==entry||format!=='any'&&event.format!==format)continue;
    if(rating!=='any'&&JSON.stringify([event.provider,event.rating?.scheme,event.rating?.level])!==rating)continue;
    if(priceUnit!=='any'&&event.price?.unit!==priceUnit)continue;
    if(budget!=='any'&&(!event.price||event.price.amountMinor>Number(budget)*100))continue;
    if(space==='known'&&(!event.counts.proven||!(event.counts.remaining>0)||event.freshness!=='fresh'||event.lifecycle!=='scheduled'||event.registration!=='open'||event.deadlinePassed))continue;
    if(space==='unknown'&&event.counts.remaining!==null)continue;
    if(space==='waitlist'&&event.registration!=='waitlist')continue;
    const d=distance(origin,event.position);
    if(origin&&radius!=='any'&&(d===null||d>Number(radius)))continue;
    result.push(Object.freeze({...event,distance:d}));
  }
  return result.sort((a,b)=>(sort==='distance'?(a.distance??Infinity)-(b.distance??Infinity):sort==='price'?
    (a.price?.unit||'zz').localeCompare(b.price?.unit||'zz')||(a.price?.amountMinor??Infinity)-(b.price?.amountMinor??Infinity):
    (instant(a.startsAt)??Infinity)-(instant(b.startsAt)??Infinity))||a.title.localeCompare(b.title)||a.key.localeCompare(b.key));
}
export function groupEventVenues(events){
  const groups=new Map();
  for(const event of events||[])if(event.position&&event.venue){
    const key=event.venue.key;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(event);
  }
  return groups;
}
export function eventActivity(type,evidence={}){
  const types=['detail_viewed','official_handoff_clicked','application_pending','waitlisted','user_reported_registration','source_confirmed_registration'];
  if(!types.includes(type))return null;
  if(type==='source_confirmed_registration'&&!(evidence.sourceVerified===true&&id(evidence.evidenceRef)))return null;
  return Object.freeze({type,registrationConfirmed:type==='source_confirmed_registration',saleConfirmed:false,
    outcome:type==='official_handoff_clicked'?'unknown':type});
}
export function eventPriceLabel(price){
  if(!price)return 'Entry price unknown';
  return new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(price.amountMinor/100)+
    ' / '+({person:'player',pair:'pair',team:'team',event:'event'}[price.unit]);
}
export const kindLabel=kind=>({open_match:'Join a game',start_open_match:'Start an open game',player_needed:'Player needed',
  tournament:'Tournament',mini_tournament:'Mini-tournament'}[kind]||'Event');
