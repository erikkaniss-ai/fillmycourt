// Non-network fictional snapshots: exact first-party source, visible dated
// sport/court/total-price, no booking writes, no provider API assumptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {normalizePersonalObservation} from '../assets/personal-observation-bridge.mjs';
import {safeSourceUrl} from '../assets/source-catalog.mjs';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../browser-companion/visible-provider-offers.js',import.meta.url),'utf8');
const compiled=vm.createContext({Date});
vm.runInContext(source,compiled);
const {buildObservation,parseRow}=compiled.GetACourtVisibleProviderOffers;
const validation=require('../assets/personal-source-observation.js').validateObservation;
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const query={location:'Oeiras',date,sport:'padel',from:'08:00',to:'23:00',duration:'90'};
const row={text:'Campo 1 18:00 – 19:30 90 min €36,00',action:'Reservar',disabled:false};
const base={provider:'tiesports',sourceUrl:'https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy',
 venue:'OPA OEIRAS',date,sport:'Padel',selectedDate:date,selectedSport:'Padel',
 regionTitle:'Reservas de campos',rows:[row],
 query:{date,sport:'Padel',from:'08:00',to:'23:00',durationMinutes:90}};

test('TieSports normal player-visible priced row normalizes into observed-only court',()=>{
  const obs=buildObservation(base);
  assert.equal(obs.readerError,undefined);
  assert.equal(obs.provider,'tiesports');
  assert.equal(obs.offers.length,1);
  assert.equal(obs.offers[0].court,'Court 1');
  assert.equal(obs.offers[0].priceEur,36);
  assert.equal(obs.offers[0].startLabel,'6:00 PM');
  assert.equal(obs.offers[0].endLabel,'7:30 PM');
  const v=validation(obs);
  assert.equal(v.provider,'tiesports');
  const result=normalizePersonalObservation(JSON.stringify(v),query,{now:Date.now(),validator:validation});
  assert.equal(result.sourceId,'tiesports');
  assert.equal(result.offers[0].clubName,'OPA OEIRAS');
  assert.equal(result.offers[0].sourceUrl,base.sourceUrl);
  assert.equal(result.offers[0].bookingEnabled,false);
  assert.equal(result.offers[0].startsAt,null);
});
test('MATCHi exact official venue page supported for explicit EUR UI rows; not a global feed',()=>{
  const obs=buildObservation({...base,provider:'matchi',
    sourceUrl:'https://www.matchi.se/facilities/cloptonpadel',
    venue:'Clopton Padel',regionTitle:'Available time slots',
    rows:[{text:'Court 2 6:00 PM - 7:30 PM €40 Book',action:'Book'}]});
  assert.equal(obs.readerError,undefined);
  assert.equal(obs.offers[0].priceEur,40);
  assert.equal(validation(obs).provider,'matchi');
  assert.equal(safeSourceUrl('matchi',obs.sourceUrl),obs.sourceUrl);
  assert.throws(()=>normalizePersonalObservation(JSON.stringify(obs),query,
    {now:Date.now(),validator:validation}),/OBSERVATION_LOCATION_MISMATCH/);
  const result=normalizePersonalObservation(JSON.stringify(obs),{...query,location:'Clopton Padel'},
    {now:Date.now(),validator:validation});
  assert.equal(result.sourceId,'matchi');
  assert.equal(result.clubId,null);
});
test('Racket ID known player UI and unclaimed Smashpro route are never assumed to have available inventory',()=>{
  const racket={...base,provider:'racket_id',sourceUrl:'https://racket.id/booking',
    venue:'Rackets Pro Academy',regionTitle:'Available courts',
    rows:[{text:'Court 3 18:00 - 19:30 €38 Available',action:'Available'}]};
  const obs=buildObservation(racket);
  assert.equal(obs.readerError,undefined);
  assert.equal(validation(obs).provider,'racket_id');
  assert.equal(buildObservation({...base,provider:'smashpro',
    sourceUrl:'https://smashpro.pt/pt/c/rackets-pro-academy-quinta-da-marinha',
    claimed:false}).readerError,'SCHEDULE_NOT_READY');
});
test('no inventing offers from a venue directory, hours, stale date or mere colored timetable',()=>{
  for(const changes of [
    {regionTitle:'Opening Hours'},{selectedDate:'2026-01-01'},
    {selectedSport:'Tennis'},{rows:[{text:'Campo 1 08:00 - 23:00',action:'Book'}]},
    {rows:[{text:'Campo 1 18:00 - 19:30 €36',action:'Not available'}]},
    {rows:[{text:'Campos Padel 17 courts',action:'Reserve'}]},
    {rows:[]}
  ]){
    const result=buildObservation({...base,...changes});
    assert.equal(typeof result.readerError,'string',JSON.stringify(changes));
  }
});
test('explicit total-price guard and duplicate-price conflicts fail closed',()=>{
  for(const changes of [
    {text:'Campo 1 18:00 - 19:30 €18 per player',action:'Book'},
    {text:'Campo 1 18:00 - 19:30 €18 €36',action:'Book'},
    {text:'Campo 1 18:00 - 19:30 36 SEK',action:'Book'},
    {text:'Campo 1 18:00 - 19:30 €0,00',action:'Book'},
    {text:'Court 3 18:00 - 19:30 €36',action:'Book',disabled:true}
  ])assert.equal(parseRow(changes),null,JSON.stringify(changes));
  const conflicting=buildObservation({...base,rows:[row,
    {text:'Campo 1 18:00 - 19:30 €40',action:'Book'}]});
  assert.equal(conflicting.readerError,'OFFER_FORMAT_CHANGED');
});

