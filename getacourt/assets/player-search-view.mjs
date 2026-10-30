// Display only. Never reads a provider, requests location or persists observations.
export const MAP_TILES='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const PROVIDER_NAMES=Object.freeze({playtomic:'Playtomic',tiesports:'TiePlayer / TieSports',
  racket_id:'Racket ID',smashpro:'Smashpro',matchi:'MATCHi'});
// Exact public club-map link observed on the official Playtomic club page.
// A directory entry or an observation-supplied coordinate is never trusted here.
export const TRUSTED_POSITION=Object.freeze({
  sourceUrl:'https://playtomic.com/clubs/cascais-padel-club',venue:'Cascais Padel & Nature',
  lat:38.71900588,lon:-9.43120791,
  provenance:'https://www.google.com/maps?q=38.71900588,-9.43120791'
});
const demoOrigin=Object.freeze({lat:38.7000,lon:-9.4200,label:'Demo starting place (fictional)',fictional:true});
// Finite fictional examples, not copies of real club names or current supply.
const DEMO=Object.freeze([
  {id:'solis',club:'Solis Padel House',court:'Fictional court 1',lat:38.707,lon:-9.424,sport:'padel',slots:[[480,90,3200],[1080,60,2800]]},
  {id:'dune',club:'Dune Court Studio',court:'Fictional court 2',lat:38.694,lon:-9.447,sport:'padel',slots:[[600,60,2400],[1170,90,4200]]},
  {id:'azul',club:'Azul Social Courts',court:'Fictional court 3',lat:38.725,lon:-9.401,sport:'padel',slots:[[540,90,3800],[1110,60,3000]]},
  {id:'olive',club:'Olive Tennis Garden',court:'Fictional court 4',lat:38.711,lon:-9.413,sport:'tennis',slots:[[540,60,2200],[1080,90,3300]]}
]);
const minutes=s=>{const m=/^(\d{1,2}):(\d\d) ([AP]M)$/.exec(s||'');
  return m?(Number(m[1])%12)*60+Number(m[2])+(m[3]==='PM'?720:0):Infinity;};
const label=n=>(Math.floor(n/60)%12||12)+':'+String(n%60).padStart(2,'0')+(n<720?' AM':' PM');
const money=n=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(n/100);
const key=o=>JSON.stringify([o.sourceId,o.sourceUrl,o.clubName,o.courtName,o.date,o.startLabel,o.endLabel,o.duration,o.priceMinor]);
export function distanceKm(a,b){
  if(!a||!b||![a.lat,a.lon,b.lat,b.lon].every(Number.isFinite)||
    Math.abs(a.lat)>90||Math.abs(b.lat)>90||Math.abs(a.lon)>180||Math.abs(b.lon)>180)return null;
  const rad=n=>n*Math.PI/180,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon);
  const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function originFor(mode,id){
  if(mode==='demo'&&id==='demo')return demoOrigin;
  if(mode==='real'&&id==='nature')return {...TRUSTED_POSITION,label:TRUSTED_POSITION.venue};
  return null;
}
export function trustedPosition(offer){
  return offer?.sourceId==='playtomic'&&offer.sourceUrl===TRUSTED_POSITION.sourceUrl&&
    offer.clubName===TRUSTED_POSITION.venue?TRUSTED_POSITION:null;
}
export function demoOffers(query){
  if(!query||!/^\d{4}-\d\d-\d\d$/.test(query.date||''))return [];
  const from=Number(query.from?.slice(0,2))*60+Number(query.from?.slice(3));
  const to=Number(query.to?.slice(0,2))*60+Number(query.to?.slice(3));
  const place=String(query.location||'').trim().toLowerCase();
  return DEMO.filter(c=>c.sport===query.sport&&
    (place==='cascais'||place==='demo'||c.club.toLowerCase().includes(place)))
    .flatMap(c=>c.slots.filter(([start,duration])=>start>=from&&start<to&&
      (query.duration==='any'||Number(query.duration)===duration)).map(([start,duration,priceMinor])=>({
        demo:true,position:{lat:c.lat,lon:c.lon,fictional:true},captured:null,expires:null,
        o:{sourceId:'demo',sourceUrl:null,clubName:c.club,courtName:c.court,date:query.date,
          startLabel:label(start),endLabel:label(start+duration),duration,priceMinor}
      })));
}
export function displayRows(rows,{mode='real',origin=null,budget='any',radius='any',sort='time',now=Date.now()}={}){
  const unique=new Map();
  for(const row of rows||[]){
    if(!row?.o||(mode==='demo'?row.demo!==true:row.demo===true||row.o.sourceId==='demo'||
      !Number.isFinite(Date.parse(row.expires))||Date.parse(row.expires)<=now))continue;
    const position=mode==='demo'?row.position:trustedPosition(row.o);
    const distance=distanceKm(origin,position);
    if(budget!=='any'&&row.o.priceMinor>Number(budget)*100)continue;
    // Unknown positions cannot truthfully satisfy an active radius filter.
    if(origin&&radius!=='any'&&(distance===null||distance>Number(radius)))continue;
    unique.set(key(row.o),{...row,key:key(row.o),position,distance});
  }
  return [...unique.values()].sort((a,b)=>
    (sort==='price'?a.o.priceMinor-b.o.priceMinor:sort==='distance'?
      (a.distance??Infinity)-(b.distance??Infinity):minutes(a.o.startLabel)-minutes(b.o.startLabel))||
    a.o.priceMinor-b.o.priceMinor||a.o.clubName.localeCompare(b.o.clubName));
}

