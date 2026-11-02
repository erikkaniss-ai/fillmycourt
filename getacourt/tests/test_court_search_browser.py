"""Standalone GetACourt: real static browser UI with FICTIONAL personal reports.
No provider requests, credentials, Core availability, or club-owned feed.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from playwright.sync_api import expect
from test_federated_browser import browser_page, fixture_url, ROOT
ARTIFACTS=Path(os.environ.get('GAC_INTEGRATION_ARTIFACT_DIR',str(ROOT/'test-artifacts')))


def assert_event_map_parity(page):
    parity=page.evaluate("""() => ({
      list:[...document.querySelectorAll('#offers [data-event-mapped="true"]')].map(e=>e.dataset.eventKey).sort(),
      map:[...document.querySelectorAll('[data-event-keys]')].flatMap(e=>JSON.parse(e.dataset.eventKeys)).sort()
    })""")
    assert parity['list']==parity['map']


@pytest.mark.parametrize('width',[320,390,1440])
def test_event_intents_are_explicit_demo_only_with_one_shared_map_and_safe_cta(browser_page,fixture_url,width):
    page,context,forbidden,_=browser_page
    context.request.get(fixture_url+'/__fixture?mode=direct')
    page.set_viewport_size({'width':width,'height':1000})
    page.goto(fixture_url+'/find.html')
    page.evaluate("""() => {window.eventProviderCalls=[];
      for(const type of ['gac:auto-search-request','gac:additional-sources-request'])
        window.addEventListener(type,()=>window.eventProviderCalls.push(type));} """)
    page.get_by_role('button',name='Join a game',exact=True).click()
    expect(page.locator('#realMode')).to_have_attribute('aria-pressed','true')
    expect(page.locator('#demoBanner')).to_be_hidden()
    expect(page.locator('#offers .event-card')).to_have_count(0)
    expect(page.locator('#offers')).to_contain_text('Games are not connected yet')
    page.get_by_role('button',name='Find games',exact=True).click()
    assert page.evaluate('window.eventProviderCalls')==[]
    page.get_by_role('button',name='Explore demo',exact=True).click()
    expect(page.locator('#offers .event-card')).to_have_count(10)
    expect(page.locator('#sourceStatus .source')).to_have_count(4)
    expect(page.locator('#sourceStatus')).to_contain_text('Offline fictional example')
    expect(page.locator('#sourceStatus')).to_contain_text('Empty fictional response')
    expect(page.locator('[data-event-kind="start_open_match"]')).to_contain_text('0 / 4 people')
    expect(page.locator('[data-event-kind="start_open_match"]')).to_contain_text('€48.00 / event')
    expect(page.locator('[data-event-kind="player_needed"]')).to_contain_text('Time unconfirmed')
    expect(page.locator('[data-event-kind="player_needed"]')).to_have_attribute('data-event-mapped','false')
    expect(page.locator('[data-result-pin]')).to_have_count(3)
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    page.evaluate('() => { document.activeElement?.blur(); window.scrollTo(0,0); }')
    page.screenshot(path=str(ARTIFACTS/f'event-intents-{width}-FICTIONAL.png'),full_page=False)
    assert_event_map_parity(page)
    assert page.locator('#offers a').count()==0
    assert page.locator('[data-offer-kind="real"]').count()==0
    assert page.locator('.leaflet-container').count()==1
    for badge in page.locator('#offers .badge').all():
        expect(badge).to_contain_text('FICTIONAL DEMO')
    # A focusable disabled handoff explains itself; Enter must not create registration.
    page.locator('#offers .event-cta').first.focus()
    page.keyboard.press('Enter')
    expect(page.locator('#mapSelection')).to_contain_text('No registration, application or payment was made')
    expect(page.locator('#offers .event-cta').first).to_have_attribute('aria-disabled','true')
    assert page.url==fixture_url+'/find.html'
    page.locator('#eventEntry').select_option('pair')
    expect(page.locator('#offers .event-card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('€26.00 / pair')
    expect(page.locator('#offers')).to_contain_text('Additional fees apply')
    assert_event_map_parity(page)
    page.locator('#eventEntry').select_option('any')
    page.locator('#eventSpace').select_option('waitlist')
    expect(page.locator('#offers .event-card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('Waitlist')
    assert_event_map_parity(page)
    page.locator('#eventSpace').select_option('any')
    page.locator('#eventUnscheduled').uncheck()
    expect(page.locator('[data-event-kind="player_needed"]')).to_have_count(0)
    page.locator('#eventUnscheduled').check()
    expect(page.locator('[data-event-kind="player_needed"]')).to_have_count(1)
    page.locator('#offersHeading').evaluate('el => el.scrollIntoView({block:"start"})')
    page.screenshot(path=str(ARTIFACTS/f'event-games-{width}-FICTIONAL.png'),full_page=False)
    page.get_by_role('button',name='Tournaments & mini-tournaments',exact=True).click()
    expect(page.locator('#offers .event-card')).to_have_count(3)
    expect(page.locator('#offers')).to_contain_text('4 / 8 pairs')
    expect(page.locator('#offers')).to_contain_text('€30.00 / pair')
    assert page.get_by_role('heading',name='The friendly pairs cup',exact=True).count()==1
    assert_event_map_parity(page)
    page.locator('#offersHeading').evaluate('el => el.scrollIntoView({block:"start"})')
    page.screenshot(path=str(ARTIFACTS/f'event-tournaments-{width}-FICTIONAL.png'),full_page=False)
    page.locator('[data-result-pin]').first.focus()
    page.keyboard.press('Enter')
    expect(page.locator('#offers .card:focus')).to_have_count(1)
    expect(page.locator('#offers .card:focus details')).to_have_attribute('open','')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.get_by_role('button',name='Your sessions',exact=True).click()
    expect(page.locator('#offers .event-card')).to_have_count(0)
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    expect(page.locator('#offers')).to_contain_text('Tournaments are not connected yet')
    expect(page.locator('#resultCount')).to_contain_text('Live event availability unverified')
    assert page.evaluate('window.eventProviderCalls')==[]
    assert page.evaluate('localStorage.length+sessionStorage.length')==0
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]


def test_event_text_url_and_privacy_attack_fixture_cannot_create_links_markup_or_join(browser_page,fixture_url):
    page,context,forbidden,_=browser_page
    page.goto(fixture_url+'/find.html')
    page.evaluate("""async() => {
      const {eventDemoFixtures}=await import('/assets/event-demo-fixtures.mjs');
      const {projectEvents}=await import('/assets/event-discovery.mjs');
      const {renderEventCards}=await import('/assets/event-discovery-view.mjs');
      const f=eventDemoFixtures('2026-11-01'),raw={...f.records[0],
        title:'<img src=x onerror=alert(1)><script>alert(1)</script>',
        organizer:'<svg onload=alert(1)>',sourceUrl:'javascript:alert(1)',
        roster:[{name:'DO-NOT-RENDER',email:'DO-NOT-RENDER@example.invalid'}],token:'DO-NOT-RENDER'};
      renderEventCards(document.querySelector('#offers'),projectEvents([raw],{mode:'demo',now:f.now}));
    }""")
    expect(page.locator('#offers h3')).to_have_text('<img src=x onerror=alert(1)><script>alert(1)</script>')
    assert page.locator('#offers img,#offers script,#offers svg,#offers a').count()==0
    expect(page.locator('#offers')).not_to_contain_text('DO-NOT-RENDER')
    expect(page.locator('#offers .event-cta')).to_have_attribute('aria-disabled','true')
    page.locator('#offers .event-cta').focus()
    page.keyboard.press('Enter')
    assert page.url==fixture_url+'/find.html'
    assert page.evaluate('localStorage.length+sessionStorage.length')==0
    assert forbidden==[]


def test_late_court_reader_reply_cannot_cross_into_an_event_intention(browser_page,fixture_url):
    page,context,forbidden,_=browser_page
    page.goto(fixture_url+'/find.html')
    page.add_init_script("""window.addEventListener('gac:auto-search-request',e=>window.oldCourtNonce=e.detail.nonce)""")
    record=ready(page,context,fixture_url)
    nonce=page.evaluate('window.oldCourtNonce')
    assert nonce
    page.get_by_role('button',name='Join a game',exact=True).click()
    page.evaluate("""({nonce,observation}) => {
      window.dispatchEvent(new CustomEvent('gac:auto-search-response',{detail:{nonce,
        result:{version:'0.4.2',status:'observed',observation}}}));
    }""",{'nonce':nonce,'observation':record})
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('#offers')).not_to_contain_text('FICTIONAL COURT 1')
    expect(page.locator('#offers')).to_contain_text('Games are not connected yet')
    page.get_by_role('button',name='Explore demo',exact=True).click()
    expect(page.locator('#offers .event-card')).to_have_count(10)
    expect(page.locator('#offers')).not_to_contain_text('FICTIONAL COURT 1')
    assert page.locator('[data-offer-kind="real"]').count()==0
    assert page.evaluate('localStorage.length+sessionStorage.length')==0
    assert forbidden==[]


def sample(page, *, patch=None):
    today=page.locator('[name="date"]').input_value()
    captured=page.evaluate("new Date().toISOString()")
    record={
        "provider":"playtomic", "source":"user_ui_observation",
        "sourceUrl":"https://playtomic.com/clubs/cascais-padel-club",
        "venue":"Cascais Padel & Nature", "date":today, "sport":"Padel",
        "capturedAt":captured, "timezone":None, "sourceFreshness":"unknown",
        "coverage":"expanded_offers_only",
        "offers":[{"court":"FICTIONAL COURT 1", "startLabel":"6:00 PM",
                   "endLabel":"7:30 PM", "durationMinutes":90, "priceEur":36}]
    }
    return {**record, **(patch or {})}


def ready(page, context, base):
    context.request.get(base+'/__fixture?mode=direct')
    page.goto(base+'/find.html')
    # Manual paste is deliberately inside an opt-in details element.
    page.get_by_text('Manual Reader troubleshooting (not needed for normal searches)',exact=True).click()
    page.locator('[name="date"]').fill((datetime.now(timezone.utc)+timedelta(days=1)).date().isoformat())
    page.locator('[name="duration"]').select_option('90')
    page.get_by_role('button',name='Find courts',exact=True).click()
    expect(page.locator('#searchStatus')).to_contain_text('Searching')
    return sample(page)


@pytest.mark.parametrize('width', [320,390,768,1440])
def test_player_observation_produces_a_real_client_only_result_and_official_handoff(browser_page,fixture_url,width):
    page,context,forbidden,_=browser_page
    page.set_viewport_size({'width':width,'height':900})
    record=ready(page,context,fixture_url)
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    page.locator('#personalPayload').fill(json.dumps(record))
    page.get_by_role('button',name='Compare pasted offers').click()
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('FICTIONAL COURT 1')
    expect(page.locator('#offers')).to_contain_text('6:00 PM')
    expect(page.locator('#offers')).to_contain_text('90 min')
    expect(page.locator('#offers')).to_contain_text('€36.00')
    expect(page.locator('#offers')).to_contain_text('provider freshness/timezone unknown')
    expect(page.get_by_role('link',name='Continue on Playtomic (recheck availability)')).to_have_attribute(
        'href','https://playtomic.com/clubs/cascais-padel-club')
    assert 'FillMyCourt / Core' not in page.locator('main').inner_text()
    assert page.evaluate('localStorage.length + sessionStorage.length')==0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(ARTIFACTS/f'player-search-{width}-FICTIONAL.png'),full_page=True)


@pytest.mark.parametrize('width',[320,390,768,1440])
def test_unified_demo_map_list_keyboard_and_display_filters_without_provider_reads(browser_page,fixture_url,width):
    page,context,forbidden,_=browser_page
    context.request.get(fixture_url+'/__fixture?mode=direct')
    page.set_viewport_size({'width':width,'height':900})
    page.goto(fixture_url+'/find.html')
    expect(page.locator('#realMode')).to_have_attribute('aria-pressed','true')
    expect(page.locator('#demoBanner')).to_be_hidden()
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    page.evaluate("""() => {
      window.qaProviderDispatches=[];
      for(const name of ['gac:auto-search-request','gac:additional-sources-request'])
        window.addEventListener(name,e=>window.qaProviderDispatches.push(e.detail.query));
    }""")
    page.get_by_role('button',name='Explore demo',exact=True).click()
    expect(page.locator('#demoBanner')).to_be_visible()
    expect(page.locator('#offers .card')).to_have_count(6)
    expect(page.locator('[data-result-pin]')).to_have_count(3)
    assert page.locator('#offers a').count()==0
    assert page.locator('[data-offer-kind="real"]').count()==0
    for badge in page.locator('#offers .badge').all():
        expect(badge).to_contain_text('DEMO')
    for pin in page.locator('[data-result-pin]').all():
        expect(pin).to_contain_text('DEMO')
    assert page.evaluate('window.qaProviderDispatches')==[]
    page.locator('#offers .card').first.get_by_role('button',name='Show on map').click()
    expect(page.locator('#offers .card.selected')).to_have_count(1)
    expect(page.locator('[data-result-pin].selected')).to_have_count(1)
    # Leaflet keyboard activation must lead to an accessible corresponding card.
    page.locator('[data-result-pin]').last.focus()
    page.keyboard.press('Enter')
    expect(page.locator('#offers .card:focus')).to_have_count(1)
    page.locator('#searchOrigin').select_option('demo')
    expect(page.locator('#offers')).to_contain_text('km · DEMO')
    page.locator('#offers .card').first.get_by_role('button',name='Show on map').click()
    expect(page.locator('.leaflet-popup-content')).to_contain_text('km straight-line · DEMO')
    page.locator('#radiusFilter').select_option('2')
    expect(page.locator('#offers .card')).to_have_count(2)
    page.locator('#budgetFilter').select_option('30')
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('€28.00')
    assert page.evaluate('window.qaProviderDispatches')==[]
    page.locator('#radiusFilter').select_option('any')
    page.locator('#budgetFilter').select_option('any')
    page.locator('#offerSort').select_option('price')
    expect(page.locator('#offers .card').first).to_contain_text('€24.00')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    assert page.evaluate('localStorage.length + sessionStorage.length')==0
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    # Full-page capture must start at the entry scroll position; otherwise a
    # fixed offscreen skip link can be composited into the middle of the image.
    page.evaluate('() => { document.activeElement?.blur(); window.scrollTo(0,0); }')
    page.evaluate('() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
    page.screenshot(path=str(ARTIFACTS/f'unified-map-demo-{width}-FICTIONAL.png'),full_page=True)
    page.get_by_role('button',name='Your sessions',exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    expect(page.locator('#demoBanner')).to_be_hidden()
    assert page.evaluate('window.qaProviderDispatches')==[]


def test_real_ttl_clears_map_cards_and_late_reply_cannot_cross_demo_boundary(browser_page,fixture_url):
    page,context,_,_=browser_page
    record=ready(page,context,fixture_url)
    record['capturedAt']=(datetime.now(timezone.utc)-timedelta(seconds=57)).isoformat(timespec='milliseconds').replace('+00:00','Z')
    page.locator('#personalPayload').fill(json.dumps(record))
    page.get_by_role('button',name='Compare pasted offers').click()
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('[data-result-pin]')).to_have_count(1)
    expect(page.locator('#offers .card')).to_have_count(0,timeout=6000)
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    page.evaluate("""() => {
      window.addEventListener('gac:auto-search-request',e=>window.qaOldNonce=e.detail.nonce);
    }""")
    page.get_by_role('button',name='Find courts',exact=True).click()
    record=sample(page)
    page.get_by_role('button',name='Explore demo',exact=True).click()
    page.evaluate("""record => window.dispatchEvent(new CustomEvent('gac:auto-search-response',{
      detail:{nonce:window.qaOldNonce,result:{status:'observed',version:'0.4.2',observation:record}}
    }))""",record)
    assert page.locator('[data-offer-kind="real"]').count()==0
    expect(page.locator('#offers')).not_to_contain_text('FICTIONAL COURT 1')
    page.get_by_role('button',name='Your sessions',exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('[data-result-pin]')).to_have_count(0)


@pytest.mark.parametrize('clear_kind',['ttl','clear','query','demo'])
def test_private_selected_map_announcement_clears_with_cards_and_pins(browser_page,fixture_url,clear_kind):
    page,context,_,_=browser_page
    record=ready(page,context,fixture_url)
    record['offers'][0]['court']='FICTIONAL PRIVATE COURT'
    if clear_kind=='ttl':
        record['capturedAt']=(datetime.now(timezone.utc)-timedelta(seconds=55)).isoformat(timespec='milliseconds').replace('+00:00','Z')
    page.locator('#personalPayload').fill(json.dumps(record))
    page.get_by_role('button',name='Compare pasted offers').click()
    page.locator('#offers .card').get_by_role('button',name='Show on map').click()
    expect(page.locator('#mapSelection')).to_contain_text('FICTIONAL PRIVATE COURT')
    if clear_kind=='ttl':
        expect(page.locator('#offers .card')).to_have_count(0,timeout=8000)
    elif clear_kind=='clear':
        page.get_by_role('button',name='Clear results',exact=True).click()
    elif clear_kind=='query':
        page.locator('[name="location"]').fill('Oeiras')
    else:
        page.get_by_role('button',name='Explore demo',exact=True).click()
    expect(page.locator('#mapSelection')).to_have_text('')
    expect(page.locator('body')).not_to_contain_text('FICTIONAL PRIVATE COURT')
    assert page.locator('[data-offer-kind="real"]').count()==0


def test_osm_image_fixture_receives_origin_only_and_no_credentials_or_location_request(browser_page,fixture_url):
    page,context,forbidden,_=browser_page
    seen=[]
    context.add_cookies([{'name':'qa_osm_cookie','value':'NEVER_SEND','url':'https://tile.openstreetmap.org'}])
    page.on('request',lambda request:seen.append(request) if request.url.startswith('https://tile.openstreetmap.org/') else None)
    page.add_init_script("""window.qaLocationCalls=0;
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
        getCurrentPosition:(success,error)=>{window.qaLocationCalls++;error({code:1,message:'denied in fixture'});}
      }});""")
    page.goto(fixture_url+'/find.html?qa_private_query=NEVER_SEND')
    expect(page.locator('.leaflet-tile-loaded').first).to_be_visible()
    assert seen
    for request in seen:
        headers=request.all_headers()
        assert headers.get('referer')==fixture_url+'/'
        assert 'cookie' not in headers and 'authorization' not in headers
        assert 'NEVER_SEND' not in str(headers)
    assert page.evaluate('window.qaLocationCalls')==0
    expect(page.locator('#radiusFilter')).to_be_disabled()
    assert page.locator('.site-header a[href="index.html"]').count()==0
    assert page.locator('script[src="assets/app.js"]').count()==0
    assert page.evaluate("Array.from(new FormData(document.getElementById('search')).keys()).sort()")==['date','duration','from','location','sport','to']
    page.get_by_role('link',name='GetACourt home',exact=True).click()
    assert page.url==fixture_url+'/find.html'
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]


def test_exact_nonce_and_page_ack_are_required_before_direct_extension_handoff(browser_page,fixture_url):
    page,context,forbidden,_=browser_page
    record=ready(page,context,fixture_url)
    page.evaluate("""() => {
      window._acked=false;
      window.addEventListener('gac:personal-observation-accepted',()=>window._acked=true);
    }""")
    # Without the user action and matching nonce no report is accepted.
    page.evaluate("""record => window.dispatchEvent(new CustomEvent(
      'gac:personal-observation',{detail:{nonce:'a'.repeat(48),observation:record}}
    ))""",record)
    expect(page.locator('#offers .card')).to_have_count(0)
    assert page.evaluate('window._acked') is False
    page.get_by_role('button',name='Receive prepared Reader offers').click()
    nonce=page.evaluate('document.documentElement.dataset.gacPersonalBridgeRequest')
    assert len(nonce)==48
    page.evaluate("""({nonce,record}) => window.dispatchEvent(new CustomEvent(
      'gac:personal-observation',{detail:{nonce,observation:record}}
    ))""",{'nonce':nonce,'record':record})
    expect(page.locator('#offers .card')).to_have_count(1)
    assert page.evaluate('window._acked') is True
    assert page.evaluate('document.documentElement.dataset.gacPersonalBridgeRequest') is None
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]


@pytest.mark.parametrize('patch,expected',[
    ({'access_token':'INJECTED-SECRET'},'report was rejected'),
    ({'date':'2026-10-20'},'date or sport differs'),
    ({'sourceUrl':'https://evil.invalid/clubs/test'},'report was rejected'),
    ({'offers':[{'court':'FAKE COURT','startLabel':'6:00 PM','endLabel':'7:30 PM',
                'durationMinutes':90,'priceEur':0}]},'report was rejected')
])
def test_sensitive_invalid_or_mismatched_observations_never_create_offers(browser_page,fixture_url,patch,expected):
    page,context,_,_=browser_page
    record=ready(page,context,fixture_url)
    record.update(patch)
    page.locator('#personalPayload').fill(json.dumps(record))
    page.get_by_role('button',name='Compare pasted offers').click()
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('#personalStatus')).to_contain_text(expected)
    assert page.locator('#personalPayload').input_value()==''
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}


def test_old_user_observation_cannot_be_reused(browser_page,fixture_url):
    page,context,_,_=browser_page
    record=ready(page,context,fixture_url)
    record['capturedAt']=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat(timespec='milliseconds').replace('+00:00','Z')
    page.locator('#personalPayload').fill(json.dumps(record))
    page.get_by_role('button',name='Compare pasted offers').click()
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('#personalStatus')).to_contain_text('expired')


def test_query_edit_clear_and_provider_failure_isolation(browser_page,fixture_url):
    page,context,forbidden,_=browser_page
    record=ready(page,context,fixture_url)
    page.locator('#personalPayload').fill(json.dumps(record))
    page.get_by_role('button',name='Compare pasted offers').click()
    expect(page.locator('#offers .card')).to_have_count(1)
    page.locator('[name="location"]').fill('Oeiras')
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.get_by_role('button',name='Receive prepared Reader offers')).to_be_disabled()
    expect(page.locator('#sourceStatus')).to_contain_text('TiePlayer / TieSports')
    expect(page.locator('#sourceStatus')).to_contain_text('Not connected')
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]


def test_one_click_receives_personal_result_without_manual_import(browser_page,fixture_url):
    page,context,forbidden,_=browser_page
    context.request.get(fixture_url+'/__fixture?mode=direct')
    page.goto(fixture_url+'/find.html')
    page.locator('[name="date"]').fill((datetime.now(timezone.utc)+timedelta(days=1)).date().isoformat())
    page.locator('[name="duration"]').select_option('90')
    record=sample(page)
    page.evaluate("""record => {
      window.fixtureRequests=0;
      // Simulated extension reply — never a real Playtomic or Core request.
      window.addEventListener('gac:auto-search-request',event=>{
        window.fixtureRequests++;
        window.dispatchEvent(new CustomEvent('gac:auto-search-accepted',
          {detail:{nonce:event.detail.nonce}}));
        // A legacy responder must not consume the compatible result window.
        window.dispatchEvent(new CustomEvent('gac:auto-search-response',
          {detail:{nonce:event.detail.nonce,result:{status:'unavailable',
            code:'REQUEST_REJECTED',version:'0.2.3'}}}));
        window.dispatchEvent(new CustomEvent('gac:auto-search-response',
          {detail:{nonce:event.detail.nonce,result:{status:'observed',observation:record,version:'0.4.2'}}}));
      });
    }""",record)
    page.get_by_role('button',name='Find courts',exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('€36.00')
    assert page.evaluate('window.fixtureRequests')==1
    assert page.locator('#personalPayload').input_value()==''
    expect(page.get_by_role('link',name='Continue on Playtomic (recheck availability)')).to_have_attribute(
        'href','https://playtomic.com/clubs/cascais-padel-club')
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]

def test_auto_search_provider_login_expiry_is_explicit(browser_page,fixture_url):
    page,context,forbidden,_=browser_page
    context.request.get(fixture_url+'/__fixture?mode=direct')
    page.goto(fixture_url+'/find.html')
    page.locator('[name="date"]').fill((datetime.now(timezone.utc)+timedelta(days=1)).date().isoformat())
    page.evaluate("""() => {
      window.addEventListener('gac:auto-search-request',event=>{
        window.dispatchEvent(new CustomEvent('gac:auto-search-accepted',
          {detail:{nonce:event.detail.nonce}}));
        window.dispatchEvent(new CustomEvent('gac:auto-search-response',
          {detail:{nonce:event.detail.nonce,
           result:{status:'unavailable',code:'CHALLENGE_REQUIRED',version:'0.4.2'}}}));
      });
    }""")
    page.get_by_role('button',name='Find courts',exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('#personalStatus')).to_contain_text('sign in')
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]


@pytest.mark.parametrize('width', [320, 390, 1440])
def test_one_find_combines_multiple_personal_playtomic_clubs_without_fabricating_unavailable(browser_page,fixture_url,width):
    page,context,forbidden,_=browser_page
    page.set_viewport_size({'width':width,'height':900})
    context.request.get(fixture_url+'/__fixture?mode=direct')
    page.goto(fixture_url+'/find.html')
    page.locator('[name="date"]').fill((datetime.now(timezone.utc)+timedelta(days=1)).date().isoformat())
    day=page.locator('[name="date"]').input_value()
    record=sample(page)
    other={**record,
        'sourceUrl':'https://playtomic.com/clubs/padel-set-club-parede',
        'venue':'Padel Set Club Parede',
        'offers':[{'court':'Campo 2 - Paviténis','startLabel':'7:00 PM',
                   'endLabel':'8:30 PM','durationMinutes':90,'priceEur':42}]}
    page.evaluate("""data => {
      window.searches=0;
      window.addEventListener('gac:auto-search-request',ev=>{
        window.searches++;
        const nonce=ev.detail.nonce;
        window.dispatchEvent(new CustomEvent('gac:auto-search-accepted',{detail:{nonce}}));
        window.dispatchEvent(new CustomEvent('gac:auto-search-response',{detail:{
          nonce,result:{status:'partial',version:'0.4.2',coverage:'bounded_reviewed_club_pages_only',sources:[
            {provider:'playtomic',sourceUrl:data.good.sourceUrl,
             status:'observed',observation:data.good},
            {provider:'playtomic',sourceUrl:data.other.sourceUrl,
             status:'observed',observation:data.other},
            {provider:'playtomic',sourceUrl:'https://playtomic.com/clubs/sports-club-cascais',
             status:'unavailable',code:'NO_EXPANDED_OFFERS'},
            {provider:'playtomic',sourceUrl:'https://playtomic.com/clubs/quinta-dos-lombos-padel',
             status:'unavailable',code:'CHALLENGE_REQUIRED'}
          ]}
        }}));
      });
    }""",{'good':record,'other':other})
    page.get_by_role('button',name='Find courts',exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(2)
    assert page.evaluate('window.searches') == 1
    expect(page.locator('#searchStatus')).to_contain_text('2 supplied fresh')
    expect(page.locator('#personalStatus')).to_contain_text('2 club(s) incomplete')
    expect(page.locator('#offers')).to_contain_text('€36.00')
    expect(page.locator('#offers')).to_contain_text('€42.00')
    expect(page.get_by_role('link',name='Continue on Playtomic (recheck availability)')).to_have_count(2)
    links=page.get_by_role('link',name='Continue on Playtomic (recheck availability)')
    assert set(links.evaluate_all('(items)=>items.map(x=>x.href)'))=={
      record['sourceUrl'],other['sourceUrl']
    }
    assert context.request.get(fixture_url+'/__counts').json()=={
      'coreRequests':0,'clubRequests':0
    }
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    assert forbidden==[]


def visible_price_fixture(page, context, base_url, minutes, rows, *, hold=False):
    """Actual browser parser over rendered fictional rows; no numeric report stub."""
    context.request.get(base_url+'/__fixture?mode=direct')
    writes=[]
    context.on('request',lambda request: writes.append(request.method)
               if request.method not in ('GET','HEAD') else None)
    page.goto(base_url+'/find.html')
    page.locator('[name="location"]').fill('Oeiras')
    page.locator('[name="date"]').fill((datetime.now(timezone.utc)+timedelta(days=1)).date().isoformat())
    page.locator('[name="duration"]').select_option(str(minutes))
    page.add_script_tag(url=base_url+'/browser-companion/visible-provider-offers.js')
    page.evaluate("""({rows,hold}) => {
      const panel=document.createElement('section');panel.id='qaVisibleBookingRows';
      const title=document.createElement('h2');title.textContent='FICTIONAL player UI — no booking';
      panel.append(title);
      const qa=window.priceBrowserFixture={requests:0,deliveries:0,bookings:0,hold};
      for(const text of rows){
        const row=document.createElement('article');row.className='qa-booking-row';
        row.append(document.createTextNode(text+' '));
        const action=document.createElement('button');action.type='button';
        action.textContent='Reservar';action.addEventListener('click',()=>qa.bookings++);
        row.append(action);panel.append(row);
      }
      document.body.append(panel);
      qa.deliver=({wrongNonce=false,ageMs=0}={})=>{
        const detail=JSON.parse(JSON.stringify(qa.pending));
        if(wrongNonce)detail.nonce='0'.repeat(48);
        if(ageMs&&detail.result.sources[0].observation)
          detail.result.sources[0].observation.capturedAt=new Date(Date.now()-ageMs).toISOString();
        window.dispatchEvent(new CustomEvent('gac:additional-sources-response',{detail}));
        qa.deliveries++;
      };
      window.addEventListener('gac:additional-sources-request',event=>{
        qa.requests++;qa.query=event.detail.query;
        const q=event.detail.query;
        // No offer/price fields are manufactured here: read the rendered row
        // text and pass the actual pure parser result through the page bridge.
        qa.observation=GetACourtVisibleProviderOffers.buildObservation({
          provider:'tiesports',sourceUrl:'https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy',
          venue:'OPA OEIRAS',date:q.date,sport:'Padel',selectedDate:q.date,selectedSport:'Padel',
          regionTitle:'Reservas de campos',query:{date:q.date,sport:'Padel',from:q.from,to:q.to,
            durationMinutes:Number(q.duration)},
          rows:[...panel.querySelectorAll('.qa-booking-row')].map(row=>({
            text:row.innerText.trim(),action:row.querySelector('button').innerText,
            disabled:row.querySelector('button').disabled}))});
        const observation=qa.observation;
        const source=observation.readerError
          ?{provider:'tiesports',status:'unavailable',code:observation.readerError}
          :{provider:'tiesports',status:'observed',observation};
        qa.pending={nonce:event.detail.nonce,result:{version:'0.4.2',status:'partial',sources:[source]}};
        if(!qa.hold)queueMicrotask(()=>qa.deliver());
      });
      window.addEventListener('gac:auto-search-request',event=>{
        window.dispatchEvent(new CustomEvent('gac:auto-search-accepted',{detail:{nonce:event.detail.nonce}}));
      });
    }""",{'rows':rows,'hold':hold})
    expect(page.locator('#qaVisibleBookingRows')).to_be_visible()
    page.get_by_role('button',name='Find courts',exact=True).click()
    page.wait_for_function('window.priceBrowserFixture.requests===1')
    if not hold:
        page.wait_for_function('window.priceBrowserFixture.deliveries===1')
    return writes


def price_row(price, minutes=90, court=7):
    return f'Campo {court} 18:00 - {"19:00" if minutes==60 else "19:30"} {minutes} min {price}'


def assert_price_browser_quiet(page, context, forbidden, base_url, writes):
    assert writes==[]
    assert page.locator('#personalPayload').input_value()==''
    assert page.evaluate('window.priceBrowserFixture.requests')==1
    assert page.evaluate('window.priceBrowserFixture.bookings')==0
    assert page.evaluate('localStorage.length+sessionStorage.length')==0
    assert page.evaluate('indexedDB.databases().then(items=>items.length)')==0
    assert context.cookies()==[]
    assert len(context.pages)==1
    assert context.service_workers==[]
    assert context.request.get(base_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]  # Existing router fulfills OSM tiles locally; no external service egress.


@pytest.mark.parametrize('minutes',[60,90])
@pytest.mark.parametrize('price',['€36.50','36,50€'])
def test_visible_money_parser_reaches_browser_cards_with_exact_cents(browser_page,fixture_url,minutes,price):
    page,context,forbidden,_=browser_page
    writes=visible_price_fixture(page,context,fixture_url,minutes,[price_row(price,minutes)])
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('Court 7')
    expect(page.locator('#offers .offer-time')).to_contain_text(f'{minutes} min')
    expect(page.locator('#offers .offer-time')).to_contain_text('6:00 PM')
    expect(page.locator('#offers .offer-time')).to_contain_text('7:00 PM' if minutes==60 else '7:30 PM')
    expect(page.locator('#offers .offer-date')).to_have_text(page.locator('[name="date"]').input_value())
    expect(page.locator('#offers .price')).to_contain_text('€36.50')
    normalized=page.evaluate("""async() => {
      const {normalizePersonalObservation}=await import('/assets/personal-observation-bridge.mjs');
      const qa=window.priceBrowserFixture;
      return normalizePersonalObservation(JSON.stringify(qa.observation),qa.query,
        {now:Date.now(),validator:GetACourtPersonalSourceObservation.validateObservation});
    }""")
    assert normalized['offers'][0]['priceMinor']==3650
    assert normalized['offers'][0]['duration']==minutes
    assert normalized['offers'][0]['courtName']=='Court 7'
    expect(page.locator('#offers .official-link')).to_have_attribute('href',normalized['sourceUrl'])
    # TieSports has no trusted map coordinate: preserve provenance, invent no pin.
    expect(page.locator('#offers .distance')).to_contain_text('Position unverified')
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    expect(page.locator('#mappedCount')).to_have_text('0 mapped clubs')
    assert page.locator('#offers .map-card-button').count()==0
    assert_price_browser_quiet(page,context,forbidden,fixture_url,writes)


@pytest.mark.parametrize('minutes,price',[
    pytest.param(90,'€36.5',id='90-single-decimal'),pytest.param(60,'€36.5',id='60-single-decimal'),
    pytest.param(90,'36,500€',id='overprecision'),pytest.param(90,'-36€',id='signed'),
    pytest.param(90,'€36/2',id='expression'),pytest.param(90,'€36.50/player',id='per-player'),
    pytest.param(90,'from €36.50',id='from-price'),pytest.param(90,'€36.50 per hour',id='hourly')])
def test_visible_money_parser_rejects_ambiguous_rows_before_browser_cards(browser_page,fixture_url,minutes,price):
    page,context,forbidden,_=browser_page
    writes=visible_price_fixture(page,context,fixture_url,minutes,[price_row(price,minutes)])
    assert page.locator('#offers .card').count()==0,page.locator('#offers').inner_text()
    assert page.evaluate('window.priceBrowserFixture.observation.readerError')=='NO_EXPANDED_OFFERS'
    expect(page.locator('#offers .official-link')).to_have_count(0)
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    expect(page.locator('#sourceStatus')).to_contain_text('No complete priced offers')
    assert_price_browser_quiet(page,context,forbidden,fixture_url,writes)


@pytest.mark.parametrize('minutes',[60,90])
def test_visible_money_mixed_rows_keep_only_the_valid_browser_card(browser_page,fixture_url,minutes):
    page,context,forbidden,_=browser_page
    writes=visible_price_fixture(page,context,fixture_url,minutes,[
        price_row('€36.5',minutes),price_row('€36.50/player',minutes,8),price_row('€36.50',minutes,9)])
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('Court 9')
    expect(page.locator('#offers')).not_to_contain_text('Court 7')
    expect(page.locator('#offers')).not_to_contain_text('Court 8')
    expect(page.locator('#offers .price')).to_contain_text('€36.50')
    assert page.evaluate('window.priceBrowserFixture.observation.offers.map(o=>o.court)')==['Court 9']
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    expect(page.locator('#mappedCount')).to_have_text('0 mapped clubs')
    assert_price_browser_quiet(page,context,forbidden,fixture_url,writes)


@pytest.mark.parametrize('rejection',['wrong_nonce','stale','mode_change'])
def test_visible_money_real_parser_reply_obeys_browser_nonce_freshness_and_mode(browser_page,fixture_url,rejection):
    page,context,forbidden,_=browser_page
    writes=visible_price_fixture(page,context,fixture_url,90,[price_row('€36.50')],hold=True)
    assert page.evaluate('window.priceBrowserFixture.observation.offers[0].priceEur')==36.5
    if rejection=='mode_change':
        page.get_by_role('button',name='Explore demo',exact=True).click()
    page.evaluate("""kind => priceBrowserFixture.deliver({
      wrongNonce:kind==='wrong_nonce',ageMs:kind==='stale'?61000:0})""",rejection)
    expect(page.locator('#offers [data-offer-kind="real"]')).to_have_count(0)
    expect(page.locator('#offers')).not_to_contain_text('Court 7')
    if rejection=='wrong_nonce':
        page.evaluate('priceBrowserFixture.deliver()')
        expect(page.locator('#offers .card')).to_have_count(1)
        expect(page.locator('#offers .price')).to_contain_text('€36.50')
    elif rejection=='stale':
        expect(page.locator('#sourceStatus')).to_contain_text('Client observation rejected')
    else:
        assert page.evaluate('window.priceBrowserFixture.requests')==1
        page.get_by_role('button',name='Your sessions',exact=True).click()
        expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    assert_price_browser_quiet(page,context,forbidden,fixture_url,writes)


@pytest.mark.parametrize('prefix',['duplicates','distinct'])
def test_visible_row_limit_late_conflict_cannot_reach_browser_cards(browser_page,fixture_url,prefix):
    page,context,forbidden,_=browser_page
    rows=[price_row('€36,00',court=1 if prefix=='duplicates' else i+1) for i in range(20)]
    rows.append(price_row('€40,00',court=1))
    writes=visible_price_fixture(page,context,fixture_url,90,rows)
    assert page.locator('#offers .card').count()==0,page.locator('#offers').inner_text()
    assert page.evaluate('priceBrowserFixture.observation.readerError')=='OFFER_FORMAT_CHANGED'
    assert page.evaluate('priceBrowserFixture.observation.offers===undefined')
    expect(page.locator('#offers .official-link')).to_have_count(0)
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    assert_price_browser_quiet(page,context,forbidden,fixture_url,writes)


@pytest.mark.parametrize('duplicates',[20,119])
def test_visible_row_limit_duplicates_do_not_hide_late_independent_court(browser_page,fixture_url,duplicates):
    page,context,forbidden,_=browser_page
    rows=[price_row('€36,50',court=1)]*duplicates+[price_row('€40,05',court=2)]
    writes=visible_price_fixture(page,context,fixture_url,90,rows)
    expect(page.locator('#offers .card')).to_have_count(2)
    assert page.evaluate('priceBrowserFixture.observation.offers.map(o=>o.court)')==['Court 1','Court 2']
    for court,price in [('Court 1','€36.50'),('Court 2','€40.05')]:
        card=page.locator('#offers .card').filter(has=page.locator('.court-name',has_text='Court: '+court))
        expect(card).to_have_count(1)
        expect(card.locator('.price')).to_contain_text(price)
        expect(card.locator('.offer-time')).to_contain_text('90 min')
        expect(card.locator('.distance')).to_contain_text('Position unverified')
    expect(page.locator('[data-result-pin]')).to_have_count(0)
    expect(page.locator('#mappedCount')).to_have_text('0 mapped clubs')
    assert_price_browser_quiet(page,context,forbidden,fixture_url,writes)