const hourlyRow={...row,text:'Campo 1 18:00 – 19:30 90 min €36,00 per hour'};
test('explicit hourly rates cannot become full-slot prices in the row parser',()=>{
  for(const qualifier of ['per hour','PER HOUR','per   hr','por hora','POR   HORA',
    '/h','/ H','/hr','/ HR','/hour','/ HOUR','/hora','/ HORA']){
    assert.equal(parseRow({...hourlyRow,text:'Campo 1 18:00 – 19:30 90 min €36,00 '+qualifier}),null,qualifier);
  }
});

test('a sole hourly row yields no observation or accepted Get bridge offer',()=>{
  const obs=buildObservation({...base,rows:[hourlyRow]});
  assert.equal(obs.readerError,'NO_EXPANDED_OFFERS');
  assert.equal(obs.offers,undefined);
  assert.throws(()=>normalizePersonalObservation(JSON.stringify(obs),query,
    {now:Date.now(),validator:validation}),/INVALID_OBSERVATION/);
});

test('an hourly row alongside a valid total retains only the explicit total',()=>{
  const obs=buildObservation({...base,rows:[hourlyRow,{...row,text:'Campo 2 18:00 – 19:30 90 min €40,00'}]});
  assert.equal(obs.readerError,undefined);
  assert.equal(obs.offers.length,1);
  const result=normalizePersonalObservation(JSON.stringify(obs),query,{now:Date.now(),validator:validation});
  assert.equal(result.offers.length,1);
  assert.equal(result.offers[0].courtName,'Court 2');
  assert.equal(result.offers[0].duration,90);
  assert.equal(result.offers[0].priceMinor,4000);
});

test('court H and ordinary hour labels do not disqualify an unqualified sole EUR total',()=>{
  for(const text of [row.text,'Court H 18:00 - 19:30 90 min total €36,00',
    'Court 1 hour 18:00 - 19:30 total €36,00','Campo 1 hora 18:00 - 19:30 total €36,00']){
    const parsed=parseRow({...row,text});
    assert.equal(parsed?.priceEur,36,text);
    assert.equal(parsed.durationMinutes,90);
  }
});

const partialPrices=['€36,00 hourly','HOURLY €36,00','hourly: 36,00 €','€36,00 /hourly',
  '€36,00/player','€36,00 / PLAYER','/player €36,00','36,00 € /person',
  '€36,00 / PERSON','/ person €36,00','€36,00/jogador','€36,00 / JOGADOR',
  '/ jogador €36,00','€36,00 / pessoa','from €36,00','FROM: €36,00','from€36,00',
  'desde 36,00 €','DESDE: €36,00','a partir de €36,00','A   PARTIR  DE: €36,00',
  '€36,00\u00a0/\u00a0PLAYER','€36,00 per hour','€36,00 p/h','€36,00 por jogador'];
