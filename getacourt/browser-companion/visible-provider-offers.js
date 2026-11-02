// Conservative parser for named first-party PLAYER booking views (not catalogues).
// No requests, hidden API, stored credentials, booking/payment click, or DOM mutation.
// Generic UI rows are accepted only if date+sport+club+court+two times+EUR
// total+explicit actionable "Book"/"Reservar" appear together in visible UI.
(function(root){
  "use strict";
  const origins=Object.freeze({
    tiesports:/^https:\/\/clubs\.tiesports\.com\/(?:en|pt)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/,
    racket_id:/^https:\/\/racket\.id\/booking$/,
    smashpro:/^https:\/\/smashpro\.pt\/pt\/c\/[a-z0-9-]+$/,
    matchi:/^https:\/\/www\.matchi\.se\/facilities\/[a-z0-9_-]+$/
  });
  const safe=(text,max=160)=>typeof text==="string"&&
    text===text.trim()&&text.length>0&&text.length<=max&&!/[\u0000-\u001f]/.test(text);
  const time=(h,m,ap)=>{
    let hours=Number(h),mins=Number(m);
    if(!Number.isInteger(hours)||!Number.isInteger(mins)||mins>59)return null;
    if(ap){if(hours<1||hours>12)return null;hours=(hours%12)+(ap.toUpperCase()==="PM"?12:0);}
    else if(hours>23)return null;
    return hours*60+mins;
  };
  const label=n=>(Math.floor(n/60)%12||12)+":"+String(n%60).padStart(2,"0")+
    (n<720?" AM":" PM");
  // Court-specific text must bind one concrete start/end and one total EUR
  // price to an actionable UI item, rather than a rate table or brochure.
  function parseRow(item){
    if(!item||item.disabled||!safe(item.text,320)||!safe(item.action,40)||
      !/^(?:book|reserve|reservar|reserva|available|dispon[ií]vel)$/i.test(item.action))return null;
    const line=item.text.replace(/\s+/g," ").trim();
    if(/\b(?:sold out|unavailable|not available|occupied|reserved|esgotado|ocupado|indispon[ií]vel|não dispon[ií]vel|no slots)\b/i.test(line))return null;
    const court=/\b(?:court|campo|pista)\s+([A-Za-z0-9-]{1,30})(?=\s|$)/i.exec(line);
    if(!court)return null;
    const times=/\b(\d{1,2}):([0-5]\d)\s*(AM|PM)?\s*[-–—]\s*(\d{1,2}):([0-5]\d)\s*(AM|PM)?\b/i.exec(line);
    if(!times)return null;
    const start=time(times[1],times[2],times[3]);
    const end=time(times[4],times[5],times[6]);
    if(start===null||end===null||start>=end)return null;
    const duration=end-start;
    if(![60,90].includes(duration))return null;
    // Reject partial per-player prices and plural price candidates. Only an
    // explicit sole EUR total from a directly actionable court row is valid.
    if(/\bper\s+(?:player|person)|por\s+(?:jogador|pessoa)|\/pessoa\b/i.test(line))return null;
    // An explicit hourly rate is not the total for this displayed slot.
    if(/\b(?:per\s+(?:hour|hr)|por\s+hora)\b|\/\s*(?:hour|hr|hora|h)\b/i.test(line))return null;
    if((line.match(/€/g)||[]).length!==1)return null;
    // Mask the known court label without moving offsets: its numeric ID is
    // not a price, even when the EUR marker immediately follows that label.
    const priceLine=line.slice(0,court.index)+" ".repeat(court[0].length)+line.slice(court.index+court[0].length);
    // Only a complete supported numeric token may touch the currency marker.
    const prices=[...priceLine.matchAll(/(?:(?<![\p{N}.,'’+−–—*/^%=÷×-])€\s*(\d{1,4})(?:[,.](\d{2}))?(?=$|[\s)\];!?}])|(?<=^|[\s(\[])(\d{1,4})(?:[,.](\d{2}))?\s*€(?=$|[\s)\];!?}]))/gu)];
    if(prices.length!==1)return null;
    const m=prices[0],euros=Number(m[1]||m[3]),cents=Number(m[2]||m[4]||"0");
    // Bind new qualifiers to this sole amount, excluding the identified court
    // label so a court named From or Hourly is not mistaken for a price prefix.
    const before=line.slice(0,m.index).replace(court[0],"");
    const after=line.slice(m.index+m[0].length);
    // Signs, expressions and unlabelled numeric fragments are not totals.
    if(/[+−*/^%÷×=-]\s*$/.test(before)||/^\s*[+−*/^%÷×=-]\s*\d/.test(after)||
      (m[3]&&/(?:^|\s)\d+(?:[,.]\d+)?\s+$/.test(before))||
      (m[1]&&/^\s+\d+(?:[,.]\d+)?(?=\s|$)(?!\s+min(?:ute|uto)?s?\b)/i.test(after)))return null;
    if(/\b(?:from|desde|a\s+partir\s+de|hourly)\s*:?\s*$/i.test(before)||
      /\/\s*(?:hourly|player|person|jogador|pessoa)\s*:?\s*$/i.test(before)||
      /^\s*(?:hourly\b|\/\s*(?:hourly|player|person|jogador|pessoa)\b)/i.test(after))return null;
    const priceMinor=euros*100+cents;
    if(!Number.isSafeInteger(priceMinor)||priceMinor<100||priceMinor>200000)return null;
    const courtName=("Court "+court[1]).replace(/^Court (?:(?:court|campo|pista)\s+)/i,"Court ").trim();
    if(courtName.length>100)return null;
    return {court:courtName,startLabel:label(start),endLabel:label(end),
      durationMinutes:duration,priceEur:priceMinor/100,startMinute:start};
  }
  function buildObservation(data){
    if(!data||!Object.hasOwn(origins,data.provider)||!origins[data.provider].test(data.sourceUrl||"")||
      !safe(data.venue)||!/^\d{4}-\d{2}-\d{2}$/.test(data.date||"")||
      !["Padel","Tennis"].includes(data.sport)||data.selectedDate!==data.date||
      data.selectedSport!==data.sport||
      !/^(?:available\s+(?:courts|time slots)|court\s+booking|reservas?(?:\s+de\s+campos)?|hor[aá]rios?\s+dispon[ií]veis|lediga\s+tider)$/i.test(data.regionTitle||"")||
      !Array.isArray(data.rows)||data.rows.length>120||
      data.claimed===false)return {readerError:"SCHEDULE_NOT_READY"};
    const q=data.query;
    if(!q||q.date!==data.date||q.sport!==data.sport||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(q.from||"")||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(q.to||"")||
      ![0,60,90].includes(q.durationMinutes))return {readerError:"QUERY_INVALID"};
    const from=Number(q.from.slice(0,2))*60+Number(q.from.slice(3));
    const to=Number(q.to.slice(0,2))*60+Number(q.to.slice(3));
    if(from>=to)return {readerError:"QUERY_INVALID"};
    // Check the whole bounded eligible input before applying the unique-output
    // cap: repetitions must neither hide contradictions nor spend that budget.
    const unique=new Map();
    for(const row of data.rows){
      const v=parseRow(row);
      if(!v||v.startMinute<from||v.startMinute>=to||
        (q.durationMinutes&&q.durationMinutes!==v.durationMinutes))continue;
      const key=[v.court,v.startLabel,v.endLabel,v.durationMinutes].join("|");
      if(unique.has(key)&&unique.get(key).priceEur!==v.priceEur)return {readerError:"OFFER_FORMAT_CHANGED"};
      if(!unique.has(key))unique.set(key,v);
    }
    if(!unique.size)return {readerError:"NO_EXPANDED_OFFERS"};
    return {provider:data.provider,source:"user_ui_observation",
      sourceUrl:data.sourceUrl,venue:data.venue,date:data.date,sport:data.sport,
      capturedAt:new Date().toISOString(),timezone:null,
      sourceFreshness:"unknown",coverage:"expanded_offers_only",
      offers:[...unique.values()].slice(0,20).map(({court,startLabel,endLabel,durationMinutes,priceEur})=>
        ({court,startLabel,endLabel,durationMinutes,priceEur}))};
  }
  root.GetACourtVisibleProviderOffers=Object.freeze({buildObservation,parseRow});
  if(typeof module!=="undefined")module.exports=root.GetACourtVisibleProviderOffers;
})(globalThis);
