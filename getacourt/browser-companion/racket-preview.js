// Read the already-open ordinary Racket ID Select courts preview only.
// Never select a court, Continue, reserve, navigate, or inspect app/session state.
(function(root){
  'use strict';
  const clean=s=>String(s||'').replace(/[\uE000-\uF8FF]/g,'').trim();
  function buildObservation(header,rows,q,now=Date.now()){
    const fail=code=>({readerError:code});
    if(!q||!/^\d{4}-\d{2}-\d{2}$/.test(q.date||'')||q.sport!=='Padel'||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(q.from||'')||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(q.to||''))return fail('QUERY_INVALID');
    const day=new Date(q.date+'T12:00:00Z');
    const today=new Date(now).toISOString().slice(0,10);
    if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==q.date||
      q.date<today||day.getTime()>now+15*86400000)return fail('DATE_AMBIGUOUS');
    const dateLabel=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(day).replace(/,/g,'');
    const lines=String(header).split('\n').map(clean).filter(Boolean);
    if(lines.length!==5||lines[0]!==dateLabel||!/^Padel \d{1,3}$/.test(lines[3])||
      !lines[4]||lines[4].length>160)return fail('OFFER_FORMAT_CHANGED');
    const times=/^((?:[01]\d|2[0-3]):[0-5]\d)[-–]((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(lines[1]);
    const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
    if(!times)return fail('OFFER_FORMAT_CHANGED');
    const start=minutes(times[1]),end=minutes(times[2]),duration=end-start;
    if(![60,90].includes(duration)||lines[2]!==duration+' min'||
      (q.durationMinutes&&q.durationMinutes!==duration)||start<minutes(q.from)||
      start>=minutes(q.to))return fail('NO_EXPANDED_OFFERS');
    if(!Array.isArray(rows)||!rows.length||rows.length>20)return fail('NO_EXPANDED_OFFERS');
    const label=n=>(Math.floor(n/60)%12||12)+':'+String(n%60).padStart(2,'0')+(n<720?' AM':' PM');
    const offers=new Map();
    for(const text of rows){
      const parts=String(text).split('\n').map(clean).filter(Boolean);
      // Exact inspected visible card contract. Reject extra prices, fees,
      // discounts, per-person quotes, unavailable and unreviewed descriptions.
      if(parts.length!==4||!/^Padel \d{1,3}$/.test(parts[0])||
        parts[1]!=='Roofed'||parts[2]!=='No description')return fail('OFFER_FORMAT_CHANGED');
      const money=/^(\d{1,4})(?:[.,](\d{1,2}))? eur$/i.exec(parts[3]);
      if(!money)return fail('OFFER_FORMAT_CHANGED');
      const cents=Number(money[1])*100+Number((money[2]||'').padEnd(2,'0'));
      if(cents<100||cents>200000||offers.has(parts[0]))return fail('OFFER_FORMAT_CHANGED');
      offers.set(parts[0],{court:parts[0],startLabel:label(start),endLabel:label(end),durationMinutes:duration,priceEur:cents/100});
    }
    return {provider:'racket_id',source:'user_ui_observation',sourceUrl:'https://racket.id/booking',
      venue:lines[4],date:q.date,sport:'Padel',capturedAt:new Date(now).toISOString(),
      timezone:null,sourceFreshness:'unknown',coverage:'expanded_offers_only',offers:[...offers.values()]};
  }
  function readPreview(q){
    if(location.href!=='https://racket.id/booking')return {readerError:'CLUB_PAGE_REQUIRED'};
    const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
    const leaves=[...document.querySelectorAll('div')].filter(e=>!e.children.length&&visible(e));
    const dialogs=leaves.filter(e=>e.innerText.trim()==='Select courts').map(e=>{
      let p=e.parentElement;
      for(let i=0;p&&i<5;i++,p=p.parentElement){
        const t=p.innerText;
        if(t.split('\n').some(s=>s.trim()==='Cancel')&&t.split('\n').some(s=>s.trim()==='Continue'))return p;
      }
    }).filter(Boolean);
    if(dialogs.length!==1)return {readerError:'OFFER_SECTION_MISSING'};
    const dialog=dialogs[0];
    const local=leaves.filter(e=>dialog.contains(e));
    const dates=local.filter(e=>/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/.test(e.innerText.trim()));
    if(dates.length!==1)return {readerError:'DATE_AMBIGUOUS'};
    let header='',parent=dates[0].parentElement;
    for(let i=0;parent&&parent!==dialog&&i<5;i++,parent=parent.parentElement){
      const parts=parent.innerText.split('\n').map(clean).filter(Boolean);
      if(parts.length===5&&/^Padel \d{1,3}$/.test(parts[3])){header=parent.innerText;break;}
    }
    const prices=local.filter(e=>/\beur\b/i.test(e.innerText));
    const rows=prices.map(e=>{
      let p=e.parentElement;
      for(let i=0;p&&p!==dialog&&i<6;i++,p=p.parentElement){
        const parts=p.innerText.split('\n').map(clean).filter(Boolean);
        if(parts.some(s=>/^Padel \d{1,3}$/.test(s)))return p.innerText;
      }
      return '';
    });
    return buildObservation(header,rows,q);
  }
  root.GetACourtRacketPreview=Object.freeze({buildObservation,readPreview});
  if(typeof module!=='undefined')module.exports=root.GetACourtRacketPreview;
})(globalThis);
