(function(){
  const $=(s)=>document.querySelector(s);
  const $$=(s)=>Array.from(document.querySelectorAll(s));
  const lang=(document.documentElement.lang||'en').startsWith('pt')?'pt':'en';
  const qs=new URLSearchParams(location.search);
  const utm=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  const sid=sessionStorage.getItem('fmc_sid') || (crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now());
  sessionStorage.setItem('fmc_sid',sid);
  function sendEvent(name,extra={}){
    const body=new URLSearchParams({
      'form-name':'site-event',event:name,path:location.pathname,lang,session_id:sid,
      referrer:document.referrer?document.referrer.slice(0,240):'',
      ...Object.fromEntries(utm.map(k=>[k,qs.get(k)||sessionStorage.getItem('fmc_'+k)||''])),
      ...extra
    });
    utm.forEach(k=>{if(qs.get(k))sessionStorage.setItem('fmc_'+k,qs.get(k));});
    try{fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),keepalive:true});}catch(e){}
  }
  window.fmcSendEvent=sendEvent;
  if(!sessionStorage.getItem('fmc_session_sent')){sendEvent('session_start');sessionStorage.setItem('fmc_session_sent','1');}
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-event]');
    if(el) sendEvent(el.dataset.event,{target:(el.getAttribute('href')||el.dataset.target||'').slice(0,120)});
  });

  // Legacy/simple calculator support.
  const court=$('#courts'), price=$('#price'), empty=$('#empty'), recover=$('#recover');
  const out=$('#monthly'), annual=$('#annual'), payback=$('#payback');
  const labels={courts:$('#courts-v'),price:$('#price-v'),empty:$('#empty-v'),recover:$('#recover-v')};
  let calcTracked=false;
  function calcLegacy(){
    if(!court) return;
    const c=+court.value,p=+price.value,e=+empty.value,r=+recover.value/100;
    const monthly=c*p*e*4.33*r;
    if(labels.courts)labels.courts.textContent=c;if(labels.price)labels.price.textContent='€'+p;if(labels.empty)labels.empty.textContent=e+'h';if(labels.recover)labels.recover.textContent=Math.round(r*100)+'%';
    if(out)out.textContent=money(monthly);if(annual)annual.textContent=money(monthly*12)+' / '+(lang==='pt'?'ano':'year');if(payback)payback.textContent=monthly>0?Math.max(1,Math.ceil(490/monthly*30))+' '+(lang==='pt'?'dias':'days'):'—';
  }
  [court,price,empty,recover].forEach(el=>el&&el.addEventListener('input',()=>{calcLegacy();if(!calcTracked){sendEvent('calculator_interaction');calcTracked=true;}}));calcLegacy();

  // Financial simulator v2.
  const sim={courts:$('#sim-courts'),price:$('#sim-price'),hours:$('#sim-hours'),occ:$('#sim-occ'),address:$('#sim-address'),recover:$('#sim-recover')};
  let simTracked=false;
  function money(v){return new Intl.NumberFormat(lang==='pt'?'pt-PT':'en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v||0)}
  function pct(v){return new Intl.NumberFormat(lang==='pt'?'pt-PT':'en-GB',{maximumFractionDigits:1}).format(v)+'×'}
  function setText(id,v){const el=$(id);if(el)el.textContent=v;}
  function setHeight(id,ratio,min=10){const el=$(id);if(el)el.style.height=Math.max(min,Math.min(100,ratio*100))+'%';}
  function calcSim(){
    if(!sim.courts)return;
    const c=+sim.courts.value,p=+sim.price.value,h=+sim.hours.value,occ=+sim.occ.value/100,address=+sim.address.value/100,rec=+sim.recover.value/100;
    // 30.4 days keeps model understandable and auditable.
    const available=c*h*30.4*p;
    const unsold=available*(1-occ);
    const addressable=unsold*address;
    const recovered=addressable*rec;
    const monthlySaaS=249;
    const perfFee=recovered*.08;
    const illustrativeIncentive=recovered*.08;
    const net=Math.max(0,recovered-monthlySaaS-perfFee-illustrativeIncentive);
    const fillMyCourtFees=monthlySaaS+perfFee;
    const roi=fillMyCourtFees>0?net/fillMyCourtFees:0;
    const payback=net>0?Math.max(1,Math.ceil(490/net*30)):0;
    setText('#sim-courts-v',c);setText('#sim-price-v','€'+p);setText('#sim-hours-v',h+'h');setText('#sim-occ-v',Math.round(occ*100)+'%');setText('#sim-address-v',Math.round(address*100)+'%');setText('#sim-recover-v',Math.round(rec*100)+'%');
    setText('#sim-unsold',money(unsold));setText('#sim-addressable',money(addressable));setText('#sim-recovered',money(recovered));setText('#sim-annual',money(net*12));setText('#sim-roi',pct(roi));setText('#sim-payback',payback+' '+(lang==='pt'?'dias':'days'));
    setHeight('#wf-unsold',1);setHeight('#wf-address',addressable/Math.max(1,unsold));setHeight('#wf-recovered',recovered/Math.max(1,unsold));setHeight('#wf-net',net/Math.max(1,unsold));
  }
  Object.values(sim).forEach(el=>el&&el.addEventListener('input',()=>{calcSim();if(!simTracked){sendEvent('financial_model_interaction');simTracked=true;}}));calcSim();

  // Visual revenue heatmap. Deterministic pattern, illustrative only.
  const heat=$('#homeHeatmap');
  if(heat){
    const pattern=['sold','sold','risk','empty','sold','sold','recovered','sold','risk','sold','empty','sold','sold','risk','sold','sold','sold','risk','empty','recovered','sold','sold','risk','empty','sold','sold','sold','sold','risk','empty','empty','sold','recovered','sold','sold','risk','sold','sold','empty','sold','risk','sold','sold','recovered','sold','empty','risk','sold','sold','sold','risk','sold','sold','empty','risk','sold','recovered','sold','sold','risk','empty','sold','sold','sold','sold','risk','recovered','sold','empty','sold','risk','sold','sold','sold','empty','risk','sold','recovered','sold','sold','risk','sold','empty','sold','sold','risk','recovered','sold','empty','sold','sold','risk','sold','empty','sold','recovered','sold','risk'];
    pattern.forEach((cls,i)=>{const cell=document.createElement('i');cell.className=cls;cell.title=(lang==='pt'?'Slot ilustrativo ':'Illustrative slot ')+(i+1);heat.appendChild(cell);});
  }

  // Forms analytics.
  document.querySelectorAll('form[data-lead-form],form[data-onboarding-form]').forEach(form=>{
    let started=false;
    form.addEventListener('focusin',()=>{if(!started){sendEvent(form.hasAttribute('data-onboarding-form')?'onboarding_start':'lead_form_start');started=true;}});
    form.addEventListener('submit',()=>{
      sendEvent(form.hasAttribute('data-onboarding-form')?'onboarding_submit':'lead_form_submit');
      const btn=form.querySelector('button[type=submit]');if(btn){btn.disabled=true;btn.textContent=lang==='pt'?'A enviar…':'Sending…';}
    });
  });
  const success=document.body.dataset.successEvent;if(success)sendEvent(success);
})();
