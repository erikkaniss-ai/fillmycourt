// Real DOM-shaped (FICTIONAL) first-party player UI fixture: no network or
// hidden app state. If exact date/sport/price is absent, availability is unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const reader=readFileSync(new URL('../browser-companion/visible-provider-page.js',import.meta.url),'utf8');
const pure=readFileSync(new URL('../browser-companion/visible-provider-offers.js',import.meta.url),'utf8');
const day=new Date(Date.now()+86400000).toISOString().slice(0,10);
const query={date:day,sport:'Padel',from:'08:00',to:'23:00',durationMinutes:90};
const present=element=>({...element,getClientRects:()=>[{}],getAttribute:()=>null,hasAttribute:()=>false});
function ui({host='https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy',
  date=day,headingLabel='Reservas de campos',rowText='Campo 1 18:00 - 19:30 €36,00 Reservar',
  actionLabel='Reservar',h1='OPA OEIRAS',claimed=true,hasDate=true}={}){
  const option={value:'padel',textContent:'Padel'};
  const sport=present({value:'padel',options:[option],selectedOptions:[option]});
  const input=present({value:date});
  const action=present({innerText:actionLabel});
  const row=present({innerText:rowText,querySelectorAll:()=>[action]});
  const region=present({querySelectorAll:selector=>{
    if(selector==='input[type="date"]')return hasDate?[input]:[];
    if(selector==='select')return [sport];
    if(selector.includes('data-testid'))return [row];
    return [];
  }});
  const heading=present({innerText:headingLabel,closest:()=>region});
  const club=present({innerText:h1});
  const document={
    body:{innerText:claimed?'Player bookings':'Este clube não foi reclamado. Perfil'},
    querySelectorAll:selector=>{
      if(selector==="h2,h3,[role='heading']")return [heading];
      if(selector==="h1")return [club];
      return [];
    }
  };
  const location={href:host};
  const context=vm.createContext({document,location,URL,Date,setTimeout,
    getComputedStyle:()=>({visibility:'visible'}),globalThis:null});
  vm.runInContext(pure,context);vm.runInContext(reader,context);
  return {read:()=>context.readVisibleProviderPage(query),document};
}
test('one normal TieSports dated booking row yields exactly the visible priced court, no booking',async()=>{
  const fixture=ui();
  const r=await fixture.read();
  assert.equal(r.provider,'tiesports');
  assert.equal(r.sourceUrl,'https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy');
  assert.equal(r.offers.length,1);
  assert.equal(r.offers[0].court,'Court 1');
  assert.equal(r.offers[0].startLabel,'6:00 PM');
  assert.equal(r.offers[0].durationMinutes,90);
  assert.equal(r.offers[0].priceEur,36);
});
test('wrong date, missing native date control or unpriced booking row remains unknown',async()=>{
  for(const args of [
    {date:'2026-01-01'},
    {hasDate:false},
    {rowText:'Campo 1 18:00 - 19:30 Reservar'},
    {rowText:'Campo 1 18:00 - 19:30 €18 per player Reservar'},
    {headingLabel:'Opening Hours'}
  ]){
    const r=await ui(args).read();
    assert.equal(typeof r.readerError,'string',JSON.stringify(args));
  }
});
test('unclaimed Smashpro listing cannot falsely advertise availability, even with a priced fictional row',async()=>{
  const r=await ui({host:'https://smashpro.pt/pt/c/rackets-pro-academy-quinta-da-marinha',claimed:false}).read();
  assert.equal(r.readerError,'SOURCE_UNCLAIMED');
});
test('foreign hosts, query-bearing provider URLs and directory roots cannot run provider UI adapter',async()=>{
  for(const host of [
    'https://clubs.tiesports.com.evil.invalid/en/lisboa/OeirasPadelAcademy',
    'https://clubs.tiesports.com/en',
    'https://racket.id/booking?session=EXFIL',
    'https://matchi.se/facilities/cloptonpadel'
  ]){
    assert.equal((await ui({host}).read()).readerError,'CLUB_PAGE_REQUIRED');
  }
});
