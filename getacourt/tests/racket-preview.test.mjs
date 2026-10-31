import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {normalizePersonalObservation} from '../assets/personal-observation-bridge.mjs';
const require=createRequire(import.meta.url);
const {buildObservation}=require('../browser-companion/racket-preview.js');
const validator=require('../assets/personal-source-observation.js').validateObservation;
const now=Date.parse('2026-10-30T04:30:00.000Z');
// Inspected public UI shape. Prices in regression fixtures are not live supply.
const header='Sat 31 Oct\n08:00-09:00\n\ue98a\n60 min\nPadel 3\nCarcavelos Tenis & Padel';
const rows=['\ue92b\n\ue90f\nPadel 3\nRoofed\nNo description\n\ue96e\n30.6 eur',
  'Padel 6\nRoofed\nNo description\n30.60 eur'];
const q={date:'2026-10-31',sport:'Padel',from:'08:00',to:'10:00',durationMinutes:60};
test('real-shaped preview preserves exact court names, 60 minutes and EUR cents through Get normalization',()=>{
  const obs=buildObservation(header,rows,q,now);
  const result=normalizePersonalObservation(JSON.stringify(obs),{location:'Carcavelos Tenis & Padel',
    date:q.date,sport:'padel',from:q.from,to:q.to,duration:'60'},{now,validator});
  assert.deepEqual(result.offers.map(o=>[o.courtName,o.priceMinor,o.duration]),[['Padel 3',3060,60],['Padel 6',3060,60]]);
  assert.ok(result.offers.every(o=>!o.bookingEnabled&&o.startsAt===null));
});
test('date, duration, partial/per-person money, extra fees and duplicate courts fail closed',()=>{
  for(const [h,r,query] of [
    [header.replace('Sat 31 Oct','Fri 30 Oct'),rows,q],
    [header.replace('60 min','90 min'),rows,q],
    [header,rows.map(s=>s.replace('eur','eur per person')),q],
    [header,[rows[0]+'\n5 eur fee'],q],
    [header,[rows[0],rows[0]],q],
    [header,rows,{...q,durationMinutes:90}]
  ])assert.equal(typeof buildObservation(h,r,query,now).readerError,'string');
});
test('actual nested preview DOM shape is read without interacting with controls or hidden state',()=>{
  const present=(innerText,parentElement)=>({innerText,children:[],parentElement,getClientRects:()=>[{}]});
  const dialog=present('Select courts\n'+header+'\n'+rows.join('\n')+'\nCancel\nContinue');
  const title=present('Select courts',present('Select courts',present('Select courts',dialog)));
  const date=present('Sat 31 Oct',present('Sat 31 Oct\n08:00-09:00',
    present('Sat 31 Oct\n08:00-09:00\n60 min',present(header,dialog))));
  const prices=rows.map(row=>present('30.6 eur',present('30.6 eur',present(row,dialog))));
  const leaves=[title,date,...prices];
  dialog.contains=e=>leaves.includes(e);
  const document={querySelectorAll:()=>leaves};
  class FixtureDate extends Date {static now(){return now;}}
  const context=vm.createContext({document,location:{href:'https://racket.id/booking'},
    getComputedStyle:()=>({visibility:'visible'}),Date:FixtureDate,Intl});
  vm.runInContext(readFileSync(new URL('../browser-companion/racket-preview.js',import.meta.url),'utf8'),context);
  // Use a currently valid query; fixture date-label/year binding follows it.
  const source=context.GetACourtRacketPreview;
  const realBuild=buildObservation(header,rows,q,now);
  assert.equal(realBuild.offers.length,2);
  // DOM extraction is exercised with its observed date and the fixed clock.
  const parsed=source.readPreview(q);
  assert.equal(parsed.offers.length,2);
  assert.equal(parsed.offers[0].priceEur,30.6);
  context.location.href='https://racket.id/booking?token=forbidden';
  assert.equal(source.readPreview(q).readerError,'CLUB_PAGE_REQUIRED');
});

function navigationRig({revokeAfterClub=false}={}){
  let phase=0,consented=true;
  const clicks=[];
  const visible=(innerText,parentElement)=>({innerText,children:[],parentElement,getClientRects:()=>[{}]});
  const control=(text,next)=>Object.assign(visible(text),{click(){
    clicks.push(text);phase=next;
    if(revokeAfterClub&&next===2)consented=false;
  }});
  const dialog=visible('Select courts\n'+header+'\n'+rows.join('\n')+'\nCancel\nContinue');
  const title=visible('Select courts',visible('Select courts',visible('Select courts',dialog)));
  const date=visible('Sat 31 Oct',visible('Sat 31 Oct\n08:00-09:00',
    visible('Sat 31 Oct\n08:00-09:00\n60 min',visible(header,dialog))));
  const prices=rows.map(row=>visible('30.6 eur',visible('30.6 eur',visible(row,dialog))));
  const preview=[title,date,...prices];dialog.contains=e=>preview.includes(e);
  const states=[
    [control('SAT\n31\nOCT',1)],
    [control('Carcavelos Tenis & Padel',2)],
    [control('08:00',3)],
    [visible('08:00–09:00 · 60 minutes'),visible('Carcavelos Tenis & Padel · Sat 31 Oct'),control('Select courts',4)],
    preview
  ];
  class FixtureDate extends Date {static now(){return now;} constructor(value){super(value===undefined?now:value);}}
  const context=vm.createContext({document:{querySelectorAll:s=>s==='div'?states[phase]:[]},
    location:{href:'https://racket.id/booking'},getComputedStyle:()=>({visibility:'visible'}),
    Date:FixtureDate,Intl,setTimeout,
    chrome:{runtime:{sendMessage:async message=>({allowed:consented&&
      message.action==='racketNavigationConsent'&&message.epoch===7})}}});
  vm.runInContext(readFileSync(new URL('../browser-companion/racket-preview.js',import.meta.url),'utf8'),context);
  return {search:query=>context.GetACourtRacketPreview.search(query,7),clicks};
}
test('one requested Find navigates only inspected date/club/time/preview controls and reads actual-shaped quotes',async()=>{
  const r=navigationRig();
  const observation=await r.search({...q,location:'Carcavelos Tenis & Padel'});
  assert.equal(observation.offers.length,2);
  assert.deepEqual(r.clicks,['SAT\n31\nOCT','Carcavelos Tenis & Padel','08:00','Select courts']);
  assert.ok(!r.clicks.includes('Continue'));
});
test('revoke during normal navigation stops before further clicks and returns no offer',async()=>{
  const r=navigationRig({revokeAfterClub:true});
  const result=await r.search({...q,location:'Carcavelos Tenis & Padel'});
  assert.equal(result.readerError,'CONSENT_WITHDRAWN');
  assert.equal(r.clicks.length,2);
});
test('unproven 90-minute preparation and malformed query cannot operate the provider',async()=>{
  for(const query of [{...q,durationMinutes:90,location:'Carcavelos Tenis & Padel'},
    {...q,date:'bad',location:'Carcavelos Tenis & Padel'}]){
    const r=navigationRig();assert.equal((await r.search(query)).readerError,'QUERY_INVALID');
    assert.equal(r.clicks.length,0);
  }
});
