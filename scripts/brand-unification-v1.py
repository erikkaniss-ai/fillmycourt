#!/usr/bin/env python3
"""Build one FillMyCourt identity for both authorised websites and LinkedIn.
No credentials; no network access. Run from the target repository root.
"""
from pathlib import Path
import json,re,hashlib
import cairosvg
ROOT=Path.cwd();A=ROOT/'assets/fmc-brand-v1';A.mkdir(parents=True,exist_ok=True)
IS_OS=(ROOT/'cases/fillmycourt.html').exists()
BLUE='#1267E5';NAVY='#071E33';SKY='#35A7FF'
F='M34 27H66V36H46V44H65V53H46V73H34Z'
WORDMARK='M124.09 73H133.32V55.68H151.76V48.15H133.32V35.55H153.75V27.89H124.09Z M158.76 73H167.85V39.15H158.76ZM163.3 34.73C166.03 34.73 168.3 32.68 168.3 30.07C168.3 27.5 166.03 25.41 163.3 25.41C160.55 25.41 158.31 27.5 158.31 30.07C158.31 32.68 160.55 34.73 163.3 34.73Z M183.15 27.89H174.07V73H183.15Z M198.45 27.89H189.37V73H198.45Z M204.88 73H214.05V51.72C214.05 48.33 213.81 41.7 213.72 36.22C215.33 42.27 217.14 48.6 218.2 51.72L225.8 73H233.58L241.06 51.72C242.12 48.51 244.02 41.94 245.54 35.85C245.45 41.55 245.21 48.33 245.21 51.72V73H254.5V27.89H240.27L233.07 48.6C232.16 51.48 230.76 57.5 229.74 62.37C228.68 57.47 227.28 51.45 226.38 48.6L219.05 27.89H204.88Z M260.69 84.99C261.99 85.5 264.23 85.9 266.62 85.9C273.4 85.9 276.98 82.48 279.03 77L293.41 39.15H283.88L277.94 56.71C276.98 59.62 276.19 62.53 275.49 65.55C274.86 62.56 274.25 59.65 273.34 56.71L267.65 39.15H257.99L270.71 73.09L270.47 74.91C270.07 78.3 267.56 79.42 263.9 78.42L262.78 78.15Z M316.68 73.61C328.06 73.61 335.08 65.95 336.11 57.56H326.76C325.85 62.46 321.98 65.4 316.83 65.4C309.87 65.4 305.11 60.25 305.11 50.48C305.11 40.91 309.81 35.49 316.86 35.49C322.01 35.49 325.88 38.4 326.73 43.3H336.08C334.75 33.16 326.94 27.29 316.68 27.29C304.78 27.29 295.73 35.73 295.73 50.48C295.73 65.13 304.66 73.61 316.68 73.61Z M356.26 73.67C366.43 73.67 372.82 66.64 372.82 56.23C372.82 45.75 366.43 38.73 356.26 38.73C346.06 38.73 339.7 45.75 339.7 56.23C339.7 66.64 346.06 73.67 356.26 73.67ZM356.26 66.52C351.42 66.52 348.96 62.1 348.96 56.2C348.96 50.2 351.42 45.88 356.26 45.88C361.1 45.88 363.58 50.23 363.58 56.2C363.58 62.1 361.1 66.52 356.26 66.52Z M389.3 73.42C394.45 73.42 397.9 70.76 399.81 65.98L399.93 73H408.52V39.15H399.41V58.74C399.41 63.22 396.69 65.83 392.84 65.83C389.03 65.83 386.73 63.31 386.73 59.1V39.15H377.65V60.68C377.65 68.61 382.28 73.42 389.3 73.42Z M414.74 73H423.83V53.75C423.83 49.54 426.88 46.66 431.06 46.66C432.39 46.66 434.18 46.87 435 47.12V39C434.18 38.82 433 38.7 432.06 38.7C428.25 38.7 425.13 40.88 423.89 45.06H423.52V39.15H414.74Z M455.29 39.15H448.97V31.1H439.88V39.15H435.22V46.09H439.88V63.89C439.88 70.09 443.58 73.48 450.36 73.48C452.18 73.48 454.2 73.27 456.23 72.67L454.93 65.86C454.26 66.04 452.75 66.25 452.05 66.25C449.84 66.25 448.97 65.25 448.97 63.1V46.09H455.29Z'
def svg(w,h,body,title):
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img"><title>{title}</title>{body}</svg>'
def mark(square=False):
 return f'<rect width="100" height="100" rx="{0 if square else 22}" fill="{BLUE}"/><path d="{F}" fill="#fff"/>'
