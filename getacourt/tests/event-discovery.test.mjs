import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectEvents,projectEventSources,filterEvents,groupEventVenues,safeEventUrl,localEventTime,validLocalDay,eventPriceLabel,eventActivity} from '../assets/event-discovery.mjs';
import {eventDemoFixtures} from '../assets/event-demo-fixtures.mjs';
import {eventTimeLabel,eventCountLabel} from '../assets/event-discovery-view.mjs';
const fixture=eventDemoFixtures('2026-11-01'),ctx={mode:'demo',now:fixture.now};
const base=fixture.records[0],project=(r,options={})=>projectEvents(r,{...ctx,...options});
const filter=(r,patch={})=>filterEvents(r,{location:'Cascais',date:'2026-11-01',from:'08:00',to:'23:00',...patch});

test('REAL event projection is closed even with claimed verified rights',()=>{
  assert.deepEqual(projectEvents(fixture.records,{mode:'real',now:fixture.now}),[]);
  assert.deepEqual(projectEvents([{...base,fictional:false}],ctx),[]);
  assert.deepEqual(project([{...base,provider:'playtomic',rights:{eventRead:'verified',redisplay:'verified'}}]),[]);
});
test('offline and empty fictional source states stay independent and cannot become a real feed',()=>{
  const sources=projectEventSources(fixture.sources,{mode:'demo'});
  assert.equal(sources.length,4);
  assert.equal(sources.find(s=>s.provider==='demo-gamma').state,'offline');
  assert.match(sources.find(s=>s.provider==='demo-gamma').message,/other sources may still have events/);
  assert.match(sources.find(s=>s.provider==='demo-delta').message,/not a provider-wide sold-out/);
  assert.equal(project(fixture.records).length,13);
  assert.deepEqual(projectEventSources(fixture.sources,{mode:'real'}),[]);
  assert.deepEqual(projectEventSources([{...fixture.sources[0],accessScope:'personal',viewerScope:'OTHER-USER'}],{mode:'demo'}),[]);
  assert.deepEqual(projectEventSources([fixture.sources[0],{...fixture.sources[0],revoked:true,checkedAt:'2026-11-01T08:00:00Z'}],{mode:'demo'}),[]);
  assert.deepEqual(projectEventSources([{...fixture.sources[0],revoked:true},{...fixture.sources[0],state:'offline'}],{mode:'demo'}),[]);
  const sanitized=projectEventSources([{...fixture.sources[0],error:'SECRET',token:'SECRET'}],{mode:'demo'});
  assert.doesNotMatch(JSON.stringify(sanitized),/SECRET|token|error/);
});
test('games, empty candidates and notices are different kinds with truthful uncertainty',()=>{
  const rows=project(fixture.records);
  assert.equal(rows.length,13);
  assert.equal(rows.find(e=>e.sourceEventId==='first').kind,'start_open_match');
  assert.match(eventCountLabel(rows.find(e=>e.sourceEventId==='first')),/0 \/ 4 people · No players yet/);
  const notice=rows.find(e=>e.kind==='player_needed');
  assert.equal(notice.venue,null);assert.equal(notice.startsAt,null);assert.equal(notice.counts.remaining,null);
  assert.equal(eventTimeLabel(notice),'Time unconfirmed');
});
test('provider source-ID collisions stay distinct; tournament court locks form one explicit parent',()=>{
  const rows=project(fixture.records);
  const same=rows.filter(e=>e.sourceEventId==='evening');assert.equal(same.length,2);assert.notEqual(same[0].key,same[1].key);
  const tournament=rows.filter(e=>e.sourceEventId==='weekend-pairs');assert.equal(tournament.length,1);
  assert.equal(tournament[0].court.state,'unknown');assert.equal(tournament[0].counts.capacity,8);
  assert.equal(tournament[0].counts.unit,'pairs');assert.equal(tournament[0].sourceUrl,'https://source-a.invalid/events/weekend-pairs');
  assert.equal(rows.some(e=>e.sourceEventId.startsWith('tour-lock-')),false);
});
test('out-of-order source updates cannot restore a cancelled or revoked event',()=>{
  const cancel={...base,lifecycle:'cancelled',sourceUpdatedAt:'2026-11-01T07:59:30Z'};
  assert.equal(project([cancel,base])[0].status,'Cancelled');
  assert.equal(project([base,cancel])[0].status,'Cancelled');
  const revoke={...cancel,revoked:true};assert.deepEqual(project([revoke,base]),[]);
  assert.deepEqual(project([base,{...revoke,private:true}]),[]);
  assert.equal(project([base,{...base,lifecycle:'cancelled'}])[0].status,'Cancelled');
});
test('personal and private exposure do not cross viewer or revocation boundaries',()=>{
  const own={...base,accessScope:'personal',viewerScope:'scope-a'};
  assert.deepEqual(project([own],{viewerScope:'scope-b'}),[]);
  assert.deepEqual(project([own]),[]);
  assert.equal(project([own],{viewerScope:'scope-a'}).length,1);
  assert.deepEqual(project([{...base,accessScope:'private'}]),[]);
  assert.deepEqual(project([base,{...own,sourceUpdatedAt:'2026-11-01T08:00:00Z'}],{viewerScope:'scope-b'}),[]);
});
test('projection excludes roster PII, profile/session internals and untrusted coordinates',()=>{
  const row=project([{...base,roster:[{email:'NEVER-RENDER@example.invalid'}],cookie:'NEVER-RENDER',token:'NEVER-RENDER',
    venue:{...base.venue,position:{lat:38.7,lon:-9.4}}}])[0];
  assert.doesNotMatch(JSON.stringify(row),/NEVER-RENDER|roster|cookie|token|viewerScope/);
  assert.equal(row.position,null);assert.equal(Object.isFrozen(row),true);
});
test('capacity is source-proven and nullable; no roster, arithmetic or pair-to-person inference',()=>{
  const row=project([{...base,counts:{capacity:4,confirmed:2,remaining:null,unit:'people',sourceProven:true},roster:[1,2,3]}])[0];
  assert.equal(row.counts.remaining,null);
  assert.equal(project([{...base,counts:{capacity:4,confirmed:2,remaining:2,unit:'people'}}])[0].counts.capacity,null);
  assert.equal(project([{...base,counts:{capacity:4,confirmed:5,remaining:1,unit:'people',sourceProven:true}}])[0].counts.proven,false);
  const pair=project(fixture.records).find(e=>e.sourceEventId==='partner');
  assert.equal(pair.counts.unit,'pairs');assert.match(eventCountLabel(pair),/pairs/);assert.doesNotMatch(eventCountLabel(pair),/people/);
});
test('price keeps its actual entry unit and fees; full booking amount is never divided',()=>{
  const rows=project(fixture.records),start=rows.find(e=>e.sourceEventId==='first');
  assert.equal(eventPriceLabel(start.price),'€48.00 / event');
  assert.equal(start.price.amountMinor,4800);
  assert.equal(project([{...base,price:{amountMinor:4800,currency:'EUR',unit:'court_booking'}}])[0].price,null);
  const pair=rows.find(e=>e.sourceEventId==='partner');assert.equal(pair.price.changed,true);assert.equal(pair.price.feesStatus,'additional');
  assert.equal(rows.find(e=>e.sourceEventId==='evening').price.feesStatus,'unknown');
});
test('freshness, lifecycle, registration, eligibility and court assignment stay independent',()=>{
  const rows=project(fixture.records),stale=rows.find(e=>e.sourceEventId==='stale');
  assert.equal(stale.status,'Stale information');assert.equal(stale.registration,'open');
  assert.match(eventCountLabel(stale),/places unverified/);
  for(const [id,status] of [['full','Full'],['approval','Approval required'],['waitlist','Waitlist'],['partner','Partner approval pending'],['mini','Members only']])
    assert.equal(rows.find(e=>e.sourceEventId===id).status,status);
  assert.equal(rows.find(e=>e.sourceEventId==='mini').court.state,'pending');
  assert.equal(rows.find(e=>e.sourceEventId==='team-cup').deadlinePassed,true);
  assert.equal(project([{...base,observedAt:null,validUntil:null}])[0].freshness,'unknown');
});
test('exact event URL validation rejects scheme, query, userinfo, origin and club/search fallback tricks',()=>{
  const url='https://source-a.invalid/events/evening';
  assert.equal(safeEventUrl(url,'demo-alpha','evening'),url);
  for(const bad of ['javascript:alert(1)','//source-a.invalid/events/evening',url+'?x=1',url+'?',url+'#',
    'https://@source-a.invalid/events/evening','https://source-a.invalid:443/events/evening',
    'https://source-a.invalid.evil.test/events/evening','https://source-a.invalid/clubs/evening',
    'https://source-a.invalid/events/other','https://source-a.invalid/events/%65vening'])
    assert.equal(safeEventUrl(bad,'demo-alpha','evening'),null,bad);
  assert.equal(safeEventUrl(url,'demo-beta','evening'),null);
  const row=project([{...base,sourceUrl:'javascript:alert(1)',rights:{eventDeeplink:'verified',joinWrite:'verified'}}])[0];
  assert.equal(row.handoff.url,null);assert.equal(row.handoff.enabled,false);
});
test('malicious source text is preserved as text data, never promoted into markup or URLs',()=>{
  const malicious='<img src=x onerror=alert(1)><script>alert(1)</script>';
  const row=project([{...base,title:malicious,organizer:malicious}])[0];
  assert.equal(row.title,malicious);assert.equal(row.organizer,malicious);
  const view=readFileSync(new URL('../assets/event-discovery-view.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(view,/innerHTML|insertAdjacentHTML|document\.write/);
});
test('local day and DST repeated hours use source timezone, not browser or UTC day',()=>{
  const summer=localEventTime('2026-10-24T23:30:00Z','Europe/Lisbon');
  assert.deepEqual([summer.day,summer.time,summer.offset],['2026-10-25','00:30','GMT+1']);
  const before=localEventTime('2026-10-25T00:30:00Z','Europe/Lisbon');
  const after=localEventTime('2026-10-25T01:30:00Z','Europe/Lisbon');
  assert.equal(before.time,after.time);assert.notEqual(before.offset,after.offset);
  assert.equal(localEventTime('2026-03-29T01:30:00Z','Europe/Lisbon').time,'02:30');
  assert.equal(localEventTime('2026-11-01T18:00:00','Europe/Lisbon'),null);
  assert.equal(localEventTime('2026-11-01T18:00:00Z','Not/AZone'),null);
  assert.equal(validLocalDay('2026-02-30'),false);
});
test('filters honor source-local day, missing time opt-in, rating and entry unit',()=>{
  const rows=project(fixture.records);
  assert.equal(filter(rows).length,10);
  assert.equal(filter(rows,{includeUnscheduled:false}).some(e=>e.kind==='player_needed'),false);
  assert.equal(filter(rows,{intent:'tournaments'}).length,3);
  assert.deepEqual(filter(rows,{date:'2026-02-30'}),[]);
  assert.deepEqual(filter(rows,{date:'2026-11-02',includeUnscheduled:false}),[]);
  assert.equal(filter(rows,{entry:'pair'})[0].sourceEventId,'partner');
  assert.equal(filter(rows,{priceUnit:'event'})[0].sourceEventId,'first');
  assert.equal(filter(rows,{rating:JSON.stringify(['demo-beta','Fictional B band','Intermediate'])})[0].provider,'demo-beta');
  const zone=project([{...base,startsAt:'2026-10-24T23:30:00Z',endsAt:'2026-10-25T01:30:00Z'}]);
  assert.equal(filter(zone,{date:'2026-10-25',from:'00:00',to:'03:00'}).length,1);
});
test('open-place filter never turns stale, full, cancelled or expired registration into availability',()=>{
  const rows=filter(project(fixture.records),{space:'known'});
  assert.equal(rows.some(e=>['stale','full','cancelled','waitlist'].includes(e.sourceEventId)),false);
  assert.equal(rows.some(e=>e.sourceEventId==='first'),true);
});
test('pure filters fail closed on invalid HH:mm ranges and nonnumeric display constraints',()=>{
  const rows=project(fixture.records);
  for(const patch of [{from:'00:99'},{to:'24:30'},{from:'25:00'},{from:'18:00',to:'18:00'},
    {budget:'NaN'},{budget:'-1'},{radius:'Infinity'},{intent:'courts'},{sort:'invented'}])
    assert.deepEqual(filter(rows,patch),[],JSON.stringify(patch));
});
test('player-needed notices allow unknown endpoints but reject malformed or reversed known intervals',()=>{
  const notice={...base,kind:'player_needed'};
  assert.equal(project([{...notice,startsAt:null,endsAt:null}]).length,1);
  assert.equal(project([{...notice,startsAt:null}]).length,1);
  assert.equal(project([{...notice,endsAt:null}]).length,1);
  for(const endsAt of ['2026-11-01T14:00:00Z','2026-11-01T15:00:00Z'])
    assert.deepEqual(project([{...notice,startsAt:'2026-11-01T15:00:00Z',endsAt}]),[]);
  assert.deepEqual(project([{...notice,startsAt:'2026-11-01T15:00:00',endsAt:null}]),[]);
});
test('one shared filtered dataset drives venue grouping; unknown positions stay list-only',()=>{
  const rows=filter(project(fixture.records));const groups=groupEventVenues(rows);
  const mapped=[...groups.values()].flat().map(e=>e.key).sort();
  assert.deepEqual(mapped,rows.filter(e=>e.position).map(e=>e.key).sort());
  assert.equal(mapped.includes(rows.find(e=>e.kind==='player_needed').key),false);
  assert.equal([...groups.values()].some(g=>g.length>1),true);
  const near=filter(project(fixture.records),{origin:{lat:38.7,lon:-9.42},radius:'2',distance:(o,p)=>p?.lat===38.707?1:null});
  assert.equal(near.some(e=>e.position===null),false);
});
test('activity categories never turn handoff, application, waitlist or self-report into a sale',()=>{
  for(const type of ['detail_viewed','official_handoff_clicked','application_pending','waitlisted','user_reported_registration']){
    const result=eventActivity(type);assert.equal(result.registrationConfirmed,false);assert.equal(result.saleConfirmed,false);
  }
  assert.equal(eventActivity('official_handoff_clicked').outcome,'unknown');
  assert.equal(eventActivity('source_confirmed_registration'),null);
  assert.equal(eventActivity('source_confirmed_registration',{sourceVerified:true,evidenceRef:'receipt-1'}).registrationConfirmed,true);
});
test('event modules have no provider, persistence, auth, transaction or second-map effects',()=>{
  for(const file of ['event-discovery.mjs','event-demo-fixtures.mjs','event-discovery-view.mjs']){
    const source=readFileSync(new URL('../assets/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|L\.map\s*\(|\.submit\s*\(/);
  }
  for(const row of project(fixture.records))assert.equal(row.handoff.enabled,false);
  assert.deepEqual(project([]),[]);
});
