"""Actual browser + actual search handler, with fictional Core and no provider egress."""
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import pytest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]

@pytest.fixture(scope="module")
def fixture_url():
    env = dict(os.environ, GAC_FEDERATED_TEST_ONLY="1")
    process = subprocess.Popen(["node", "--experimental-strip-types", "getacourt/tests/federated-test-server.mjs"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = process.stdout.readline().strip()
        assert line.startswith("FIXTURE_URL=http://127.0.0.1:")
        yield line.split("=", 1)[1]
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)

@pytest.fixture
def browser_page(fixture_url):
    with sync_playwright() as playwright:
        executable = os.environ.get("GAC_CHROMIUM_PATH") or shutil.which("chromium")
        browser = playwright.chromium.launch(headless=True, executable_path=executable, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 390, "height": 844})
        forbidden, errors = [], []
        def route_request(route):
            if route.request.url.startswith(fixture_url + "/"):
                route.continue_()
            else:
                forbidden.append(route.request.url)
                route.abort()
        context.route("**/*", route_request)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        context.request.get(fixture_url + "/__fixture?mode=ok")
        page.goto(fixture_url + "/personal-sources.html")
        yield page, context, forbidden, errors
        assert forbidden == []
        assert errors == []
        context.close(); browser.close()

@pytest.mark.parametrize("width", [320, 390, 1440])
def test_live_handler_fixture_and_layout(browser_page, fixture_url, width):
    page, context, _, _ = browser_page
    page.set_viewport_size({"width": width, "height": 900})
    assert context.request.get(fixture_url + "/__counts").json()["coreRequests"] == 0
    page.get_by_role("button", name="Search across sources").click()
    expect(page.locator("#offers .card")).to_have_count(2)
    expect(page.locator("#clubs .card")).to_have_count(2)
    expect(page.locator("#sourceStatus .source")).to_have_count(6)
    expect(page.locator("#offers")).to_contain_text("€26.50")
    expect(page.locator("#searchStatus")).to_contain_text("partial source coverage")
    quinta = page.locator("#clubs .card").filter(has_text="Quinta da Marinha")
    expect(quinta).to_have_count(1)
    expect(quinta).to_contain_text("Racket ID")
    expect(quinta).to_contain_text("unclaimed")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert page.evaluate("localStorage.length + sessionStorage.length") == 0
    page.get_by_text("Use your private Playtomic reader", exact=True).click()
    expect(page.locator("#readerGuide")).to_contain_text("Connect and open GetACourt")
    Path(ROOT / "test-artifacts").mkdir(exist_ok=True)
    page.screenshot(path=str(ROOT / f"test-artifacts/federated-{width}-FICTIONAL-CORE.png"), full_page=True)

@pytest.mark.parametrize("mode,expected", [("failed", "temporarily unavailable"), ("auth", "requires access"), ("empty", "Not connected"), ("api_failed", "local reviewed directory only")])
def test_provider_or_api_failure_preserves_directory(browser_page, fixture_url, mode, expected):
    page, context, _, _ = browser_page
    context.request.get(fixture_url + "/__fixture?mode=" + mode)
    page.get_by_role("button", name="Search across sources").click()
    expect(page.locator("#clubs .card")).to_have_count(2)
    expect(page.locator("#offers .card")).to_have_count(0)
    expect(page.locator("main")).to_contain_text(expected)


def test_filter_change_and_old_result_never_restore_old_club(browser_page, fixture_url):
    page, context, _, _ = browser_page
    context.request.get(fixture_url + "/__fixture?mode=slow")
    page.get_by_role("button", name="Search across sources").click()
    page.locator('[name="location"]').fill("Oeiras")
    expect(page.locator("#offers .card")).to_have_count(0)
    page.get_by_role("button", name="Search across sources").click()
    expect(page.locator("#clubs .card")).to_have_count(1)
    expect(page.locator("#clubs")).to_contain_text("OPA OEIRAS")
    page.wait_for_timeout(800)
    expect(page.locator("#offers .card")).to_have_count(0)
    expect(page.locator("#clubs")).not_to_contain_text("Quinta da Marinha")


def test_observation_expiry_clears_only_offers(browser_page, fixture_url):
    page, context, _, _ = browser_page
    context.request.get(fixture_url + "/__fixture?mode=expiring")
    page.get_by_role("button", name="Search across sources").click()
    expect(page.locator("#offers .card")).to_have_count(2)
    expect(page.locator("#searchStatus")).to_contain_text("snapshot expired", timeout=5000)
    expect(page.locator("#offers .card")).to_have_count(0)
    expect(page.locator("#clubs .card")).to_have_count(2)
