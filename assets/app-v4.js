(function(){
  const $=(s)=>document.querySelector(s), $$=(s)=>Array.from(document.querySelectorAll(s));
  const htmlLang=(document.documentElement.lang||'en').toLowerCase(); const lang=htmlLang.startsWith('pt')?'pt':htmlLang.startsWith('es')?'es':htmlLang.startsWith('lv')?'lv':'en';
  const qs=new URLSearchParams(location.search);
  const utm=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  let sid;
  try{sid=sessionStorage.getItem('fmc_sid') || (crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now());sessionStorage.setItem('fmc_sid',sid);}catch(e){sid='na'}
  function sendEvent(name,extra={}){
    try{
      utm.forEach(k=>{if(qs.get(k))sessionStorage.setItem('fmc_'+k,qs.get(k));});
      const body=new URLSearchParams({'form-name':'site-event',event:name,path:location.pathname,lang,session_id:sid,
        referrer:document.referrer?document.referrer.slice(0,240):'',
        ...Object.fromEntries(utm.map(k=>[k,qs.get(k)||(sessionStorage.getItem('fmc_'+k)||'')])),...extra});
      fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),keepalive:true});
    }catch(e){}
  }
  window.fmcSendEvent=sendEvent;
  try{if(!sessionStorage.getItem('fmc_session_sent')){sendEvent('session_start');sessionStorage.setItem('fmc_session_sent','1');}}catch(e){}
  document.addEventListener('click',e=>{const el=e.target.closest('[data-event]');if(el)sendEvent(el.dataset.event,{target:(el.getAttribute('href')||el.dataset.target||'').slice(0,120)})});
  const money=(v)=>new Intl.NumberFormat(lang==='pt'?'pt-PT':lang==='es'?'es-ES':lang==='lv'?'lv-LV':'en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v||0);
  const num=(v)=>new Intl.NumberFormat(lang==='pt'?'pt-PT':lang==='es'?'es-ES':lang==='lv'?'lv-LV':'en-GB',{maximumFractionDigits:1}).format(v||0);
  function set(id,v){const e=$(id);if(e)e.textContent=v}

  // Revenue opportunity simulator
  const sim={c:$('#sim-courts'),p:$('#sim-price'),h:$('#sim-hours'),o:$('#sim-occ'),a:$('#sim-address'),r:$('#sim-recover')};
  let simTracked=false;
  function calcSim(){
    if(!sim.c)return;
    const c=+sim.c.value,p=+sim.p.value,h=+sim.h.value,o=+sim.o.value/100,a=+sim.a.value/100,r=+sim.r.value/100;
    const capacity=c*h*30.4*p,unsold=capacity*(1-o),addressable=unsold*a,recovered=addressable*r;
    const saas=249,perf=recovered*.08,incentive=recovered*.08,net=Math.max(0,recovered-saas-perf-incentive);
    const fees=saas+perf,roi=fees?net/fees:0,payback=net?Math.max(1,Math.ceil(490/net*30)):0;
    set('#sim-courts-v',c);set('#sim-price-v','€'+p);set('#sim-hours-v',h+'h');set('#sim-occ-v',Math.round(o*100)+'%');set('#sim-address-v',Math.round(a*100)+'%');set('#sim-recover-v',Math.round(r*100)+'%');
    set('#sim-unsold',money(unsold));set('#sim-unsold-bar',money(unsold));set('#sim-addressable',money(addressable));set('#sim-addressable-bar',money(addressable));set('#sim-recovered',money(recovered));set('#sim-recovered-bar',money(recovered));set('#sim-net',money(net));set('#sim-net-bar',money(net));set('#sim-annual',money(net*12));set('#sim-roi',num(roi)+'×');set('#sim-payback',payback+' '+(lang==='pt'?'dias':lang==='es'?'días':lang==='lv'?'dienas':'days'));
    const heights={'#bar-unsold':1,'#bar-address':addressable/Math.max(1,unsold),'#bar-recovered':recovered/Math.max(1,unsold),'#bar-net':net/Math.max(1,unsold)};
    Object.entries(heights).forEach(([id,ratio])=>{const el=$(id);if(el)el.style.setProperty('--h',Math.max(8,Math.min(100,ratio*100))+'%')});
  }
  Object.values(sim).forEach(el=>el&&el.addEventListener('input',()=>{calcSim();if(!simTracked){sendEvent('financial_model_interaction');simTracked=true;}}));calcSim();

  // Distribution margin calculator
  const g=$('#gmv'),ext=$('#ext'),fee=$('#fee'),shift=$('#shift'); let chanTracked=false;
  function calcChan(){
    if(!g)return;
    const gmv=+g.value,e=+ext.value/100,f=+fee.value/100,s=+shift.value/100;
    const now=gmv*e*f,save=now*s;
    set('#gmv-v',money(gmv));set('#ext-v',Math.round(e*100)+'%');set('#fee-v',num(f*100)+'%');set('#shift-v',Math.round(s*100)+'%');set('#fee-now',money(now));set('#fee-save',money(save));set('#fee-year',money(save*12));
  }
  [g,ext,fee,shift].forEach(el=>el&&el.addEventListener('input',()=>{calcChan();if(!chanTracked){sendEvent('channel_margin_interaction');chanTracked=true;}}));calcChan();

  // Demo tabs
  $$('.demo-chooser button').forEach(btn=>btn.addEventListener('click',()=>{
    $$('.demo-chooser button').forEach(b=>b.classList.remove('active'));$$('.demo-pane').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');const p=$('[data-pane="'+btn.dataset.view+'"]');if(p)p.classList.add('active');
    sendEvent('demo_tab',{target:btn.dataset.view||''});
  }));

  // Lead/onboarding analytics
  document.querySelectorAll('form[data-lead-form],form[data-onboarding-form]').forEach(form=>{
    let started=false;form.addEventListener('focusin',()=>{if(!started){sendEvent(form.hasAttribute('data-onboarding-form')?'onboarding_start':'lead_form_start');started=true;}});
    form.addEventListener('submit',()=>sendEvent(form.hasAttribute('data-onboarding-form')?'onboarding_submit':'lead_form_submit'));
  });
  const success=document.body.dataset.successEvent;if(success)sendEvent(success);
})();