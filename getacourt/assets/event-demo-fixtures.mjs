// Finite, invented local scenarios. No real venue, roster, provider request or event grant.
export function eventDemoFixtures(day){
  const clock=Date.parse(day+'T08:00:00Z');
  if(!Number.isFinite(clock))return {records:[],now:0};
  const stamp=time=>day+'T'+(/^\d\d$/.test(time)?time+':00':time)+':00Z';
  const updated=new Date(clock-60000).toISOString(),expires=new Date(clock+3600000).toISOString();
  const venues={
    solis:{id:'solis',name:'Solis Padel House',position:{lat:38.707,lon:-9.424,fictional:true}},
    dune:{id:'dune',name:'Dune Court Studio',position:{lat:38.694,lon:-9.447,fictional:true}},
    azul:{id:'azul',name:'Azul Social Courts',position:{lat:38.725,lon:-9.401,fictional:true}}
  };
  const base={fictional:true,accessScope:'public',provider:'demo-alpha',kind:'open_match',
    organizer:'Fictional Solis community',venue:venues.solis,area:'Cascais',sport:'padel',format:'social',entry:'solo',
    timezone:'Europe/Lisbon',startsAt:stamp('18'),endsAt:stamp('19'),registrationDeadline:stamp('17'),
    lifecycle:'scheduled',registration:'open',eligibility:'eligible',
    court:{state:'confirmed',name:'Fictional court 1'},
    counts:{capacity:4,confirmed:2,remaining:2,unit:'people',sourceProven:true},
    price:{amountMinor:1200,currency:'EUR',unit:'person',feesStatus:'unknown'},
    rating:{scheme:'Fictional A level',level:'3.0–4.0'},
    observedAt:updated,sourceUpdatedAt:updated,validUntil:expires};
  const row=(sourceEventId,title,patch={})=>({...base,sourceEventId,title,
    sourceUrl:'https://source-a.invalid/events/'+sourceEventId,...patch});
  const records=[
    row('evening','After-work doubles'),
    row('first','Be the first player',{startsAt:stamp('19'),endsAt:stamp('20'),
      counts:{capacity:4,confirmed:0,remaining:4,unit:'people',sourceProven:true},
      price:{amountMinor:4800,currency:'EUR',unit:'event',feesStatus:'included'}}),
    row('notice','One player wanted — plans still open',{kind:'player_needed',venue:null,startsAt:null,endsAt:null,
      registrationDeadline:null,court:{state:'unknown'},counts:null,price:null,eligibility:'unknown',registration:'unknown'}),
    row('full','The full four',{venue:venues.dune,startsAt:stamp('20'),endsAt:stamp('21'),counts:{capacity:4,confirmed:4,remaining:0,unit:'people',sourceProven:true},registration:'full'}),
    row('approval','A competitive challenge',{venue:venues.dune,startsAt:stamp('20:30'),endsAt:stamp('22'),format:'competitive',eligibility:'approval_required',
      counts:{capacity:4,confirmed:3,remaining:1,unit:'people',sourceProven:true}}),
    row('stale','Last checked earlier',{startsAt:stamp('21'),endsAt:stamp('22'),observedAt:new Date(clock-7200000).toISOString(),sourceUpdatedAt:new Date(clock-7200000).toISOString(),validUntil:new Date(clock-3600000).toISOString()}),
    row('cancelled','Cancelled social session',{startsAt:stamp('21:15'),endsAt:stamp('22:15'),lifecycle:'cancelled'}),
    row('waitlist','Waiting for a place',{startsAt:stamp('21:30'),endsAt:stamp('22:30'),registration:'waitlist',counts:{capacity:4,confirmed:4,remaining:0,unit:'people',sourceProven:true}}),
    row('partner','Pair waiting for approval',{startsAt:stamp('19:30'),endsAt:stamp('21'),entry:'pair',eligibility:'partner_pending',registration:'pending',
      counts:{capacity:2,confirmed:1,remaining:1,unit:'pairs',sourceProven:true},
      price:{amountMinor:2600,currency:'EUR',unit:'pair',feesStatus:'additional',changed:true}}),
    row('evening','Sunset social doubles',{provider:'demo-beta',venue:venues.azul,startsAt:stamp('18:30'),endsAt:stamp('20'),
      sourceUrl:'https://source-b.invalid/events/evening',rating:{scheme:'Fictional B band',level:'Intermediate'},
      price:{amountMinor:1400,currency:'EUR',unit:'person',feesStatus:'included'}}),
    row('tour-lock-1','Organizer court allocation',{kind:'tournament',parentSourceEventId:'weekend-pairs',
      parentTitle:'The friendly pairs cup',parentSourceUrl:'https://source-a.invalid/events/weekend-pairs',
      format:'competitive',entry:'pair',startsAt:stamp('16'),endsAt:stamp('21'),registrationDeadline:stamp('15'),
      counts:{capacity:8,confirmed:4,remaining:4,unit:'pairs',sourceProven:true},
      price:{amountMinor:3000,currency:'EUR',unit:'pair',feesStatus:'unknown'}}),
    row('tour-lock-2','Another organizer court allocation',{kind:'tournament',parentSourceEventId:'weekend-pairs',
      parentTitle:'The friendly pairs cup',parentSourceUrl:'https://source-a.invalid/events/weekend-pairs',
      format:'competitive',entry:'pair',startsAt:stamp('16'),endsAt:stamp('21'),registrationDeadline:stamp('15'),
      counts:{capacity:8,confirmed:4,remaining:4,unit:'pairs',sourceProven:true},
      price:{amountMinor:3000,currency:'EUR',unit:'pair',feesStatus:'unknown'}}),
    row('mini','Sunday mini-tournament',{kind:'mini_tournament',venue:venues.azul,startsAt:stamp('17'),endsAt:stamp('20'),
      registrationDeadline:stamp('16'),court:{state:'pending'},counts:null,price:null,eligibility:'membership_only'}),
    row('team-cup','The team cup — registration closed',{kind:'tournament',venue:venues.dune,entry:'team',
      registrationDeadline:new Date(clock-60000).toISOString(),registration:'closed',
      counts:{capacity:8,confirmed:8,remaining:0,unit:'teams',sourceProven:true},
      price:{amountMinor:6000,currency:'EUR',unit:'team',feesStatus:'additional'}})
  ];
  return {records,now:clock};
}
