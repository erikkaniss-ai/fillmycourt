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


@pytest.mark.parametrize('width', [320,390,1440])
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
        window.dispatchEvent(new CustomEvent('gac:auto-search-response',
          {detail:{nonce:event.detail.nonce,result:{status:'observed',observation:record}}}));
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
           result:{status:'unavailable',code:'CHALLENGE_REQUIRED'}}}));
      });
    }""")
    page.get_by_role('button',name='Find courts',exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(0)
    expect(page.locator('#personalStatus')).to_contain_text('sign in')
    assert context.request.get(fixture_url+'/__counts').json()=={'coreRequests':0,'clubRequests':0}
    assert forbidden==[]
