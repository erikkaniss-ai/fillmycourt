"""Standalone GetACourt: real static browser UI with FICTIONAL personal reports.
No provider requests, credentials, Core availability, or club-owned feed.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from playwright.sync_api import expect
from test_federated_browser import browser_page, fixture_url, ROOT


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
    Path(ROOT/'test-artifacts').mkdir(exist_ok=True)
    page.screenshot(path=str(ROOT/f'test-artifacts/player-search-{width}-FICTIONAL.png'),full_page=True)


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
    Path(ROOT/'test-artifacts').mkdir(exist_ok=True)
    page.screenshot(path=str(ROOT/f'test-artifacts/unified-map-demo-{width}-FICTIONAL.png'),full_page=True)
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
