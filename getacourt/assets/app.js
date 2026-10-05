(() => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const state = {
    sport:"padel", venues:[], filter:"all", sort:"recommended", view:"list",
    selected:null, hold:null, timer:null, map:null, mapLayer:null,
    platform:{ bookingEnabled:false, authConfigured:false }, session:null, profile:null, geo:null
  };

  const el = {
    form:q("#searchForm"), location:q("#locationInput"), date:q("#dateInput"),
    from:q("#fromInput"), to:q("#toInput"), grid:q("#resultsGrid"),
    count:q("#resultCount"), title:q("#resultsTitle"), refresh:q("#refreshButton"),
    dialog:q("#bookingDialog"), bookingForm:q("#bookingForm"), summary:q("#bookingSummary"),
    holdBanner:q("#holdBanner"), countdown:q("#holdCountdown"), progress:q("#dialogProgress"),
    name:q("#nameInput"), email:q("#emailInput"), bookingsDialog:q("#bookingsDialog"),
    bookingsList:q("#bookingsList"), myBookings:q("#myBookingsButton"),
    closeBookings:q("#closeBookingsButton"), toast:q("#toast"),
    authButton:q("#authButton"), authDialog:q("#authDialog"), authForm:q("#authForm"),
    authEmail:q("#authEmail"), authStatus:q("#authStatus"), closeAuth:q("#closeAuthButton"),
    profileDialog:q("#profileDialog"), profileForm:q("#profileForm"), profileName:q("#profileName"),
    profileArea:q("#profileArea"), profileMarketing:q("#profileMarketing"), profileStatus:q("#profileStatus"),
    closeProfile:q("#closeProfileButton"), profileSignOut:q("#profileSignOutButton"),
    nearMe:q("#nearMeButton"), radiusNote:q("#radiusNote"),
    sortSelect:q("#sortSelect"), listView:q("#listViewButton"), mapView:q("#mapViewButton"),
    resultsMap:q("#resultsMap")
  };

  const now = new Date();
  const today = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
  el.date.value=today; el.date.min=today;
  el.name.value=localStorage.getItem("gac.name")||"";
  el.email.value=localStorage.getItem("gac.email")||"";
  state.session=loadSession();
  consumeAuthHash();

  function esc(v){return String(v==null?"":v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
  function money(v,currency){return new Intl.NumberFormat("en-GB",{style:"currency",currency:currency||"EUR",maximumFractionDigits:0}).format(v);}
  function prettyDate(v){return new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short"}).format(new Date(v+"T12:00:00"));}
  function toast(message){el.toast.textContent=message;el.toast.classList.add("show");setTimeout(()=>el.toast.classList.remove("show"),2600);}
  function uid(){return crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(16).slice(2);}

  function loadSession(){
    try{return JSON.parse(localStorage.getItem("gac.session")||"null");}catch{return null;}
  }
  function saveSession(data){
    if(!data){localStorage.removeItem("gac.session");state.session=null;state.profile=null;updateAuthUI();return;}
    state.session={
      accessToken:data.access_token||data.accessToken,
      refreshToken:data.refresh_token||data.refreshToken,
      expiresAt:Date.now()+Number(data.expires_in||3600)*1000
    };
    localStorage.setItem("gac.session",JSON.stringify(state.session));
    updateAuthUI();
  }
  function jwtPayload(token){
    try{
      const part=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
      return JSON.parse(decodeURIComponent(Array.from(atob(part)).map(c=>"%"+c.charCodeAt(0).toString(16).padStart(2,"0")).join("")));
    }catch{return {};}
  }
  function consumeAuthHash(){
    const hash=new URLSearchParams(location.hash.replace(/^#/,""));
    const access=hash.get("access_token"), refresh=hash.get("refresh_token");
    if(access&&refresh){
      saveSession({access_token:access,refresh_token:refresh,expires_in:Number(hash.get("expires_in")||3600)});
      history.replaceState(null,"",location.pathname+location.search);
      setTimeout(()=>{toast("Signed in to GetACourt.");loadProfile(true);},100);
    }
  }
  async function accessToken(){
    if(!state.session?.accessToken) return null;
    if((state.session.expiresAt||0)-Date.now()>60000) return state.session.accessToken;
    if(!state.session.refreshToken){saveSession(null);return null;}
    try{
      const data=await api("/api/gac/auth/refresh",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({refreshToken:state.session.refreshToken})},false);
      saveSession(data); return state.session.accessToken;
    }catch{saveSession(null);return null;}
  }
  function updateAuthUI(){
    if(!el.authButton) return;
    const payload=state.session?.accessToken?jwtPayload(state.session.accessToken):{};
    const email=payload.email||"";
    const label=state.profile?.full_name||email;
    el.authButton.textContent=label ? label : "Sign in";
    el.authButton.title=label ? "Signed in · open player profile" : "Sign in";
  }

  async function api(path,options={},auth=false){
    const opts={...options,headers:new Headers(options.headers||{})};
    if(auth){
      const token=await accessToken();
      if(!token) throw Object.assign(new Error("Sign in is required."),{code:"AUTH_REQUIRED"});
      opts.headers.set("authorization","Bearer "+token);
    }
    const res=await fetch(path,opts);
    let detail={};
    if(!res.ok){
      try{detail=await res.json();}catch{}
      const err=new Error(detail.message||detail.error||("Request failed ("+res.status+")"));
      err.code=detail.error||"REQUEST_FAILED"; err.status=res.status; throw err;
    }
    return res.status===204?{}:res.json();
  }

  async function loadPlatform(){
    try{state.platform=await api("/api/gac/platform-config");}
    catch{state.platform={bookingEnabled:false,authConfigured:false};}
    const strip=q("#previewStrip");
    if(strip) strip.textContent="Staging environment · "+(state.platform.bookingEnabled?"native booking enabled":"bookings disabled");
  }

  function loading(){el.count.textContent="Searching live inventory…";el.grid.innerHTML='<div class="skeleton"></div><div class="skeleton"></div>';}
  async function search(){
    const p={sport:state.sport,location:el.location.value.trim()||"Cascais",date:el.date.value,from:el.from.value,to:el.to.value};
    if(state.geo){p.lat=String(state.geo.lat);p.lon=String(state.geo.lon);}
    loading();
    try{
      const data=await api("/api/gac/search?"+new URLSearchParams(p).toString());
      state.venues=data.venues||[];
      if(el.radiusNote){
        const s=data.search||{};
        el.radiusNote.textContent=s.radiusUsedKm
          ? (s.expanded ? "Expanded search to "+s.radiusUsedKm+" km based on availability." : "Searching within "+s.radiusUsedKm+" km.")
          : "";
      }
    }catch(err){
      state.venues=[];
      if(el.radiusNote) el.radiusNote.textContent="";
      toast(err.message||"Live availability is temporarily unavailable.");
    }
    el.title.textContent=state.geo ? "Courts near you" : "Courts around "+p.location;
    render();
    q("#resultsSection").scrollIntoView({behavior:"smooth",block:"start"});
  }

  function useCurrentLocation(){
    if(!navigator.geolocation){toast("Location is not available in this browser.");return;}
    el.nearMe.disabled=true;el.nearMe.textContent="Locating…";
    navigator.geolocation.getCurrentPosition(
      pos=>{
        state.geo={lat:pos.coords.latitude,lon:pos.coords.longitude};
        el.location.value="Current location";
        el.nearMe.disabled=false;el.nearMe.textContent="◎ Near me";
        if(el.radiusNote) el.radiusNote.textContent="Starting with nearby courts and expanding only if needed.";
        search();
      },
      ()=>{
        el.nearMe.disabled=false;el.nearMe.textContent="◎ Near me";
        toast("Could not access your location. Search by area instead.");
      },
      {enableHighAccuracy:false,timeout:8000,maximumAge:300000}
    );
  }
  function filteredSlots(v){
    let slots=(v.slots||[]).filter(s=>s.status==="available");
    if(state.filter==="indoor") slots=slots.filter(s=>s.indoor===true);
    if(state.filter==="under35") slots=slots.filter(s=>s.price<35);
    if(state.filter==="90min") slots=slots.filter(s=>s.duration===90);
    return slots;
  }
  function visible(v){return filteredSlots(v).length>0;}
  function earliest(v){
    const slots=filteredSlots(v);
    return slots.length ? Math.min(...slots.map(s=>new Date(s.startsAt).getTime())) : Number.POSITIVE_INFINITY;
  }
  function lowestPrice(v){
    const slots=filteredSlots(v);
    return slots.length ? Math.min(...slots.map(s=>Number(s.price))) : Number.POSITIVE_INFINITY;
  }
  function sortedVenues(){
    const venues=state.venues.filter(visible).slice();
    if(state.sort==="distance"){
      venues.sort((a,b)=>(a.distanceKm??Number.POSITIVE_INFINITY)-(b.distanceKm??Number.POSITIVE_INFINITY)||earliest(a)-earliest(b));
    }else if(state.sort==="time"){
      venues.sort((a,b)=>earliest(a)-earliest(b)||(a.distanceKm??9999)-(b.distanceKm??9999));
    }else if(state.sort==="price"){
      venues.sort((a,b)=>lowestPrice(a)-lowestPrice(b)||earliest(a)-earliest(b));
    }else{
      const score=v=>(v.distanceKm==null?1000:v.distanceKm*10)+earliest(v)/3600000+lowestPrice(v)/20;
      venues.sort((a,b)=>score(a)-score(b));
    }
    return venues;
  }
  function updateView(){
    const mapMode=state.view==="map";
    el.grid.hidden=mapMode;
    el.resultsMap.hidden=!mapMode;
    el.listView?.classList.toggle("active",!mapMode);
    el.mapView?.classList.toggle("active",mapMode);
    el.listView?.setAttribute("aria-pressed",String(!mapMode));
    el.mapView?.setAttribute("aria-pressed",String(mapMode));
    if(mapMode) requestAnimationFrame(renderMap);
  }
  function renderMap(){
    if(!el.resultsMap||!window.L) return;
    const venues=sortedVenues().filter(v=>Number.isFinite(v.lat)&&Number.isFinite(v.lon));
    if(!venues.length){
      state.view="list";
      updateView();
      toast("Map view is available when venue coordinates are connected.");
      return;
    }
    if(!state.map){
      state.map=L.map(el.resultsMap,{zoomControl:true,scrollWheelZoom:false});
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
        maxZoom:19,
        attribution:"&copy; OpenStreetMap contributors"
      }).addTo(state.map);
      state.mapLayer=L.layerGroup().addTo(state.map);
    }
    state.mapLayer.clearLayers();
    const bounds=[];
    venues.forEach(v=>{
      bounds.push([v.lat,v.lon]);
      const slots=filteredSlots(v).slice(0,3);
      const distance=v.distanceKm==null?"":(" · "+Number(v.distanceKm).toFixed(1)+" km");
      const popup='<div class="map-popup"><strong>'+esc(v.name)+'</strong><small>'+esc(v.area||"")+distance+'</small>'+
        slots.map(s=>'<button type="button" class="map-slot" data-v="'+esc(v.id)+'" data-s="'+esc(s.id)+'">'+esc(s.time)+' · '+esc(s.duration)+' min · '+money(s.price,s.currency)+'</button>').join("")+'</div>';
      L.marker([v.lat,v.lon]).addTo(state.mapLayer).bindPopup(popup);
    });
    state.map.fitBounds(bounds,{padding:[28,28],maxZoom:14});
    setTimeout(()=>state.map.invalidateSize(),0);
  }
  function render(){
    const venues=sortedVenues();
    const n=venues.reduce((a,v)=>a+filteredSlots(v).length,0);
    el.count.textContent=n+" available slot"+(n===1?"":"s")+" · "+venues.length+" venue"+(venues.length===1?"":"s");
    if(!venues.length){
      el.grid.innerHTML='<div class="empty-state"><div class="empty-orbit"></div><h3>No live courts match this search</h3><p>There is no connected native inventory for this time window yet. GetACourt no longer fabricates preview availability.</p></div>';
      return;
    }
    el.grid.innerHTML="";
    venues.forEach(v=>{
      const card=document.createElement("article");card.className="venue-card";
      const tags=(v.tags||[]).map(t=>"<span>"+esc(t)+"</span>").join("");
      const slots=filteredSlots(v).map(s=>
        '<button class="slot" type="button" data-v="'+esc(v.id)+'" data-s="'+esc(s.id)+'" '+(s.status!=="available"?"disabled":"")+'>'+
        '<strong>'+esc(s.time)+'</strong><small>'+esc(s.duration)+' min · '+money(s.price,s.currency)+'</small></button>'
      ).join("");
      const distance=v.distanceKm==null?"":'<span class="distance">'+Number(v.distanceKm).toFixed(1)+' km</span>';
      card.innerHTML='<div class="venue-top"><div><div class="venue-kicker">'+esc(v.area||"Connected venue")+' · '+esc(v.sport||state.sport)+'</div>'+
        '<h3>'+esc(v.name)+'</h3><div class="venue-tags">'+tags+'</div></div>'+distance+'</div>'+
        '<div class="slot-list">'+slots+'</div><p class="venue-source">Availability source: '+esc(v.source||"FillMyCourt booking core")+'</p>';
      el.grid.appendChild(card);
    });
    qa(".slot",el.grid).forEach(b=>b.addEventListener("click",()=>selectSlot(b.dataset.v,b.dataset.s)));
    updateView();
  }

  async function requireSignedIn(){
    const token=await accessToken();
    if(token) return true;
    openAuth("Sign in is required to hold or manage a court.");
    return false;
  }
  async function selectSlot(venueId,slotId){
    const venue=state.venues.find(v=>v.id===venueId);
    const slot=venue&&venue.slots.find(s=>s.id===slotId);
    if(!venue||!slot) return;
    if(!state.platform.bookingEnabled){toast("Native booking is disabled in staging.");return;}
    if(!(await requireSignedIn())) return;
    state.selected={venue,slot};state.hold=null;el.holdBanner.hidden=true;el.progress.style.width="12%";
    q("#bookingHeading").textContent="Hold this court";
    q("#confirmBookingButton").textContent="Confirm booking";
    q("#confirmBookingButton").type="submit";q("#confirmBookingButton").disabled=false;q("#confirmBookingButton").onclick=null;
    el.summary.innerHTML="<strong>"+esc(venue.name)+"</strong><span>"+prettyDate(slot.date)+" · "+esc(slot.time)+" · "+slot.duration+" min</span><span>"+esc(state.sport)+" · "+money(slot.price,slot.currency)+" total</span>";
    el.dialog.showModal();
    await hold();
  }
  async function hold(){
    const s=state.selected.slot;
    try{
      state.hold=await api("/api/gac/hold",{method:"POST",headers:{"content-type":"application/json","idempotency-key":uid()},body:JSON.stringify({courtId:s.courtId,startsAt:s.startsAt,duration:s.duration})},true);
      el.holdBanner.hidden=false;el.progress.style.width="52%";countdown(state.hold.expiresAt);
    }catch(err){toast(err.message||"Could not hold this court.");el.dialog.close();reset();}
  }
  function countdown(expiresAt){
    clearInterval(state.timer);
    const tick=()=>{const left=Math.max(0,new Date(expiresAt).getTime()-Date.now());el.countdown.textContent=String(Math.floor(left/60000)).padStart(2,"0")+":"+String(Math.floor((left%60000)/1000)).padStart(2,"0");if(!left){clearInterval(state.timer);toast("Court hold expired.");el.dialog.close();}};
    tick();state.timer=setInterval(tick,1000);
  }
  async function confirm(e){
    e.preventDefault();if(!state.selected||!state.hold)return;
    const name=el.name.value.trim(),email=el.email.value.trim().toLowerCase();if(!name||!email)return;
    localStorage.setItem("gac.name",name);localStorage.setItem("gac.email",email);
    try{
      const booking=await api("/api/gac/book",{method:"POST",headers:{"content-type":"application/json","idempotency-key":uid()},body:JSON.stringify({holdId:state.hold.holdId,participants:1,acceptPolicy:q("#termsInput").checked})},true);
      clearInterval(state.timer);el.progress.style.width="100%";el.holdBanner.hidden=true;
      el.summary.innerHTML="<strong>Booked · "+esc(booking.reference||booking.bookingId)+"</strong><span>"+esc(state.selected.venue.name)+" · "+prettyDate(state.selected.slot.date)+" · "+esc(state.selected.slot.time)+"</span>";
      q("#bookingHeading").textContent="You’re on court.";
      const done=q("#confirmBookingButton");done.textContent="Done";done.type="button";done.onclick=()=>{el.dialog.close();reset();search();};
      toast("Booking confirmed.");
    }catch(err){toast(err.message||"Could not confirm booking.");}
  }
  function reset(){state.selected=null;state.hold=null;el.progress.style.width="12%";}
  async function loadBookings(){
    if(!(await requireSignedIn())) return;
    try{
      const bookings=(await api("/api/gac/bookings",{},true)).bookings||[];
      renderBookings(bookings);el.bookingsDialog.showModal();
    }catch(err){toast(err.message||"Could not load bookings.");}
  }
  function renderBookings(bookings){
    if(!bookings.length){el.bookingsList.innerHTML='<div class="empty-state"><h3>No bookings yet</h3><p>Your GetACourt bookings will appear here.</p></div>';return;}
    el.bookingsList.innerHTML=bookings.map(b=>'<article class="booking-item" data-id="'+esc(b.bookingId)+'"><div class="booking-item-head"><div><h3>'+esc((b.venue||{}).name||"Court booking")+'</h3><p>'+esc((b.slot||{}).date)+' · '+esc((b.slot||{}).time)+' · '+esc((b.slot||{}).duration)+' min</p><p>'+esc(b.reference||b.bookingId)+'</p></div><span class="booking-status">'+esc(b.status||"confirmed")+'</span></div>'+(b.status==="confirmed"?'<button class="cancel-button" type="button">Cancel booking</button>':"")+'</article>').join("");
    qa(".cancel-button",el.bookingsList).forEach(b=>b.addEventListener("click",()=>cancelBooking(b.closest(".booking-item").dataset.id)));
  }
  async function cancelBooking(id){
    const item=el.bookingsList.querySelector('[data-id="'+CSS.escape(id)+'"]'),button=item&&item.querySelector(".cancel-button");
    if(button){button.disabled=true;button.textContent="Cancelling…";}
    try{
      await api("/api/gac/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bookingId:id})},true);
      if(item){const status=item.querySelector(".booking-status");if(status)status.textContent="cancelled";if(button)button.remove();}
      toast("Booking cancelled.");
    }catch(err){if(button){button.disabled=false;button.textContent="Cancel booking";}toast(err.message||"Could not cancel booking.");}
  }

  async function loadProfile(promptIfMissing=false){
    if(!state.session?.accessToken) return null;
    try{
      const data=await api("/api/gac/player-profile",{},true);
      state.profile=data.profile||null;
      if(state.profile){
        el.profileName.value=state.profile.full_name||"";
        el.profileArea.value=state.profile.home_area||"";
        el.profileMarketing.checked=state.profile.marketing_consent===true;
        const preferred=new Set(state.profile.preferred_sports||[]);
        qa('input[name="preferredSport"]',el.profileForm).forEach(x=>x.checked=preferred.has(x.value));
      }
      updateAuthUI();
      if(promptIfMissing&&!state.profile) openProfile();
      return state.profile;
    }catch(err){
      if(err.code==="AUTH_REQUIRED"||err.status===401) saveSession(null);
      return null;
    }
  }
  async function openProfile(){
    if(!(await requireSignedIn())) return;
    const profile=await loadProfile(false);
    const payload=state.session?.accessToken?jwtPayload(state.session.accessToken):{};
    if(!profile){
      el.profileName.value="";
      el.profileArea.value=el.location.value.trim()||"";
      el.profileMarketing.checked=false;
      qa('input[name="preferredSport"]',el.profileForm).forEach(x=>x.checked=x.value===state.sport);
      el.profileStatus.textContent="Complete your player profile. It is global to GetACourt and separate from club CRM records.";
    }else{
      el.profileStatus.textContent="Your player preferences help GetACourt prioritize relevant courts and times.";
    }
    if(payload.email&&!el.email.value) el.email.value=payload.email;
    el.profileDialog.showModal();
  }
  async function saveProfile(e){
    e.preventDefault();
    const fullName=el.profileName.value.trim();
    if(fullName.length<2){el.profileStatus.textContent="Please enter your name.";return;}
    const preferredSports=qa('input[name="preferredSport"]:checked',el.profileForm).map(x=>x.value);
    el.profileStatus.textContent="Saving…";
    try{
      const data=await api("/api/gac/player-profile",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          fullName,
          homeArea:el.profileArea.value.trim()||null,
          preferredSports,
          locale:"en",
          marketingConsent:el.profileMarketing.checked
        })
      },true);
      state.profile=data.profile||null;
      if(state.profile?.home_area) el.location.value=state.profile.home_area;
      updateAuthUI();
      el.profileStatus.textContent="Profile saved.";
      toast("Player profile saved.");
      setTimeout(()=>el.profileDialog.close(),450);
    }catch(err){el.profileStatus.textContent=err.message||"Could not save profile.";}
  }
  function signOut(){
    saveSession(null);
    if(el.profileDialog.open) el.profileDialog.close();
    toast("Signed out.");
  }

  function openAuth(message=""){
    if(message) el.authStatus.textContent=message;
    const payload=state.session?.accessToken?jwtPayload(state.session.accessToken):{};
    if(payload.email) el.authEmail.value=payload.email;
    el.authDialog.showModal();
  }
  async function sendMagicLink(e){
    e.preventDefault();
    const email=el.authEmail.value.trim().toLowerCase();if(!email)return;
    el.authStatus.textContent="Sending secure sign-in link…";
    try{
      await api("/api/gac/auth/magic-link",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});
      el.authStatus.textContent="Check your email. The link signs you into this GetACourt staging site.";
    }catch(err){el.authStatus.textContent=err.message||"Could not send sign-in link.";}
  }

  qa(".sport-chip").forEach(b=>b.addEventListener("click",()=>{qa(".sport-chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.sport=b.dataset.sport;}));
  qa(".filter-pill").forEach(b=>b.addEventListener("click",()=>{qa(".filter-pill").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.filter=b.dataset.filter;render();}));
  el.form.addEventListener("submit",e=>{e.preventDefault();search();});
  el.refresh.addEventListener("click",search);
  el.sortSelect?.addEventListener("change",()=>{state.sort=el.sortSelect.value;render();});
  el.listView?.addEventListener("click",()=>{state.view="list";updateView();});
  el.mapView?.addEventListener("click",()=>{state.view="map";updateView();});
  el.resultsMap?.addEventListener("click",e=>{
    const b=e.target.closest(".map-slot");
    if(b) selectSlot(b.dataset.v,b.dataset.s);
  });
  el.nearMe?.addEventListener("click",useCurrentLocation);
  el.location.addEventListener("input",()=>{if(el.location.value!=="Current location"){state.geo=null;if(el.radiusNote)el.radiusNote.textContent="";}});
  el.bookingForm.addEventListener("submit",confirm);
  el.dialog.addEventListener("close",()=>{clearInterval(state.timer);if(el.dialog.returnValue==="cancel")reset();});
  el.myBookings.addEventListener("click",loadBookings);
  el.closeBookings.addEventListener("click",()=>el.bookingsDialog.close());
  el.authButton.addEventListener("click",()=>state.session?.accessToken?openProfile():openAuth(""));
  el.authForm.addEventListener("submit",sendMagicLink);
  el.closeAuth.addEventListener("click",()=>el.authDialog.close());
  el.profileForm.addEventListener("submit",saveProfile);
  el.closeProfile.addEventListener("click",()=>el.profileDialog.close());
  el.profileSignOut.addEventListener("click",signOut);

  updateAuthUI();
  loadPlatform().then(async()=>{if(state.session?.accessToken) await loadProfile(false);search();});
})();