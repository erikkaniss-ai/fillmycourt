const DEMO_VENUES = [
  {id:'demo-cascais',name:'GetACourt Demo Club — Cascais',city:'Cascais',distance:2.4,sports:['padel','tennis'],indoor:true,rating:4.8,surfaces:'Panoramic · synthetic turf',amenities:['Parking','Showers','Racket rental'],slots:[['18:00',28],['19:30',32],['21:00',26]]},
  {id:'demo-estoril',name:'GetACourt Demo Club — Estoril',city:'Estoril',distance:4.1,sports:['padel','squash'],indoor:true,rating:4.7,surfaces:'Indoor · competition courts',amenities:['Cafe','Lockers','Access code'],slots:[['18:30',24],['20:00',30],['21:30',22]]},
  {id:'demo-lisbon',name:'GetACourt Demo Club — Lisboa',city:'Lisboa',distance:18.6,sports:['padel','tennis','badminton'],indoor:false,rating:4.6,surfaces:'Outdoor · mixed surfaces',amenities:['Pro shop','Coaches','Free parking'],slots:[['17:30',20],['19:00',29],['20:30',29]]}
];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { mode:'court', results:[], selected:null, hold:null, indoorOnly:false };

function isoToday(offset=0){const d=new Date();d.setDate(d.getDate()+offset);return d.toISOString().slice(0,10)}
$('#dateInput').value = isoToday();

function apiBase(path){return `./api/${path}`}
async function api(path, options={}){
  const r = await fetch(apiBase(path), {headers:{'Content-Type':'application/json'},...options});
  if(!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

function toast(message){
  let el=$('.toast');if(!el){el=document.createElement('div');el.className='toast';document.body.append(el)}
  el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200);
}

$$('.mode-tab').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.mode-tab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.mode=btn.dataset.mode;
  if(state.mode==='match') toast('Open matches are wired into the booking model; public launch follows court booking.');
}));
$$('[data-scroll="how"]').forEach(btn=>btn.addEventListener('click',()=>$('#how').scrollIntoView({behavior:'smooth'})));

$('#nearMeBtn').addEventListener('click',()=>{
  if(!navigator.geolocation){toast('Location is not available in this browser.');return}
  navigator.geolocation.getCurrentPosition(()=>{ $('#locationInput').value='Near me'; toast('Using your current area for search.'); },()=>toast('Location permission was not granted.'));
});

$$('.quick-chip').forEach(btn=>btn.addEventListener('click',()=>{
  const key=btn.dataset.quick;
  if(key==='tonight'){ $('#dateInput').value=isoToday(); $('#timeSelect').value='18:00'; }
  if(key==='weekend'){ const d=new Date();const day=d.getDay();const add=(6-day+7)%7||7; $('#dateInput').value=isoToday(add); $('#timeSelect').value='10:00'; }
  if(key==='lastminute'){ const h=Math.min(22,new Date().getHours()+1); $('#dateInput').value=isoToday(); $('#timeSelect').value=String(h).padStart(2,'0')+':00'; }
  if(key==='indoor'){state.indoorOnly=!state.indoorOnly;btn.classList.toggle('active',state.indoorOnly);toast(state.indoorOnly?'Indoor filter on':'Indoor filter off')}
  runSearch();
}));

$('#searchBtn').addEventListener('click',runSearch);
$('#sortSelect').addEventListener('change',renderResults);
$('#filterBtn').addEventListener('click',()=>{state.indoorOnly=!state.indoorOnly;toast(state.indoorOnly?'Indoor only':'All courts');renderResults()});

