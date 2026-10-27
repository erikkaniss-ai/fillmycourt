"""Release UI + real handler + FICTIONAL club feed, no external network."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from playwright.sync_api import expect
from test_federated_browser import browser_page, fixture_url, ROOT

def prepare(page, context, fixture_url, mode):
    context.request.get(fixture_url + '/__fixture?mode=' + mode)
    page.goto(fixture_url + '/find.html')
    page.locator('[name="date"]').fill((datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat())

@pytest.mark.parametrize('width', [320, 390, 1440])
def test_search_from_direct_club_without_extension(browser_page, fixture_url, width):
    page, context, forbidden, _ = browser_page
    page.set_viewport_size({'width': width, 'height': 900})
    prepare(page, context, fixture_url, 'direct')
    assert context.request.get(fixture_url + '/__counts').json()['clubRequests'] == 0
    page.get_by_role('button', name='Find courts', exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('#offers')).to_contain_text('FICTIONAL DIRECT CLUB')
    expect(page.locator('#offers')).to_contain_text('FICTIONAL DIRECT COURT')
    expect(page.locator('#offers')).to_contain_text('€36.00')
    expect(page.locator('#offers')).to_contain_text('90 min')
    expect(page.get_by_role('link', name='Open club booking')).to_have_attribute('href', 'https://fixture-club.example.org/book')
    expect(page.locator('#searchStatus')).to_contain_text('1 court offer')
    assert 'Reader' not in page.locator('main').inner_text()
    assert page.locator('#personalPayload').count() == 0
    assert page.evaluate('localStorage.length + sessionStorage.length') == 0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    counts = context.request.get(fixture_url + '/__counts').json()
    assert counts == {'coreRequests': 0, 'clubRequests': 1}
    assert not forbidden
    Path(ROOT / 'test-artifacts').mkdir(exist_ok=True)
    page.screenshot(path=str(ROOT / f'test-artifacts/find-{width}-FICTIONAL-CLUB.png'), full_page=True)

@pytest.mark.parametrize('mode', ['direct_stale', 'direct_unpriced', 'empty'])
def test_unverified_or_disconnected_supply_does_not_create_offers(browser_page, fixture_url, mode):
    page, context, _, _ = browser_page
    prepare(page, context, fixture_url, mode)
    page.get_by_role('button', name='Find courts', exact=True).click()
    expect(page.locator('#offers .empty')).to_be_visible()
    expect(page.locator('#offers .card')).to_have_count(0)
    assert page.locator('#clubs').count() == 0
    assert page.get_by_role('link', name='Open club booking').count() == 0

def test_feed_expiry_and_changed_search_clear_offers(browser_page, fixture_url):
    page, context, _, _ = browser_page
    prepare(page, context, fixture_url, 'direct_expiring')
    page.get_by_role('button', name='Find courts', exact=True).click()
    expect(page.locator('#offers .card')).to_have_count(1)
    expect(page.locator('#searchStatus')).to_contain_text('Offers expired', timeout=5000)
    expect(page.locator('#offers .card')).to_have_count(0)
    prepare(page, context, fixture_url, 'direct_slow')
    page.get_by_role('button', name='Find courts', exact=True).click()
    page.locator('[name="location"]').fill('Oeiras')
    page.get_by_role('button', name='Find courts', exact=True).click()
    expect(page.locator('#searchStatus')).to_contain_text('No free courts have been verified')
    page.wait_for_timeout(700)
    expect(page.locator('#offers .card')).to_have_count(0)