export function createPlayerSearchView({onFilterChange=()=>{}}={}){
  const doc=document,by=id=>doc.getElementById(id),host=by('offers');
  const make=(tag,text,cls)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  let mode='real',rows=[],selected=null,map=null,layer=null,markers=new Map(),cards=new Map(),mapError=false;
  const filterState=()=>({mode,origin:originFor(mode,by('searchOrigin').value),
    budget:by('budgetFilter').value,radius:by('radiusFilter').value,sort:by('offerSort').value});
  const selectedMapLabel=()=>mode==='demo'?'DEMO · Fictional availability':'REAL · Verified offers only';
  const selectionText=row=>row?(row.demo?'DEMO · ':'')+row.o.clubName+', '+row.o.courtName+', '+row.o.startLabel+', '+money(row.o.priceMinor):'';
  function changeView(view){
    by('resultsWorkspace').dataset.view=view;
    for(const [id,value] of [['listView','list'],['mapView','map'],['splitView','both']])
      by(id).setAttribute('aria-pressed',String(view===value));
    if(view!=='list')requestAnimationFrame(()=>map?.invalidateSize());
  }
  function select(row,{fromMap=false}={}){
    selected=row.key;
    for(const [id,card] of cards)card.classList.toggle('selected',id===selected);
    for(const [id,marker] of markers)marker.getElement()?.classList.toggle('selected',id===JSON.stringify([row.o.sourceUrl,row.o.clubName]));
    const target=cards.get(row.key);
    by('mapSelection').textContent=selectionText(row);
    if(fromMap){
      if(by('resultsWorkspace').dataset.view==='map')changeView('both');
      target?.focus({preventScroll:true});target?.scrollIntoView({behavior:'auto',block:'nearest'});
    }else if(row.position&&map){
      if(by('resultsWorkspace').dataset.view==='list')changeView('both');
      map.panTo([row.position.lat,row.position.lon],{animate:false});
      markers.get(JSON.stringify([row.o.sourceUrl,row.o.clubName]))?.openPopup();
    }
  }
  function ensureMap(){
    if(map||!globalThis.L)return;
    map=globalThis.L.map(by('courtMap'),{scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false})
      .setView([TRUSTED_POSITION.lat,TRUSTED_POSITION.lon],12);
    globalThis.L.tileLayer(MAP_TILES,{maxZoom:18,keepBuffer:0,updateWhenIdle:true,
      crossOrigin:'anonymous',referrerPolicy:'origin',
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map)
      .on('tileerror',()=>{mapError=true;by('mapNote').textContent='Map background unavailable. The list remains usable; no availability is inferred from the map.';});
    layer=globalThis.L.layerGroup().addTo(map);
  }
  function renderMap(){
    ensureMap();markers.clear();layer?.clearLayers();
    const groups=new Map();
    for(const row of rows){
      if(!row.position)continue;
      const id=JSON.stringify([row.o.sourceUrl,row.o.clubName]);
      if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);
    }
    by('mappedCount').textContent=groups.size+' mapped club'+(groups.size===1?'':'s');
    by('mapModeLabel').textContent=selectedMapLabel();
    if(!mapError)by('mapNote').textContent=mode==='demo'
      ?'DEMO · All club positions and availability are fictional. Map tiles are geographic background only.'
      :rows.length?'Pins use reviewed public club positions. Unknown positions stay in the list; no user location is assumed.'
      :'No available pins until fresh offers arrive. The map is an area overview, not availability.';
    if(!map){by('mapNote').textContent='Map unavailable. Use the list to inspect the same results.';return;}
    for(const [id,group] of groups){
      const row=group[0],lowest=Math.min(...group.map(v=>v.o.priceMinor));
      const pin=make('span',undefined,'pin-label'+(row.demo?' demo':''));
      if(row.demo)pin.append(make('small','DEMO'));
      pin.append(doc.createTextNode(money(lowest)));
      const marker=globalThis.L.marker([row.position.lat,row.position.lon],{
        icon:globalThis.L.divIcon({html:pin,className:'price-pin',iconSize:[84,row.demo?49:35],iconAnchor:[42,20]}),
        keyboard:true,title:(row.demo?'DEMO · Fictional · ':'')+row.o.clubName+' · from '+money(lowest)
      }).addTo(layer);
      const popup=make('div');
      if(row.demo)popup.append(make('span','DEMO · Fictional availability','popup-demo'));
      popup.append(make('strong',row.o.clubName));
      for(const item of group.slice(0,3))popup.append(make('div',item.o.startLabel+' · '+item.o.duration+' min · '+money(item.o.priceMinor)));
      const action=make('button','View court details');action.type='button';action.addEventListener('click',()=>select(row,{fromMap:true}));popup.append(action);
      marker.bindPopup(popup);marker.on('click',()=>select(row,{fromMap:true}));
      // Leaflet opens bound popups on keypress, independently of marker click.
      // Register after bindPopup so Enter then moves focus to the same card.
      marker.on('keypress',event=>{
        if(event.originalEvent?.key==='Enter')select(row,{fromMap:true});
      });
      marker.getElement().dataset.resultPin=String([...groups.keys()].indexOf(id));
      marker.getElement().classList.toggle('selected',group.some(item=>item.key===selected));
      markers.set(id,marker);
    }
    if(groups.size){const points=[...groups.values()].map(v=>[v[0].position.lat,v[0].position.lon]);
      map.fitBounds(points,{padding:[45,45],maxZoom:14,animate:false});}
  }
  function render(nextRows,{mode:nextMode=mode}={}){
    mode=nextMode;rows=displayRows(nextRows,filterState());cards.clear();host.replaceChildren();
    const selectedRow=rows.find(row=>row.key===selected);
    if(!selectedRow)selected=null;
    // Screen-reader live regions are private result state too. TTL, filtering,
    // query clear and mode changes must remove the old announcement with pins.
    by('mapSelection').textContent=selectionText(selectedRow);
    const hasOrigin=Boolean(filterState().origin);
    by('radiusFilter').disabled=!hasOrigin;
    by('originNote').textContent=hasOrigin
      ?(mode==='demo'?'DEMO · Fictional starting place. ':'Starting place: '+TRUSTED_POSITION.venue+'. ')+
        'Distances are straight-line, not travel estimates. Unknown positions are excluded only when a radius is selected.'
      :'Choose a starting place to calculate straight-line distances. Your device location is not requested.';
    by('resultCount').textContent=rows.length?rows.length+(mode==='demo'?' fictional demo offer(s)':' fresh personally observed offer(s)'):
      mode==='demo'?'No fictional offers match these filters':'No verified offers match these filters';
    for(const [index,row] of rows.entries()){
      const {o,captured}=row,card=make('article',undefined,'card');card.tabIndex=-1;card.id='court-card-'+index;
      card.dataset.offerKind=row.demo?'demo':'real';
      const top=make('div',undefined,'card-top');
      top.append(make('span',row.demo?'DEMO · FICTIONAL AVAILABILITY':
        (PROVIDER_NAMES[o.sourceId]||'Unknown source')+' · personally observed · partial','badge'+(row.demo?' demo':'')));
      top.append(make('span',row.distance===null?'Position '+(row.position?'known':'unverified'):row.distance.toFixed(1)+' km'+(row.demo?' · DEMO':''),'distance'));
      card.append(top,make('h3',o.clubName),make('p','Court: '+o.courtName,'court-name'),
        make('p',o.startLabel+'–'+o.endLabel+' · '+o.duration+' min','offer-time'),make('p',o.date,'offer-date'));
      const price=make('p',money(o.priceMinor),'price');price.append(make('small','court total'));
      const priceRow=make('div',undefined,'price-row');priceRow.append(price);
      if(row.position){const locate=make('button','Show on map','map-card-button');locate.type='button';locate.addEventListener('click',()=>select(row));priceRow.append(locate);}
      card.append(priceRow);
      if(row.demo)card.append(make('p','Fictional example · Not bookable · No official provider link','demo-unbookable'));
      else{
        const a=make('a','Continue on '+(PROVIDER_NAMES[o.sourceId]||'official provider')+' (recheck availability)','official-link');
        a.href=o.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';card.append(a);
        card.append(make('small','Observed '+captured+' UTC · provider freshness/timezone unknown · not reserved','capture-note'));
      }
      cards.set(row.key,card);host.append(card);
    }
    if(!rows.length){const empty=make('div',undefined,'empty');empty.append(make('span','↗'),make('h3',mode==='demo'?'A different fictional match?':'Your next game is out there.'),
      make('p',mode==='demo'?'Try Cascais, Padel or Tennis, a wider time range or another display filter. All demo availability is fictional.':
        'No fresh personally observed offers. Other courts may be available. Find courts checks your connected sources.'));host.append(empty);}
    renderMap();
    if(selected&&cards.has(selected))cards.get(selected).classList.add('selected');
  }
  function setMode(next){
    mode=next==='demo'?'demo':'real';selected=null;
    by('mapSelection').textContent='';
    by('realMode').setAttribute('aria-pressed',String(mode==='real'));by('demoMode').setAttribute('aria-pressed',String(mode==='demo'));
    by('demoBanner').hidden=mode!=='demo';
    by('modeNotice').textContent=mode==='demo'?'DEMO · Fictional availability. No provider search or booking links.':'REAL · Only fresh, personally observed offers. Availability is unverified until a source responds.';
    const origins=by('searchOrigin');origins.replaceChildren(new Option('Choose a starting place',''),
      mode==='demo'?new Option(demoOrigin.label,'demo'):new Option(TRUSTED_POSITION.venue,'nature'));
    origins.value='';by('radiusFilter').value='any';by('budgetFilter').value='any';by('offerSort').value='time';
    render([],{mode});
  }
  for(const id of ['searchOrigin','radiusFilter','budgetFilter','offerSort'])by(id).addEventListener('change',onFilterChange);
  for(const [id,view] of [['listView','list'],['mapView','map'],['splitView','both']])by(id).addEventListener('click',()=>changeView(view));
  window.addEventListener('load',()=>{if(!map)renderMap();});
  return {render,setMode,changeView};
}