def lockup(light=False):
 return mark()+f'<path d="{WORDMARK}" fill="{"#fff" if light else NAVY}"/>'
def label(x,y,t,size=24,color='#fff',weight=700):
 return f'<text x="{x}" y="{y}" font-family="Arial,Helvetica,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{t}</text>'
def slots(x=0,y=0,scale=1):
 s=f'<g transform="translate({x} {y}) scale({scale})">'
 for r in range(4):
  for c in range(5):
   active=(r*5+c) in (2,3,7,8,9,12,13,14,16,17,18,19)
   col=BLUE if active else '#102D49'
   if (r,c) in [(2,4),(3,4)]:col=SKY
   s+=f'<rect x="{c*59}" y="{r*39}" width="51" height="31" rx="7" fill="{col}" stroke="#2B4864" stroke-width="1"/>'
 return s+'</g>'
assets={'mark.svg':svg(100,100,mark(),'FillMyCourt'),'logo.svg':svg(466,100,lockup(),'FillMyCourt'),'logo-light.svg':svg(466,100,lockup(True),'FillMyCourt'),'linkedin-logo.svg':svg(400,400,'<g transform="scale(4)">'+mark(True)+'</g>','FillMyCourt'),'slots.svg':svg(287,148,slots(),'Illustrative capacity slots; not measured results')}
cover=f'<rect width="1512" height="256" fill="{NAVY}"/><path d="M270 0V256" stroke="#28435D"/><g transform="translate(310 30) scale(.46)">{lockup(True)}</g>'+label(310,139,'More play. Higher revenue.',48)+label(312,190,'Revenue infrastructure for racket clubs',22,'#BFD3E6',400)+slots(1136,57,.9)
assets['linkedin-cover.svg']=svg(1512,256,cover,'FillMyCourt — More play. Higher revenue.')
og=f'<rect width="1200" height="627" fill="{NAVY}"/><g transform="translate(64 56) scale(.7)">{lockup(True)}</g>'+label(64,263,'More play.',68)+label(64,342,'Higher revenue.',68)+label(67,407,'Revenue infrastructure',27,'#BFD3E6',400)+label(67,443,'for racket clubs',27,'#BFD3E6',400)+slots(805,189,1.05)+'<path d="M64 510H1136" stroke="#28435D"/>'+label(66,563,'REVENUE RECOVERY  /  CRM  /  BOOKING  /  LOYALTY',17,'#BFD3E6',400)
assets['social-preview.svg']=svg(1200,627,og,'FillMyCourt — revenue infrastructure for racket clubs')
post=f'<rect width="1200" height="1200" fill="{NAVY}"/><g transform="translate(76 64) scale(.72)">{lockup(True)}</g>'+label(76,323,'More play.',92)+label(76,429,'Higher revenue.',92)+label(80,503,'Revenue infrastructure for racket clubs',29,'#BFD3E6',400)+slots(78,662,2.4)+label(80,1122,'fillmycourt.com',24,'#BFD3E6',400)
assets['linkedin-post.svg']=svg(1200,1200,post,'FillMyCourt — More play. Higher revenue.')
for n,s in assets.items():(A/n).write_text(s,encoding='utf-8')
for stem in ['linkedin-logo','linkedin-cover','social-preview','linkedin-post']:cairosvg.svg2png(bytestring=assets[stem+'.svg'].encode(),write_to=str(A/(stem+'.png')))
manifest={'identity':'FillMyCourt identity v1','date':'2026-09-24','logo':'F-tile + outlined FillMyCourt wordmark','palette':{'navy':NAVY,'blue':BLUE,'cyan':SKY,'canvas':'#F4F8FD','white':'#FFFFFF'},'message':'More play. Higher revenue.','descriptor':'Revenue infrastructure for racket clubs','visual_motif':'Capacity slots filling; conceptual, not client data','logo_hash':hashlib.sha256(assets['logo.svg'].encode()).hexdigest(),'assets':{n:hashlib.sha256(s.encode()).hexdigest() for n,s in assets.items()}}
(A/'identity.json').write_text(json.dumps(manifest,indent=2)+'\n')
SHARED='''/* FillMyCourt identity v1. Do not re-create the logo in CSS or type. */
:root{--fmc-navy:#071E33;--fmc-blue:#1267E5;--fmc-cyan:#35A7FF;--fmc-pale:#F4F8FD;--fmc-line:#D8E4F0;--fmc-body:#435A72}
.fmc-brand-panel{box-sizing:border-box;position:relative;isolation:isolate;background:#071E33!important;color:#fff!important;padding:clamp(24px,3vw,40px);min-height:290px;overflow:hidden;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.fmc-brand-panel .fmc-lockup{display:block!important;position:relative!important;inset:auto!important;width:238px!important;max-width:80%!important;height:auto!important;object-fit:contain!important;filter:none!important;transform:none!important;margin:0!important}
.fmc-brand-panel .fmc-panel-line{font-family:inherit!important;font-size:clamp(24px,2.5vw,34px)!important;line-height:1.12!important;font-weight:750!important;color:#fff!important;letter-spacing:-.035em!important;margin:30px 0 10px!important;max-width:62%!important;position:relative;z-index:2}
.fmc-brand-panel .fmc-panel-desc{position:relative!important;inset:auto!important;background:none!important;padding:0!important;font-size:14px!important;line-height:1.5!important;letter-spacing:0!important;text-transform:none!important;color:#BFD3E6!important;max-width:60%;margin:0!important}
.fmc-brand-panel .fmc-slot-art{position:absolute!important;inset:auto 22px 35px auto!important;width:34%!important;max-width:200px!important;height:auto!important;object-fit:contain!important;transform:none!important;opacity:.85;z-index:0}
@media(max-width:480px){.fmc-brand-panel{min-height:260px}.fmc-brand-panel .fmc-panel-line{max-width:76%!important;font-size:26px!important}.fmc-brand-panel .fmc-slot-art{right:-24px!important;opacity:.26;width:48%!important}.fmc-brand-panel .fmc-panel-desc{max-width:80%}}
'''
SITE='''
body.fmc-unified{background:#F4F8FD;color:#071E33;--ink:#071E33;--ink2:#0A315F;--blue:#1267E5;--blue2:#0B4FBF;--green:#1267E5;--mint:#EAF4FF;--canvas:#F4F8FD;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.fmc-unified .nav{background:#fff;border-bottom:1px solid #D8E4F0;box-shadow:none;backdrop-filter:none}.fmc-unified .nav-inner{min-height:84px;height:auto;gap:24px;position:relative;padding:12px 0}.fmc-unified .brand,.fmc-unified .logo{flex:none;min-width:0;display:block}.fmc-unified img.brand-logo{width:220px;max-width:none;height:auto;display:block}.fmc-unified .nav-links{gap:clamp(12px,1.5vw,22px);font-size:13px}.fmc-unified .brand-mark{display:none}
.fmc-unified .hero{background:#F4F8FD;padding:64px 0}.fmc-unified .hero-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:48px;align-items:center}.fmc-unified .hero h1{font-size:clamp(44px,4.7vw,66px);line-height:1.04;letter-spacing:-.045em;max-width:640px}.fmc-unified .hero h1 span{color:#1267E5!important}.fmc-unified .hero p{font-size:18px;color:#435A72;max-width:590px;line-height:1.65}.fmc-unified .eyebrow{font-size:11px;letter-spacing:.1em;color:#0B4FBF}.fmc-unified .eyebrow:before{background:#1267E5!important;box-shadow:none!important}
.fmc-unified .btn{border-radius:10px;box-shadow:none;min-height:46px}.fmc-unified .btn-primary,.fmc-unified .btn-lime{background:#1267E5!important;color:#fff!important;border:1px solid #1267E5!important;box-shadow:none!important}.fmc-unified .btn-primary:hover,.fmc-unified .btn-lime:hover{background:#0B4FBF!important}.fmc-unified .btn-secondary{background:#fff;color:#071E33;border-color:#CCDCEB}
.fmc-unified .revenue-console,.fmc-unified .control-room,.fmc-unified .product-shell,.fmc-unified .pnl,.fmc-unified .section.dark,.fmc-unified .section-dark,.fmc-unified .lead-section,.fmc-unified .lead-section-v3,.fmc-unified .hub-core,.fmc-unified .tree,.fmc-unified .report-callout,.fmc-unified .calc-result{background:#071E33!important;box-shadow:none;border-radius:16px}
.fmc-unified .positive strong,.fmc-unified .rc-kpis .positive strong,.fmc-unified .amount,.fmc-unified .pnl-row.total strong,.fmc-unified .calc-result .annual,.fmc-unified .report-callout .big,.fmc-unified .sim-results .profit strong,.fmc-unified .demo-owner-kpis .profit strong,.fmc-unified .demo-big-money strong{color:#68C0FF!important}
.fmc-unified .heatmap-mini i.full,.fmc-unified .heatmap-large i.full,.fmc-unified .legend.green{background:#35A7FF!important}.fmc-unified .tag.green,.fmc-unified .badge,.fmc-unified .seg.green,.fmc-unified .slot.open,.fmc-unified .offer-tag{background:#EAF4FF!important;color:#0B4FBF!important}.fmc-unified .kpi.good strong,.fmc-unified .price-tag{color:#0B4FBF!important}.fmc-unified .progress>span,.fmc-unified .sim-bars .sbar.rec,.fmc-unified .sim-bars .sbar.net,.fmc-unified .waterfall .bar.rec,.fmc-unified .waterfall .bar.net{background:#1267E5!important}
.fmc-unified .footer,.fmc-unified .footer-v3{background:#071E33!important;color:#BFD3E6}.fmc-unified .footer strong,.fmc-unified .footer-v3 strong{color:#fff}.fmc-unified .footer a,.fmc-unified .footer-v3 a{color:#BFD3E6;display:inline-block;max-width:100%;overflow-wrap:anywhere}.fmc-unified .footer-grid>div{min-width:0;max-width:100%}
.fmc-unified .app-hero,.fmc-unified .project-one .app-hero{background:#1267E5!important}.fmc-unified .booking-core,.fmc-unified .demo-v2{background:#071E33!important}.fmc-unified .offer-featured{border-color:#1267E5!important}.fmc-unified .brand-rule{border-left-color:#1267E5!important;background:#F4F8FD!important}
.fmc-unified .player-surfaces>*{min-width:0;max-width:100%}.fmc-unified .surface-head{flex-wrap:wrap;gap:10px}.fmc-unified .onboard-shell{grid-template-columns:minmax(0,260px) minmax(0,1fr)}.fmc-unified .onboard-shell>*{min-width:0}.fmc-unified .onboard-form .form-field{min-width:0}.fmc-unified .onboard-form .form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}@media(max-width:700px){.fmc-unified .onboard-form .form-grid{grid-template-columns:minmax(0,1fr)}}.fmc-unified .onboard-form input,.fmc-unified .onboard-form select,.fmc-unified .onboard-form textarea{min-width:0;max-width:100%}.fmc-unified .onboard-form pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:900px){.fmc-unified .onboard-shell{grid-template-columns:minmax(0,1fr)}}
.fmc-unified :focus-visible{outline:3px solid #1267E5;outline-offset:4px}.fmc-unified .hero-grid>*,.fmc-unified .financial-grid>*,.fmc-unified .margin-calc>*,.fmc-unified .crm-story>*,.fmc-unified .engine-grid>*{min-width:0}.fmc-menu-toggle{display:none}.fmc-unified input[type=range]{accent-color:#1267E5}
@media(max-width:1100px){.fmc-unified .nav-inner{flex-wrap:wrap;min-height:72px}.fmc-unified img.brand-logo{width:190px}.fmc-menu-toggle{display:inline-flex;margin-left:auto;align-items:center;gap:8px;background:#fff;border:1px solid #CCDCEB;border-radius:8px;padding:9px 12px;color:#071E33;font:600 13px/1.3 system-ui;cursor:pointer}.fmc-unified .nav-links{display:flex;flex-wrap:wrap;width:100%;gap:10px 18px;order:3;padding:12px 0}.fmc-unified .nav-links a:not(.btn){display:block}.fmc-unified.fmc-js .nav-links:not(.fmc-open){display:none}.fmc-unified .nav-links .lang-menu{right:auto;left:0}.fmc-unified .nav-links .btn{margin-left:auto}}
@media(max-width:960px){.fmc-unified .hero-grid{grid-template-columns:1fr}.fmc-unified .hero{padding:42px 0}.fmc-unified .hero-grid{gap:30px}.fmc-unified .hero h1{font-size:clamp(40px,7vw,58px)}.fmc-unified .hero p{font-size:17px}.fmc-unified .engine-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fmc-unified .engine-step{padding-bottom:45px}}
@media(max-width:600px){.fmc-unified .nav-inner{gap:12px}.fmc-unified img.brand-logo{width:180px}.fmc-unified .hero h1{font-size:42px}.fmc-unified .hero h1 span{display:inline}.fmc-unified .proof-pill{font-size:11px;padding:6px 9px}.fmc-unified .hero-actions{display:grid}.fmc-unified .engine-grid{grid-template-columns:1fr}.fmc-unified .rc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.fmc-unified .rc-kpis strong{font-size:24px}.fmc-unified .nav-links{align-items:flex-start}.fmc-unified .footer-grid{gap:20px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{transition:none!important;animation:none!important}}
'''
OS='''
body.home .venture-card.fillmycourt{display:flex;flex-direction:column;background:#071E33!important;color:#fff;min-height:310px;overflow:hidden;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body.home .venture-card.fillmycourt>img,body.home .venture-card.fillmycourt>.card-overlay{display:none}
body.home .venture-card.fillmycourt .card-content{position:relative;width:100%!important;box-sizing:border-box;padding:30px;min-height:310px}
body.home .venture-card.fillmycourt .fmc-lockup{display:block;width:232px;max-width:75%;height:auto;margin:0 0 25px}
body.home .venture-card.fillmycourt .eyebrow{font-size:10px;color:#BFD3E6;letter-spacing:.09em;margin:0 0 14px}
body.home .venture-card.fillmycourt h3{font-family:inherit;font-size:27px;line-height:1.15;font-weight:700;letter-spacing:-.03em;max-width:70%;color:#fff;margin:0 0 12px}
body.home .venture-card.fillmycourt .card-content>p:not(.eyebrow){font-size:13px;line-height:1.5;color:#BFD3E6;max-width:75%;margin-bottom:16px}
body.home .venture-card.fillmycourt .card-status{font-size:11px;line-height:1.5;color:#BFD3E6;max-width:80%;padding:0;border:0}
body.home .venture-card.fillmycourt .fmc-slot-art{position:absolute;right:-16px;bottom:47px;width:30%;height:auto;opacity:.32;z-index:-1}
body.home .venture-card.fillmycourt .card-arrow{color:#68C0FF;text-shadow:none;right:25px;bottom:23px}.venture-card.fillmycourt:hover{outline:2px solid #1267E5;outline-offset:2px}
#fillmycourt .feature-copy h2,.fillmycourt-case h1{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:-.04em;font-weight:750}
#fillmycourt .feature-visual.fmc-brand-panel>span{display:block}#fillmycourt .feature-tags{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}#fillmycourt .feature-tags span{background:#EAF4FF;color:#0B4FBF;padding:7px 9px;font-size:11px}
.fillmycourt-case .case-proof-hero{background:#F4F8FD}.fillmycourt-case .case-proof-grid{grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:40px}.fillmycourt-case .case-proof-grid .fmc-brand-panel{width:100%;min-height:340px;border:0}.fillmycourt-case .case-proof-role{font-size:10px;line-height:1.6;letter-spacing:.07em;white-space:normal}.fillmycourt-case .case-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fillmycourt-case .case-kpi strong{font-size:29px;overflow-wrap:anywhere}.fillmycourt-case .case-kpi span{font-size:11px;line-height:1.45}.fillmycourt-case .case-section .eyebrow{color:#0B4FBF}.fillmycourt-case .case-section.navy .eyebrow,.fillmycourt-case .investor-cta .eyebrow{color:#BFD3E6}
.fillmycourt-case .case-section p{font-size:15px;line-height:1.7}.fillmycourt-case .case-note{font-size:12px!important}.fillmycourt-case .case-section h2{font-size:clamp(29px,3.4vw,39px)}.fillmycourt-case .case-section h3{font-size:24px}.fillmycourt-case .flow-step p,.fillmycourt-case .risk-grid p,.fillmycourt-case .investor-fit p,.fillmycourt-case .capital-unlock p,.fillmycourt-case .valuation-stage p{font-size:13px!important}.fillmycourt-case .investor-cta{background:#071E33}
body.case-nav-fixed .site-header .nav-inner{align-items:center}
@media(max-width:1000px){.fillmycourt-case .case-proof-grid{grid-template-columns:1fr}.case-nav-fixed .site-header{height:auto;min-height:80px}.case-nav-fixed .nav-inner{width:calc(100% - 40px)!important;min-height:80px;padding:14px 0!important;position:relative}.case-nav-fixed .menu-toggle{display:flex;margin-left:auto;align-items:center;border:1px solid #BBCDDA;padding:10px 12px;background:#fff;color:#071E33}.case-nav-fixed .nav{display:none!important;position:absolute;top:100%;left:-20px;right:-20px;max-width:none!important;width:auto!important;overflow:visible!important;background:#fff;color:#071E33;gap:0!important;border:1px solid #D8E4F0;padding:10px 20px!important}.case-nav-fixed .nav.open{display:flex!important;flex-direction:column;align-items:stretch}.case-nav-fixed .nav>a{font-size:14px!important;padding:12px!important}.case-nav-fixed .nav .nav-contact{display:block!important;margin:6px 0!important}.case-nav-fixed .brand-logo{max-width:210px}.fillmycourt-case .site-header .nav-inner{gap:20px!important}}
@media(max-width:520px){body.home .venture-card.fillmycourt h3{max-width:88%;font-size:27px}.fillmycourt-case .case-proof-grid .fmc-brand-panel{min-height:270px}.fillmycourt-case .case-kpi{padding:18px 14px}.fillmycourt-case .case-kpi strong{font-size:25px}.fillmycourt-case .investor-cta-grid{grid-template-columns:1fr;gap:22px}.fillmycourt-case .button{white-space:normal}}
'''
(A/'brand.css').write_text(SHARED+(OS if IS_OS else SITE))
JS="""(()=>{'use strict';document.body.classList.add('fmc-js');document.querySelectorAll('.fmc-menu-toggle').forEach(b=>{const n=document.getElementById(b.getAttribute('aria-controls'));if(!n)return;const close=()=>{b.setAttribute('aria-expanded','false');n.classList.remove('fmc-open')};b.addEventListener('click',()=>{const o=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(o));n.classList.toggle('fmc-open',o)});n.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();b.focus()}})})})();"""
(A/'navigation.js').write_text(JS)
def inject(s,js=False):
 if '/assets/fmc-brand-v1/brand.css' not in s:s=s.replace('</head>','<link rel="stylesheet" href="/assets/fmc-brand-v1/brand.css"/></head>')
 if js and '/assets/fmc-brand-v1/navigation.js' not in s:s=s.replace('</body>','<script defer src="/assets/fmc-brand-v1/navigation.js"></script></body>')
 return s