const priceRow=(price,minutes=90,court='1')=>({...row,
  text:`Campo ${court} 18:00 - ${minutes===60?'19:00':'19:30'} ${minutes} min ${price}`});
const anyDuration={...base.query,durationMinutes:0};
const anyDurationQuery={...query,duration:'any'};

test('explicit per-unit and starting prices never parse as a sole full-slot amount',()=>{
  const admitted=[];
  for(const minutes of [60,90])for(const price of partialPrices){
    if(parseRow(priceRow(price,minutes)))admitted.push([minutes,price]);
  }
  assert.deepEqual(admitted,[],'Explicit partial prices must fail closed, not become totals');
});

test('partial-price rows cannot survive observation validation and Get normalization',()=>{
  const admitted=[];
  for(const minutes of [60,90])for(const price of partialPrices){
    const obs=buildObservation({...base,query:anyDuration,rows:[priceRow(price,minutes)]});
    if(!obs.readerError){
      const result=normalizePersonalObservation(JSON.stringify(validation(obs)),anyDurationQuery,
        {now:Date.now(),validator:validation});
      admitted.push([minutes,price,result.offers[0].priceMinor]);
      continue;
    }
    assert.equal(obs.readerError,'NO_EXPANDED_OFFERS',price);
    assert.equal(obs.offers,undefined);
    assert.throws(()=>validation(obs));
    assert.throws(()=>normalizePersonalObservation(JSON.stringify(obs),anyDurationQuery,
      {now:Date.now(),validator:validation}),/INVALID_OBSERVATION/);
  }
  assert.deepEqual(admitted,[],'No normalized EUR total may come from a partial-price row');
});

test('mixed partial and complete prices retain only the independent valid court total',()=>{
  const leaked=[];
  for(const minutes of [60,90])for(const price of partialPrices){
    const obs=buildObservation({...base,query:anyDuration,
      rows:[priceRow(price,minutes),priceRow('€40,00',minutes,'2')]});
    const result=normalizePersonalObservation(JSON.stringify(validation(obs)),anyDurationQuery,
      {now:Date.now(),validator:validation});
    assert.equal(result.offers.at(-1).courtName,'Court 2');
    assert.equal(result.offers.at(-1).priceMinor,4000);
    assert.equal(result.offers.at(-1).duration,minutes);
    if(result.offers.length!==1)leaked.push([minutes,price]);
  }
  assert.deepEqual(leaked,[],'Partial quotes must not contaminate independently valid totals');
});

test('price-marker words in court labels or unrelated time text preserve valid 60/90-minute totals',()=>{
  for(const minutes of [60,90])for(const court of ['Hourly','From','Desde','Player','Person','Jogador']){
    for(const text of [priceRow('€36,00',minutes,court).text,
      `Court ${court} €36,00 from 18:00 - ${minutes===60?'19:00':'19:30'}`]){
      const obs=buildObservation({...base,query:anyDuration,rows:[{...row,text}]});
      const result=normalizePersonalObservation(JSON.stringify(validation(obs)),anyDurationQuery,
        {now:Date.now(),validator:validation});
      assert.equal(result.offers[0].priceMinor,3600,text);
      assert.equal(result.offers[0].duration,minutes,text);
      assert.equal(result.offers[0].courtName,'Court '+court);
    }
  }
  for(const price of ['€36,00 personal best','€36,00 /playerboard','€36,00 /personnel',
    '€36,00 /jogadorX','€36,00 hourlyScore'])assert.equal(parseRow(priceRow(price))?.priceEur,36,price);
});

test('cannot use forged hosts, tracking query, foreign venue paths or credit card fields',()=>{
  for(const sourceUrl of [
    'https://clubs.tiesports.com.evil.invalid/en/lisboa/OeirasPadelAcademy',
    'https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy?auth=PRIVATE',
    'https://www.matchi.se/facilities/index?token=PRIVATE',
    'http://racket.id/booking',
    'https://smashpro.pt/pt/for-clubs',
    'https://matchi.se/facilities/cloptonpadel'
  ])assert.equal(buildObservation({...base,sourceUrl}).readerError,'SCHEDULE_NOT_READY');
  assert.throws(()=>normalizePersonalObservation(JSON.stringify({...buildObservation(base),secret:'private'}),query,
    {now:Date.now(),validator:validation}),/INVALID_OBSERVATION/);
});
