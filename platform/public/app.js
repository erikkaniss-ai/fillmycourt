'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(v,c='EUR')=>v==null?'Price not supplied':new Intl.NumberFormat('en-IE',{style:'currency',currency:c}).format(v/100);
const uid=()=>crypto.randomUUID(),pretty=s=>s[0].toUpperCase()+s.slice(1);
const date=(n=0)=>{let d=new Date();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
let state={sport:'padel',venues:[],config:null,user:null,coords:null,version:0,hold:null,timer:null};
function stored(k){try{return JSON.parse(localStorage.getItem(k)||'[]')}catch{return []}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
async function api(path,method='GET',body,key){
 const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-GAC-Request':'1',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const t=await r.text();let j;try{j=JSON.parse(t)}catch{throw Error('The shared booking service is unavailable. Nothing was confirmed.')}
 if(!r.ok)throw Error(j.message||j.error||'Request failed');return j;
}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),4000)}
function modal(t){clearInterval(state.timer);$('#modal-content').innerHTML=t;if(!$('#modal').open)$('#modal').showModal()}
$('#modal-close').onclick=()=>{$('#modal').close();clearInterval(state.timer)};
$('#modal').addEventListener('close',()=>clearInterval(state.timer));
function login(){
 const conf=state.config?.auth||{};
 modal(`<p class="eyebrow">YOUR GAME STARTS HERE</p><h2 id="modal-title">Sign in to GetACourt.</h2><p class="intro">One player account. Your bookings in one place.</p><div class="auth-stack">${['google','apple'].map(p=>`<a class="button ${p==='apple'?'apple-auth':'button-quiet'} ${!conf[p]?'unavailable':''}" ${conf[p]?`href="/api/auth/${p}/start"`:'aria-disabled="true"'}>Continue with ${pretty(p)}</a>`).join('')}</div>${!conf.google&&!conf.apple?'<p class="alert">Sign-in is not configured on this deployment. No account has been created.</p>':''}<p class="subtle">No booking is created until you review the terms and confirm.</p>`);
}
function account(){
 if(!state.user)return login();
 if(!state.user.onboarded)return onboarding();
 modal(`<p class="eyebrow">YOUR ACCOUNT</p><h2 id="modal-title">${esc(state.user.display_name)}</h2><p>${esc(state.user.email)}</p><div class="auth-stack"><button id="edit-profile" class="button button-quiet">Edit player profile</button><a class="button button-quiet" href="/fmc/">FillMyCourt club workspace</a><button id="logout" class="button button-quiet">Sign out</button></div>`);
 $('#edit-profile').onclick=onboarding;$('#logout').onclick=async()=>{try{await api('/auth/logout','POST');state.user=null;$('#account-open').textContent='Sign in';$('#modal').close()}catch(e){toast(e.message)}};
}
function onboarding(){
 let p=state.user?.profile||{};
 modal(`<p class="eyebrow">MAKE IT YOUR GAME</p><h2 id="modal-title">Your player profile.</h2><form id="profile-form" class="checkout-form"><label>Name<input id="p-name" required maxlength="100" value="${esc(state.user?.display_name||'')}"></label><label>Home city<input id="p-city" required maxlength="100" value="${esc(p.city||'')}"></label><label>Primary sport<select id="p-sport">${['padel','tennis','squash','badminton','pickleball'].map(x=>`<option ${p.sports?.includes(x)?'selected':''}>${x}</option>`).join('')}</select></label><label>Level<select id="p-level">${['not_set','beginner','intermediate','advanced'].map(x=>`<option ${p.skill_level===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="policy-check"><input id="p-terms" type="checkbox" required> I accept the <a href="/legal/terms" target="_blank" rel="noopener">terms</a> and have read the <a href="/legal/privacy" target="_blank" rel="noopener">privacy notice</a>.</label><label class="policy-check"><input id="p-marketing" type="checkbox" ${p.marketing_opt_in?'checked':''}> Optional: send me product updates.</label><p id="p-error" class="alert" hidden></p><button class="button button-primary">Save my profile</button></form>`);
 $('#profile-form').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{await api('/me/profile','PUT',{display_name:$('#p-name').value,city:$('#p-city').value,sports:[$('#p-sport').value],skill_level:$('#p-level').value,locale:'en',marketing_opt_in:$('#p-marketing').checked,accept_terms:$('#p-terms').checked,terms_version:state.config.terms_version});state.user=(await api('/me')).user;$('#account-open').textContent=state.user.display_name;$('#modal').close();toast('Player profile saved.')}catch(er){$('#p-error').hidden=false;$('#p-error').textContent=er.message}finally{btn.disabled=false}};
}
function query(){return {sport:state.sport,date:$('#date').value,time:$('#time').value,end_time:$('#end-time').value,duration:$('#duration').value,location:$('#location').value,radius:$('#radius').value,indoor:$('#indoor').value,sort:$('#sort').value,...(state.coords?{lat:state.coords[0],lon:state.coords[1]}:{})}}
async function search(scroll=false){
 const v=++state.version;$('#search-error').hidden=true;$('#venue-list').innerHTML='<p class="subtle">Checking club inventory…</p>';
 try{const j=await api('/availability?'+new URLSearchParams(query()));if(v!==state.version)return;state.venues=j.venues;render();$('#results-title').textContent=state.venues.length?'Your next good game.':'No available courts in this search.';$('#results-meta').textContent=state.venues.length?`${new Set(state.venues.map(x=>x.id)).size} clubs · ${state.sport} · ${$('#date').value}${j.partial?' · Limited results: narrow the radius.':''}`:'Try another date or area. We only show inventory connected and enabled by the club.';if(scroll)$('#results').scrollIntoView({behavior:'smooth'})}catch(e){if(v!==state.version)return;$('#venue-list').innerHTML='';$('#search-error').hidden=false;$('#search-error').textContent=e.message}
}
function render(){
 const saved=stored('gac-favourites');let vs=state.venues.filter(x=>!$('#saved-only').checked||saved.includes(x.id));
 $('#venue-list').innerHTML=vs.map((v,i)=>`<article class="venue-card"><div class="venue-visual theme-${['blue','coral','sand'][i%3]}" aria-hidden="true"><i></i><span>${v.indoor?'INDOOR':'OUTDOOR'}</span></div><div class="venue-content"><div class="venue-title-row"><h3>${esc(v.name)}</h3><button class="save-venue" data-venue="${esc(v.id)}" aria-label="Save club">${saved.includes(v.id)?'♥':'♡'}</button></div><p class="venue-meta">${esc(v.city)} · ${v.distance} km · ${esc(v.court_name)}</p><div class="slot-grid">${v.slots.map((s,k)=>`<button class="slot" data-v="${i}" data-k="${k}"><strong>${s.time}</strong><span>${money(s.price_minor,s.currency)} · ${s.duration} min</span></button>`).join('')}</div><p class="subtle">Whole-court price · ${esc(v.timezone)}</p></div></article>`).join('')||'<div class="empty"><h3>Room for your next game.</h3><p>No slots meet these filters. No reservation has been made.</p></div>';
 $$('.save-venue').forEach(b=>b.onclick=()=>{let ids=stored('gac-favourites');ids=ids.includes(b.dataset.venue)?ids.filter(x=>x!==b.dataset.venue):[...ids,b.dataset.venue];save('gac-favourites',ids);render()});
 $$('.slot').forEach(b=>b.onclick=()=>choose(vs[Number(b.dataset.v)],vs[Number(b.dataset.v)].slots[Number(b.dataset.k)]));
}
async function choose(v,s){
 if(!state.user)return login();if(!state.user.onboarded)return onboarding();
 modal('<h2 id="modal-title">Checking your court…</h2>');
 try{const q=await api('/quote?'+new URLSearchParams({court_id:s.court_id,date:s.date,time:s.time,duration:s.duration}));
 modal(`<p class="eyebrow">${esc(v.name)}</p><h2 id="modal-title">Your next game.</h2><div class="summary"><p>${esc(s.date)} · ${s.time} · ${s.duration} min</p><p>${esc(v.court_name)}</p><h3>${money(q.price_minor,q.currency)} <small>whole court</small></h3><p class="subtle">Free cancellation until ${q.policy.cancellation_hours} hours before play. Payment at the venue.</p></div><p id="hold-error" class="alert" hidden></p><button id="hold" class="button button-primary">Reserve for 10 minutes →</button>`);
 const key=uid();$('#hold').onclick=async()=>{$('#hold').disabled=true;try{state.hold=await api('/holds','POST',{court_id:s.court_id,date:s.date,time:s.time,duration:s.duration},key);checkout()}catch(e){$('#hold-error').hidden=false;$('#hold-error').textContent=e.message;$('#hold').disabled=false}};
 }catch(e){modal(`<h2 id="modal-title">This slot could not be verified.</h2><p class="alert">${esc(e.message)}</p>`)}
}
function checkout(){const b=state.hold;
 modal(`<p class="eyebrow">COURT HELD · <span id="countdown"></span></p><h2 id="modal-title">Review. Confirm. Play.</h2><div class="summary"><h3>${esc(b.venue_name)}</h3><p>${b.date} · ${b.time} · ${b.duration} min</p><h3>${money(b.price_minor,b.currency)}</h3></div><form id="confirm-form" class="checkout-form"><label>Players<select id="participants">${(b.sport==='squash'?[1,2]:[1,2,3,4]).map(n=>`<option>${n}</option>`).join('')}</select></label><label class="policy-check"><input id="accept" type="checkbox" required> I accept free cancellation up to ${b.policy.cancellation_hours} hours before play and payment at the venue.</label><p class="subtle">No online payment will be taken.</p><p id="confirm-error" class="alert" hidden></p><button class="button button-primary" id="confirm-btn">Confirm booking →</button></form>`);
 const tick=()=>{let left=Math.max(0,b.expires-Math.floor(Date.now()/1000));$('#countdown').textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;if(!left){$('#confirm-btn').disabled=true;$('#confirm-error').hidden=false;$('#confirm-error').textContent='Your hold expired. Please search again.'}};tick();state.timer=setInterval(tick,1000);const key=uid();
 $('#confirm-form').onsubmit=async e=>{e.preventDefault();$('#confirm-btn').disabled=true;try{let done=await api('/bookings/'+b.id+'/confirm','POST',{participants:Number($('#participants').value),accept_policy:$('#accept').checked,payment:'venue'},key);modal(`<p class="eyebrow">CONFIRMED</p><h2 id="modal-title">You’re on court.</h2><p>${esc(done.venue_name)} · ${done.date} · ${done.time}</p><p class="subtle">${esc(done.id)}</p><a class="button button-primary" href="/api/bookings/${encodeURIComponent(done.id)}/calendar.ics">Add to calendar</a><p>Payment: due at the venue.</p>`);search()}catch(er){$('#confirm-error').hidden=false;$('#confirm-error').textContent=er.message;$('#confirm-btn').disabled=false}};
}
async function myBookings(){if(!state.user)return login();try{const j=await api('/bookings');modal(`<p class="eyebrow">YOUR COURT TIME</p><h2 id="modal-title">My bookings.</h2>${j.bookings.map(b=>`<article class="booking-item"><h3>${esc(b.venue_name)}</h3><p>${b.date} · ${b.time} · ${b.duration} min · ${money(b.amount_known?b.price_minor:null,b.currency)}</p><p class="status">${esc(b.status)}</p>${['held','confirmed'].includes(b.status)?`<button class="text-action cancel-booking" data-id="${esc(b.id)}">Cancel booking</button>`:''}</article>`).join('')||'<p>No bookings yet.</p>'}`);$$('.cancel-booking').forEach(btn=>btn.onclick=async()=>{if(!confirm('Cancel this booking under the displayed policy?'))return;try{await api('/bookings/'+btn.dataset.id+'/cancel','POST');myBookings();search()}catch(e){toast(e.message)}})}catch(e){toast(e.message)}}
$$('.sport').forEach(b=>b.onclick=()=>{state.sport=b.dataset.sport;$$('.sport').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',x===b)});$('#duration').innerHTML=(state.sport==='squash'?[30,60]:[60,90,120]).map(n=>`<option value="${n}">${n} min</option>`).join('');search()});
$('#search-form').onsubmit=e=>{e.preventDefault();search(true)};['radius','indoor','sort'].forEach(x=>$('#'+x).onchange=()=>search());$('#saved-only').onchange=render;
$('#account-open').onclick=account;$('#my-bookings').onclick=myBookings;
$$('[data-quick]').forEach(b=>b.onclick=()=>{const k=b.dataset.quick;$('#date').value=date(k==='tomorrow'?1:k==='weekend'?(6-new Date().getDay()+7)%7:0);search()});
$('#near-me').onclick=()=>{if(!navigator.geolocation)return toast('Select a city instead.');navigator.geolocation.getCurrentPosition(p=>{state.coords=[p.coords.latitude,p.coords.longitude];$('#location-note').textContent='Using your location; times remain club-local.';search()},()=>toast('Location unavailable. Select a city.'),{timeout:10000,maximumAge:60000})};
$('#location').onchange=()=>{state.coords=null};
async function init(){
 $('#date').min=date();$('#date').value=date(1);
 try{state.config=await api('/config');state.user=(await api('/me')).user;$('#account-open').textContent=state.user?.display_name||'Sign in';if(new URLSearchParams(location.search).has('auth_error'))toast('Sign-in failed or was cancelled. Please try again.');if(state.user&&!state.user.onboarded)onboarding();await search()}catch(e){$('#search-error').hidden=false;$('#search-error').textContent=e.message}
}
init();