panel='<div class="feature-visual fmc-brand-panel"><img class="fmc-lockup" src="/assets/fmc-brand-v1/logo-light.svg" width="466" height="100" alt="FillMyCourt"/><p class="fmc-panel-line">More play.<br/>Higher revenue.</p><p class="fmc-panel-desc">Revenue infrastructure<br/>for racket clubs</p><img class="fmc-slot-art" src="/assets/fmc-brand-v1/slots.svg" width="287" height="148" alt="" aria-hidden="true"/></div>'
changed=[]
if IS_OS:
 for name in ['index.html','ventures.html','cases/fillmycourt.html']:
  p=ROOT/name;s=p.read_text()
  if name=='index.html':
   new='<a class="venture-card fillmycourt" href="cases/fillmycourt"><div class="card-content"><p class="eyebrow">SPORTS TECHNOLOGY · IN DEVELOPMENT</p><img class="fmc-lockup" src="/assets/fmc-brand-v1/logo-light.svg" width="466" height="100" alt="FillMyCourt"/><h3>More play.<br/>Higher revenue.</h3><p>Revenue infrastructure for racket clubs.</p><span class="card-status">Venture development · Europe</span><img class="fmc-slot-art" src="/assets/fmc-brand-v1/slots.svg" alt="" aria-hidden="true"/></div><span class="card-arrow" aria-hidden="true">↗</span></a>'
   s,n=re.subn(r'<a class="venture-card fillmycourt".*?</a>',new,s,count=1,flags=re.S);assert n==1,'Home card not found'
  elif name=='ventures.html':
   start=s.index('id="fillmycourt"');end=s.index('</article>',start);part=s[start:end];a=part.index('<div class="feature-visual');b=part.index('<div class="feature-copy"',a);part=part[:a]+panel+part[b:];s=s[:start]+part+s[end:]
  else:
   s=re.sub(r'<div class="case-proof-logo[^\"]*"[^>]*>.*?</div>',panel,s,count=1,flags=re.S)
   s=s.replace('content="https://olsensteiner.com/assets/brands/fillmycourt-brand.svg"','content="https://olsensteiner.com/assets/fmc-brand-v1/social-preview.png"')
  s=inject(s).replace('data-release="6.5.6"','data-release="6.5.7"').replace('v6.5.6-fillmycourt-visual','v6.5.7-fmc-identity-v1');p.write_text(s);changed.append(name)
 for p in (ROOT/'cases').glob('*.html'):
  s=p.read_text();s=re.sub(r'<body class="(.*?)">',lambda m:'<body class="'+m[1]+(' case-nav-fixed' if 'case-nav-fixed' not in m[1] else '')+'">',s,count=1)
  if 'class="menu-toggle"' not in s:s=s.replace('<nav class="nav" id="primary-nav">','<button class="menu-toggle" type="button" aria-controls="primary-nav" aria-expanded="false">Menu</button><nav class="nav" id="primary-nav" aria-label="Main navigation">')
  p.write_text(inject(s));changed.append(str(p.relative_to(ROOT)))
 meta=ROOT/'assets/release.json'
 if meta.exists():
  j=json.loads(meta.read_text());j.update(release='6.5.7',base='6.5.6',build_date='2026-09-24');j['fillmycourt_identity']=manifest;j['notes']=['Unified FillMyCourt brand master across product site, portfolio cards and LinkedIn; removed text-on-text composites; restored all case mobile navigation.']+j.get('notes',[]);meta.write_text(json.dumps(j,indent=2)+'\n')