async function runSearch(){
  $('#resultsSection').hidden=false;$('#venueList').innerHTML='<div class="empty-state">Checking available courts…</div>';
  $('#resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
  const q={location:$('#locationInput').value,sport:$('#sportSelect').value,date:$('#dateInput').value,time:$('#timeSelect').value,duration:Number($('#durationSelect').value)};
  try{
    const params=new URLSearchParams(q).toString();const data=await api(`availability?${params}`);state.results=data.venues||[];
  }catch{
    state.results=DEMO_VENUES.filter(v=>v.sports.includes(q.sport)).map(v=>({...v,slots:v.slots.map(([time,price],i)=>({id:`${v.id}-${q.date}-${time}`,time,price,duration:q.duration,provider:'demo'}))}));
  }
  $('#resultsTitle').textContent=`${state.results.length} places to play ${prettySport(q.sport)}`;
  renderResults();
}

function prettySport(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function renderResults(){
  let venues=[...state.results];if(state.indoorOnly)venues=venues.filter(v=>v.indoor);
  const sort=$('#sortSelect').value;
  if(sort==='price')venues.sort((a,b)=>minPrice(a)-minPrice(b));
  if(sort==='distance')venues.sort((a,b)=>a.distance-b.distance);
  if(sort==='time')venues.sort((a,b)=>(a.slots?.[0]?.time||'99:99').localeCompare(b.slots?.[0]?.time||'99:99'));
  const list=$('#venueList');
  if(!venues.length){list.innerHTML='<div class="empty-state">No matching demo inventory. Try another sport or turn off Indoor only.</div>';return}
  list.innerHTML=venues.map(v=>venueCard(v)).join('');
  $$('.slot-btn').forEach(btn=>btn.addEventListener('click',()=>openBooking(btn.dataset.venue,btn.dataset.slot)));
}
function minPrice(v){return Math.min(...(v.slots||[]).map(s=>s.price||999))}
function venueCard(v){
  const slots=(v.slots||[]).slice(0,4).map(s=>`<button class="slot-btn" data-venue="${esc(v.id)}" data-slot="${esc(s.id)}"><span class="slot-time">${esc(s.time)}</span><span class="slot-price">€${Number(s.price).toFixed(0)} · ${s.duration||90}m</span></button>`).join('');
  return `<article class="venue-card">
    <div class="venue-art" aria-hidden="true"></div>
    <div><div class="venue-top"><div class="venue-name">${esc(v.name)}</div><span class="demo-badge">${v.live?'LIVE':'DEMO'}</span></div>
    <div class="venue-meta">★ ${v.rating||'—'} · ${v.distance} km · ${v.indoor?'Indoor':'Outdoor'} · ${esc(v.surfaces||'Racket courts')}</div>
    <div class="slot-row">${slots||'<span class="venue-meta">No slots in this window</span>'}</div>
    <div class="venue-footer"><span>${(v.amenities||[]).slice(0,3).map(esc).join(' · ')}</span><strong>from €${minPrice(v)}</strong></div></div>
  </article>`
}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function findSelection(venueId,slotId){const venue=state.results.find(v=>v.id===venueId);const slot=venue?.slots?.find(s=>s.id===slotId);return venue&&slot?{venue,slot}:null}
async function openBooking(venueId,slotId){
  state.selected=findSelection(venueId,slotId);if(!state.selected)return;
  const {venue,slot}=state.selected;state.hold=null;openSheet();
  $('#sheetContent').innerHTML=`<div class="checkout-kicker">Booking</div><h2 class="checkout-title">${esc(venue.name)}</h2>
  <div class="checkout-summary"><div class="summary-line"><span>Date</span><strong>${esc($('#dateInput').value)}</strong></div><div class="summary-line"><span>Time</span><strong>${esc(slot.time)} · ${slot.duration||90} min</strong></div><div class="summary-line"><span>Sport</span><strong>${prettySport($('#sportSelect').value)}</strong></div><div class="summary-line"><span>Total</span><strong>€${Number(slot.price).toFixed(2)}</strong></div></div>
  <button class="primary-btn" id="holdBtn">Hold this court for 10 minutes <span>→</span></button><p class="hold-note">No charge yet. A booking hold prevents the slot from disappearing while you confirm player and payment details.</p>`;
  $('#holdBtn').addEventListener('click',createHold);
}
async function createHold(){
  const {venue,slot}=state.selected;let hold;
  try{hold=await api('hold',{method:'POST',body:JSON.stringify({venueId:venue.id,slotId:slot.id,date:$('#dateInput').value})})}
  catch{hold={id:`local-${Date.now()}`,expiresAt:new Date(Date.now()+10*60e3).toISOString(),demo:true}}
  state.hold=hold;renderCheckout();
}
function renderCheckout(){
  const {venue,slot}=state.selected;
  $('#sheetContent').innerHTML=`<div class="checkout-kicker">Court held</div><h2 class="checkout-title">Complete your booking</h2>
  <div class="checkout-summary"><div class="summary-line"><span>${esc(venue.name)}</span><strong>€${Number(slot.price).toFixed(2)}</strong></div><div class="summary-line"><span>${esc($('#dateInput').value)} · ${esc(slot.time)}</span><strong>${slot.duration||90} min</strong></div></div>
  <form class="checkout-form" id="checkoutForm">
    <label>Your name<input required name="name" autocomplete="name" placeholder="Alex Morgan"></label>
    <label>Email<input required name="email" type="email" autocomplete="email" placeholder="alex@example.com"></label>
    <label>Players<select name="players"><option value="1">Just me for now</option><option value="2">2 players</option><option value="4" selected>4 players</option></select></label>
    <div><div class="field"><span>Payment</span></div><div class="choice-row"><button type="button" class="choice-card active" data-pay="venue"><strong>Pay at venue</strong><br><small>Pilot-safe checkout</small></button><button type="button" class="choice-card" data-pay="card"><strong>Card / split</strong><br><small>Payment connector next</small></button></div></div>
    <input type="hidden" name="payment" value="venue">
    <button class="primary-btn" type="submit">Confirm booking <span>→</span></button>
    <p class="hold-note">By confirming, you accept the venue cancellation policy shown before payment. Demo venues do not create a real-world reservation.</p>
  </form>`;
  $$('.choice-card').forEach(btn=>btn.addEventListener('click',()=>{$$('.choice-card').forEach(x=>x.classList.remove('active'));btn.classList.add('active');$('#checkoutForm [name="payment"]').value=btn.dataset.pay;if(btn.dataset.pay==='card')toast('Card + split payment is designed, but not enabled in the pilot checkout yet.')}));
  $('#checkoutForm').addEventListener('submit',confirmBooking);
}
async function confirmBooking(e){
  e.preventDefault();const fd=new FormData(e.currentTarget);const {venue,slot}=state.selected;
  const payload={holdId:state.hold?.id,venueId:venue.id,slotId:slot.id,date:$('#dateInput').value,time:slot.time,duration:slot.duration||90,price:slot.price,sport:$('#sportSelect').value,name:fd.get('name'),email:fd.get('email'),players:Number(fd.get('players')),payment:fd.get('payment')};
  let booking;
  try{booking=await api('bookings',{method:'POST',body:JSON.stringify(payload)})}
  catch{booking={...payload,id:`GAC-${Math.random().toString(36).slice(2,8).toUpperCase()}`,status:'confirmed',demo:true,createdAt:new Date().toISOString()}}
  saveLocalBooking(booking);renderSuccess(booking);
}
function renderSuccess(b){
  $('#sheetContent').innerHTML=`<div class="success-card"><div class="success-mark">✓</div><div class="checkout-kicker">Confirmed${b.demo?' · demo':''}</div><h2 class="checkout-title">Your court is booked.</h2><p>${esc(b.date)} at ${esc(b.time)} · ${prettySport(b.sport)} · ${b.duration} min</p><div class="booking-code">${esc(b.id)}</div><button class="primary-btn" id="doneBtn">Done <span>✓</span></button><p class="hold-note">Live integrations can attach payment receipt, access code, directions and invite/split-payment links to this same booking record.</p></div>`;
  $('#doneBtn').addEventListener('click',closeSheet);
}
function saveLocalBooking(b){const arr=JSON.parse(localStorage.getItem('gac-bookings')||'[]');arr.unshift(b);localStorage.setItem('gac-bookings',JSON.stringify(arr.slice(0,30)))}
function openSheet(){$('#sheetBackdrop').hidden=false;$('#bookingSheet').classList.add('open');$('#bookingSheet').setAttribute('aria-hidden','false')}
function closeSheet(){$('#bookingSheet').classList.remove('open');$('#bookingSheet').setAttribute('aria-hidden','true');setTimeout(()=>$('#sheetBackdrop').hidden=true,220)}
$('#sheetClose').addEventListener('click',closeSheet);$('#sheetBackdrop').addEventListener('click',closeSheet);

$('#myBookingsBtn').addEventListener('click',()=>{renderMyBookings();$('#bookingsDialog').showModal()});
function renderMyBookings(){const arr=JSON.parse(localStorage.getItem('gac-bookings')||'[]');$('#myBookingsList').innerHTML=arr.length?arr.map(b=>`<div class="booking-item"><strong>${esc(b.date)} · ${esc(b.time)} · ${prettySport(b.sport||'court')}</strong><small>${esc(b.id)} · ${b.duration||90} min · €${Number(b.price||0).toFixed(2)} ${b.demo?'· demo':''}</small></div>`).join(''):'<div class="empty-state">No bookings on this device yet.</div>'}

runSearch();
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}))}
