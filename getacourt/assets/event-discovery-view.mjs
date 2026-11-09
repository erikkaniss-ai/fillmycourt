import {eventPriceLabel,kindLabel} from './event-discovery.mjs';

export function eventTimeLabel(event){
  if(!event.localStart)return 'Time unconfirmed';
  const a=event.localStart,b=event.localEnd;
  return a.day+' · '+a.time+' '+a.offset+(b?'–'+(b.day!==a.day?b.day+' ':'')+b.time+' '+b.offset:' · end unknown')+' · '+a.timezone;
}
export function eventCountLabel(event){
  const c=event.counts;
  if(!c.proven||c.capacity===null||c.confirmed===null)return 'Capacity and places unknown';
  const count=c.confirmed+' / '+c.capacity+' '+c.unit;
  if(event.kind==='start_open_match')return count+' · No players yet';
  const current=event.freshness==='fresh'&&event.lifecycle==='scheduled'&&event.registration==='open'&&!event.deadlinePassed;
  return (current?'Source count: ':'Last source count: ')+count+(!current?' · places unverified':'');
}
export function renderEventCards(host,events,{onSelect=()=>{},onUnavailable=()=>{}}={}){
  const doc=host.ownerDocument,cards=new Map();
  const make=(tag,value,cls)=>{const e=doc.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;};
  const fact=(dl,label,value)=>dl.append(make('dt',label),make('dd',value));
  host.replaceChildren();
  for(const [index,event] of events.entries()){
    const card=make('article',undefined,'card event-card');card.tabIndex=-1;
    card.id='event-card-'+index;card.dataset.offerKind='event-demo';card.dataset.eventKey=event.key;
    card.dataset.eventMapped=String(Boolean(event.position));card.dataset.eventKind=event.kind;
    const headingId=card.id+'-heading';card.setAttribute('aria-labelledby',headingId);
    const top=make('div',undefined,'card-top');
    top.append(make('span','FICTIONAL DEMO · '+event.sourceName,'badge demo'),
      make('span',kindLabel(event.kind),'event-kind'));
    const title=make('h3',event.title);title.id=headingId;
    card.append(top,title,make('p',event.venue?.name||'Venue unconfirmed','event-venue'),
      make('p',eventTimeLabel(event),'offer-time'),make('p',eventCountLabel(event),'event-count'));
    const status=make('p',event.status,'event-status');
    if(['Cancelled','Full','Stale information','Ended','Registration closed'].includes(event.status))status.classList.add('event-status-limited');
    card.append(status);
    if(event.kind==='player_needed')card.append(make('p','Player-needed notice · no confirmed court or playing time','event-warning'));
    const priceRow=make('div',undefined,'price-row');
    priceRow.append(make('p',eventPriceLabel(event.price),'event-price'));
    if(event.position){const locate=make('button','Show on map','map-card-button');locate.type='button';locate.addEventListener('click',()=>onSelect(event));priceRow.append(locate);}
    card.append(priceRow,make('p',!event.price?'Price and fees unknown':
      event.price.feesStatus==='included'?'Source example says fees included':
      event.price.feesStatus==='additional'?'Additional fees apply · final total unknown':'Fees unknown · recheck the full entry total','event-fees'));
    if(event.price?.changed)card.append(make('p','Price changed in this fictional source example','event-warning'));
    card.append(make('p',event.rating?event.rating.scheme+': '+event.rating.level+' · source scale only':'Source rating unknown','event-rating'));
    const details=make('details',undefined,'event-details');details.append(make('summary','Event details'));
    const dl=make('dl');
    fact(dl,'Organizer',event.organizer);
    fact(dl,'Entry',({solo:'Solo entry',pair:'Enter as a pair',team:'Team entry'})[event.entry]||'Entry format unknown');
    fact(dl,'Play style',event.format==='unknown'?'Unknown':event.format);
    fact(dl,'Source rating',event.rating?event.rating.scheme+' · '+event.rating.level:'Unknown — no conversion');
    fact(dl,'Court',event.court.state==='confirmed'?event.court.name||'Confirmed by source':event.court.state==='pending'?'Assignment pending':'Unconfirmed');
    fact(dl,'Registration deadline',event.localDeadline?event.localDeadline.day+' '+event.localDeadline.time+' '+event.localDeadline.offset+' · '+event.timezone:'Unknown');
    fact(dl,'Eligibility',({eligible:'Eligible in this fictional example',approval_required:'Source approval required',membership_only:'Club membership required',
      partner_pending:'Partner approval pending',ineligible:'Not eligible',unknown:'Eligibility unknown'})[event.eligibility]);
    fact(dl,'Event lifecycle',event.lifecycle);
    fact(dl,'Registration',event.registration+(event.deadlinePassed?' · deadline passed':''));
    fact(dl,'Places',event.counts.remaining===null?'Unknown — no roster inference':event.counts.remaining+' '+event.counts.unit+' last reported; see event status');
    fact(dl,'Freshness','Fictional '+event.freshness+' example · '+(event.observedAt?'checked '+event.observedAt:'check time unknown'));
    fact(dl,'Source updated',event.sourceUpdatedAt||'Unknown');
    fact(dl,'Source identity',event.sourceName+' · '+event.sourceEventId);
    fact(dl,'Event link',event.sourceUrl||'No safe event-level link verified');
    fact(dl,'Access','Fictional fixture only · live event rights unverified');
    details.append(dl);card.append(details);
    const cta=make('button',(event.kind==='start_open_match'?'Start an open game':
      ['tournament','mini_tournament'].includes(event.kind)?'Official registration':'Official game handoff')+' · demo only','event-cta');
    cta.type='button';cta.setAttribute('aria-disabled','true');
    const reason=make('p',event.handoff.reason,'demo-unbookable');reason.id=card.id+'-reason';cta.setAttribute('aria-describedby',reason.id);
    // Focusable for keyboard discovery, but no URL, navigation or registration state mutation.
    cta.addEventListener('click',()=>onUnavailable(event));card.append(cta,reason);
    cards.set(event.key,card);host.append(card);
  }
  return cards;
}