else:
 for p in ROOT.rglob('*.html'):
  if any(x in p.parts for x in ['.git','archive','qa','brand-review']):continue
  s=p.read_text(encoding='utf-8');old=s
  s=re.sub(r'<a([^>]*class="(?:brand|logo)"[^>]*)>.*?</a>',lambda m:'<a'+re.sub(r' aria-label="[^"]*"','',m[1])+' aria-label="FillMyCourt home"><img class="brand-logo" src="/assets/fmc-brand-v1/logo.svg" width="466" height="100" alt="FillMyCourt"/></a>',s,flags=re.S)
  s=re.sub(r'<body([^>]*)>',lambda m:'<body'+m[1]+' class="fmc-unified">' if 'class=' not in m[1] else '<body'+re.sub(r'class="([^"]*)"',lambda c:'class="'+c[1]+(' fmc-unified' if 'fmc-unified' not in c[1] else '')+'"',m[1])+'>',s,count=1)
  if 'fmc-menu-toggle' not in s and '<div class="nav-links">' in s:s=s.replace('<div class="nav-links">','<button class="fmc-menu-toggle" aria-controls="fmc-nav" aria-expanded="false" type="button">Menu <span aria-hidden="true">☰</span></button><div class="nav-links" id="fmc-nav">',1)
  rel=str(p.relative_to(ROOT));hero={'index.html':('Mais jogo.','Mais receita.'),'en/index.html':('More play.','Higher revenue.'),'es/index.html':('Más juego.','Más ingresos.'),'lv/index.html':('Vairāk spēļu.','Lielāki ieņēmumi.')}
  if rel in hero:
   a,b=hero[rel];s=re.sub(r'<h1>.*?</h1>',f'<h1>{a}<br/><span>{b}</span></h1>',s,count=1,flags=re.S)
  s=s.replace('https://fillmycourt.com/assets/og-card.png','https://fillmycourt.com/assets/fmc-brand-v1/social-preview.png').replace('href="/assets/favicon.svg"','href="/assets/fmc-brand-v1/mark.svg"');s=inject(s,js=True)
  if s!=old:p.write_text(s,encoding='utf-8');changed.append(rel)
 (ROOT/'assets/logo.svg').write_text(assets['logo.svg']);(ROOT/'assets/favicon.svg').write_text(assets['mark.svg'])
 (ROOT/'assets/release.json').write_text(json.dumps({'release':'3.5.0','date':'2026-09-24','identity':manifest,'scope':'Brand alignment only; product logic, pricing, forms and translations retained.'},indent=2)+'\n')
