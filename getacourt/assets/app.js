(() => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const state = { sport: "padel", venues: [], filter: "all", selected: null, hold: null, timer: null };

  const el = {
    form: q("#searchForm"), location: q("#locationInput"), date: q("#dateInput"),
    from: q("#fromInput"), to: q("#toInput"), grid: q("#resultsGrid"),
    count: q("#resultCount"), title: q("#resultsTitle"), refresh: q("#refreshButton"),
    dialog: q("#bookingDialog"), bookingForm: q("#bookingForm"), summary: q("#bookingSummary"),
    holdBanner: q("#holdBanner"), countdown: q("#holdCountdown"), progress: q("#dialogProgress"),
    name: q("#nameInput"), email: q("#emailInput"), bookingsDialog: q("#bookingsDialog"),
    bookingsList: q("#bookingsList"), myBookings: q("#myBookingsButton"),
    closeBookings: q("#closeBookingsButton"), toast: q("#toast")
  };

  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
  el.date.value = today;
  el.date.min = today;
  el.name.value = localStorage.getItem("gac.name") || "";
  el.email.value = localStorage.getItem("gac.email") || "";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  }
  function money(v, currency) {
    return new Intl.NumberFormat("en-GB",{style:"currency",currency:currency||"EUR",maximumFractionDigits:0}).format(v);
  }
  function prettyDate(v) {
    return new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short"}).format(new Date(v+"T12:00:00"));
  }
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    setTimeout(() => el.toast.classList.remove("show"), 2400);
  }
  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) {
      let detail = {};
      try { detail = await res.json(); } catch {}
      throw new Error(detail.error || ("Request failed ("+res.status+")"));
    }
    return res.json();
  }
  function localInventory(params) {
    if (params.sport !== "padel") return { venues: [] };
    const raw = [
      ["demo-cascais-01","Cascais Court Club","Cascais",1.8,true,["Indoor","Panoramic","Parking"],[["17:30",32,90],["19:00",38,90],["20:30",36,90],["22:00",27,60]]],
      ["demo-estoril-02","Estoril Racket Lab","Estoril",4.2,false,["Outdoor","Rental rackets","Café"],[["18:00",28,90],["19:30",34,90],["21:00",30,90]]],
      ["demo-oeiras-03","Oeiras Indoor Arena","Oeiras",11.6,true,["Indoor","Changing rooms","Parking"],[["17:00",26,60],["18:00",26,60],["20:00",31,90],["21:30",24,60]]]
    ];
    return { venues: raw.map(v => ({
      id:v[0], name:v[1], area:v[2], distanceKm:v[3], indoor:v[4], tags:v[5], sport:"padel",
      source:"GetACourt demo provider",
      slots:v[6].filter(s => s[0] >= params.from && s[0] <= params.to).map((s,i)=>({
        id:v[0]+"-"+s[0].replace(":","")+"-"+i, venueId:v[0], date:params.date, time:s[0],
        price:s[1], duration:s[2], currency:"EUR", status:"available", provider:"demo"
      }))
    })).filter(v=>v.slots.length) };
  }
  function loading() {
    el.count.textContent = "Searching providers…";
    el.grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  }
  async function search() {
    const p = {sport:state.sport,location:el.location.value.trim()||"Cascais",date:el.date.value,from:el.from.value,to:el.to.value};
    loading();
    let data;
    try { data = await api("/api/gac/search?"+new URLSearchParams(p).toString()); }
    catch { data = localInventory(p); toast("Using preview inventory while provider API is offline."); }
    state.venues = data.venues || [];
    el.title.textContent = "Courts around " + p.location;
    render();
    q("#resultsSection").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function visible(v) {
    if (state.filter === "indoor") return !!v.indoor;
    if (state.filter === "under35") return v.slots.some(s => s.price < 35 && s.status === "available");
    if (state.filter === "90min") return v.slots.some(s => s.duration === 90 && s.status === "available");
    return true;
  }
  function render() {
    const venues = state.venues.filter(visible);
    const n = venues.reduce((a,v)=>a+v.slots.filter(s=>s.status==="available").length,0);
    el.count.textContent = n+" available slot"+(n===1?"":"s")+" · "+venues.length+" venue"+(venues.length===1?"":"s");
    if (!venues.length) {
      el.grid.innerHTML = '<div class="empty-state"><div class="empty-orbit"></div><h3>No matching courts yet</h3><p>Try a wider time window or another sport. Provider coverage expands as clubs join the network.</p></div>';
      return;
    }
    el.grid.innerHTML = "";
    venues.forEach(v => {
      const card = document.createElement("article");
      card.className = "venue-card";
      const tags = (v.tags||[]).map(t=>"<span>"+esc(t)+"</span>").join("");
      const slots = (v.slots||[]).map(s =>
        '<button class="slot" type="button" data-v="'+esc(v.id)+'" data-s="'+esc(s.id)+'" '+(s.status!=="available"?"disabled":"")+'>'+
        '<strong>'+esc(s.time)+'</strong><small>'+esc(s.duration)+' min · '+money(s.price,s.currency)+'</small></button>'
      ).join("");
      card.innerHTML = '<div class="venue-top"><div><div class="venue-kicker">'+esc(v.area)+' · '+esc(v.sport||state.sport)+'</div>'+
        '<h3>'+esc(v.name)+'</h3><div class="venue-tags">'+tags+'</div></div><span class="distance">'+Number(v.distanceKm||0).toFixed(1)+' km</span></div>'+
        '<div class="slot-list">'+slots+'</div><p class="venue-source">Availability source: '+esc(v.source||"connected provider")+'</p>';
      el.grid.appendChild(card);
    });
    qa(".slot",el.grid).forEach(b=>b.addEventListener("click",()=>selectSlot(b.dataset.v,b.dataset.s)));
  }
  function selectSlot(venueId, slotId) {
    const venue = state.venues.find(v=>v.id===venueId);
    const slot = venue && venue.slots.find(s=>s.id===slotId);
    if (!venue || !slot) return;
    state.selected = {venue,slot};
    state.hold = null;
    el.holdBanner.hidden = true;
    el.progress.style.width = "12%";
    q("#bookingHeading").textContent = "Hold this court";
    q("#confirmBookingButton").textContent = "Confirm test booking";
    q("#confirmBookingButton").type = "submit";
    q("#confirmBookingButton").onclick = null;
    el.summary.innerHTML = "<strong>"+esc(venue.name)+"</strong><span>"+prettyDate(slot.date)+" · "+esc(slot.time)+" · "+slot.duration+" min</span><span>"+esc(state.sport)+" · "+money(slot.price,slot.currency)+" total</span>";
    el.dialog.showModal();
    hold();
  }
  async function hold() {
    const s = state.selected.slot;
    try {
      state.hold = await api("/api/gac/hold",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({slotId:s.id,date:s.date,provider:s.provider||"demo"})});
    } catch {
      state.hold = {holdId:"local-"+Date.now(),expiresAt:new Date(Date.now()+8*60000).toISOString(),local:true};
      toast("Local preview hold created.");
    }
    el.holdBanner.hidden = false;
    el.progress.style.width = "52%";
    countdown(state.hold.expiresAt);
  }
  function countdown(expiresAt) {
    clearInterval(state.timer);
    const tick=()=>{
      const left=Math.max(0,new Date(expiresAt).getTime()-Date.now());
      el.countdown.textContent=String(Math.floor(left/60000)).padStart(2,"0")+":"+String(Math.floor((left%60000)/1000)).padStart(2,"0");
      if (!left) { clearInterval(state.timer); toast("Court hold expired."); el.dialog.close(); }
    };
    tick(); state.timer=setInterval(tick,1000);
  }
  function localBooking(payload) {
    const booking = Object.assign({bookingId:"local-"+Date.now(),reference:"GAC-"+Math.random().toString(36).slice(2,8).toUpperCase(),status:"confirmed",createdAt:new Date().toISOString()},payload);
    const all=JSON.parse(localStorage.getItem("gac.localBookings")||"[]"); all.unshift(booking);
    localStorage.setItem("gac.localBookings",JSON.stringify(all)); return booking;
  }
  async function confirm(e) {
    e.preventDefault();
    if (!state.selected || !state.hold) return;
    const name=el.name.value.trim(), email=el.email.value.trim().toLowerCase();
    if (!name || !email) return;
    localStorage.setItem("gac.name",name); localStorage.setItem("gac.email",email);
    const payload={holdId:state.hold.holdId,slot:state.selected.slot,venue:{id:state.selected.venue.id,name:state.selected.venue.name,area:state.selected.venue.area},customer:{name,email},paymentMode:new FormData(el.bookingForm).get("paymentMode")};
    let booking;
    try { booking=state.hold.local?localBooking(payload):await api("/api/gac/book",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}); }
    catch(err){ toast(err.message||"Could not confirm booking."); return; }
    clearInterval(state.timer); el.progress.style.width="100%"; el.holdBanner.hidden=true;
    el.summary.innerHTML="<strong>Booked · "+esc(booking.reference)+"</strong><span>"+esc(state.selected.venue.name)+" · "+prettyDate(state.selected.slot.date)+" · "+esc(state.selected.slot.time)+"</span><span>Confirmation identity: "+esc(email)+"</span>";
    q("#bookingHeading").textContent="You’re on court.";
    const done=q("#confirmBookingButton"); done.textContent="Done"; done.type="button"; done.onclick=()=>{el.dialog.close();reset();search();};
    toast("Booking confirmed.");
  }
  function reset(){ state.selected=null; state.hold=null; el.progress.style.width="12%"; }
  async function loadBookings() {
    const email=localStorage.getItem("gac.email")||el.email.value.trim().toLowerCase();
    let bookings=[];
    if (email) {
      try { bookings=(await api("/api/gac/bookings?email="+encodeURIComponent(email))).bookings||[]; }
      catch { bookings=JSON.parse(localStorage.getItem("gac.localBookings")||"[]").filter(b=>b.customer&&b.customer.email===email); }
    }
    renderBookings(bookings,email); el.bookingsDialog.showModal();
  }
  function renderBookings(bookings,email) {
    if (!email) { el.bookingsList.innerHTML='<div class="empty-state"><h3>No booking identity yet</h3><p>Make a test booking first.</p></div>'; return; }
    if (!bookings.length) { el.bookingsList.innerHTML='<div class="empty-state"><h3>No bookings yet</h3><p>Your GetACourt bookings will appear here.</p></div>'; return; }
    el.bookingsList.innerHTML=bookings.map(b=>'<article class="booking-item" data-id="'+esc(b.bookingId)+'"><div class="booking-item-head"><div><h3>'+esc((b.venue||{}).name||"Court booking")+'</h3><p>'+esc((b.slot||{}).date)+' · '+esc((b.slot||{}).time)+' · '+esc((b.slot||{}).duration)+' min</p><p>'+esc(b.reference||b.bookingId)+'</p></div><span class="booking-status">'+esc(b.status||"confirmed")+'</span></div>'+(b.status==="confirmed"?'<button class="cancel-button" type="button">Cancel test booking</button>':"")+'</article>').join("");
    qa(".cancel-button",el.bookingsList).forEach(b=>b.addEventListener("click",()=>cancelBooking(b.closest(".booking-item").dataset.id)));
  }
  async function cancelBooking(id) {
    const email=localStorage.getItem("gac.email")||"";
    const item=el.bookingsList.querySelector('[data-id="'+CSS.escape(id)+'"]');
    const button=item&&item.querySelector(".cancel-button");
    if (button) { button.disabled=true; button.textContent="Cancelling…"; }
    try {
      await api("/api/gac/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bookingId:id,email})});
    } catch {
      const all=JSON.parse(localStorage.getItem("gac.localBookings")||"[]"), hit=all.find(b=>b.bookingId===id);
      if(hit) hit.status="cancelled";
      localStorage.setItem("gac.localBookings",JSON.stringify(all));
    }
    if (item) {
      const status=item.querySelector(".booking-status");
      if (status) status.textContent="cancelled";
      if (button) button.remove();
    }
    toast("Booking cancelled.");
  }

  qa(".sport-chip").forEach(b=>b.addEventListener("click",()=>{qa(".sport-chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.sport=b.dataset.sport;}));
  qa(".filter-pill").forEach(b=>b.addEventListener("click",()=>{qa(".filter-pill").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.filter=b.dataset.filter;render();}));
  el.form.addEventListener("submit",e=>{e.preventDefault();search();});
  el.refresh.addEventListener("click",search);
  el.bookingForm.addEventListener("submit",confirm);
  el.dialog.addEventListener("close",()=>{clearInterval(state.timer);if(el.dialog.returnValue==="cancel")reset();});
  el.myBookings.addEventListener("click",loadBookings);
  el.closeBookings.addEventListener("click",()=>el.bookingsDialog.close());
  search();
})();