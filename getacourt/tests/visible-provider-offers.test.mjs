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