(ROOT/'BRAND-IDENTITY.md').write_text('''# FillMyCourt identity v1 — 24 September 2026

Approved direction: blue F-tile + outlined FillMyCourt wordmark.
Use full wordmark at first encounter. Icon-only is for avatars, favicon and compact
app surfaces. No claim is made here about trademark registration or uniqueness.

Master: assets/fmc-brand-v1/logo.svg. Reverse version changes wordmark fill only.
Navy #071E33; blue #1267E5; cyan #35A7FF, a restrained data accent; pale #F4F8FD; white.
No green/lime brand accents, metallic type, rackets, luxury photography or another logo.
Red/amber may indicate product risk.

Message: More play. Higher revenue.
Descriptor: Revenue infrastructure for racket clubs.
Motif: capacity slots filling; conceptual, not client-results data.

LinkedIn: linkedin-logo.png 400x400; linkedin-cover.png 1512x256;
linkedin-post.png 1200x1200; social-preview.png 1200x627.
Keep the left 280px of the cover free of important copy for the Page avatar.
LinkedIn assets are prepared, not represented as already installed.

Olsen Steiner retains its corporate brand. FillMyCourt receives a consistent
branded panel inside it, not a wholesale recolour of the parent website.

Official Page image specifications checked 24 September 2026:
https://www.linkedin.com/help/linkedin/answer/a563309/image-specifications-for-your-linkedin-pages-and-career-pages

Regenerate derivatives from this master. Never recreate F using font text.
''')
print(json.dumps({'site':'olsensteiner' if IS_OS else 'fillmycourt','modified_html':len(set(changed)),'identity_sha256':manifest['logo_hash'],'files':sorted(set(changed))},indent=2))
