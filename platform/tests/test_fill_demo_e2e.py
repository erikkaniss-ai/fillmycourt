"""Chromium acceptance of explicit synthetic Fill operator mode; no API calls."""
from __future__ import annotations
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1] / "public"


class LocalFiles(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        pass


def test_demo_synthetic_today_revenue_calendar_mobile_no_network(tmp_path):
    folder=Path(os.environ.get("FILL_QA_ARTIFACT_DIR") or tmp_path)
    folder.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(("127.0.0.1",0),LocalFiles)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    api_calls=[]
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            page=browser.new_page(viewport={"width":1440,"height":940})
            def block_api(route):
                api_calls.append((route.request.method,route.request.url))
                route.abort("blockedbyclient")
            page.route("**/api/**",block_api)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/?demo=1",wait_until="networkidle")
            expect(page.locator("#demoNotice")).to_be_visible()
            expect(page.locator("#authGate")).to_be_hidden()
            expect(page.locator("#workspace")).to_be_visible()
            assert page.evaluate("document.querySelector('#orgSelect').getBoundingClientRect().right <= document.querySelector('.sidebar').getBoundingClientRect().right")
            expect(page.locator("#identity")).to_have_text("SYNTHETIC DEMO — no account")
            expect(page.locator("#orgSelect")).to_have_value("11111111-1111-4111-8111-111111111111")
            expect(page.get_by_text("DEMO Indoor Court A").first).to_be_visible()
            expect(page.get_by_text("Needs rate coverage")).to_be_visible()
            assert page.evaluate("localStorage.getItem('fill.access') === null")
            page.screenshot(path=str(folder/"05-synthetic-demo-today-FIXTURE-ONLY.png"),full_page=True)

            page.get_by_role("button",name="Revenue & Capacity").click()
            expect(page.get_by_role("heading",name="Recovery candidates")).to_be_visible()
            expect(page.get_by_text("Capacity candidate only").first).to_be_visible()
            expect(page.get_by_text("not a forecast")).to_be_visible()
            page.screenshot(path=str(folder/"06-synthetic-demo-revenue-FIXTURE-ONLY.png"),full_page=True)

            page.get_by_role("button",name="Calendar").click()
            expect(page.locator(".lane-cell.booked").first).to_be_visible()
            expect(page.locator(".lane-cell.held").first).to_be_visible()
            expect(page.locator(".lane-cell.blocked").first).to_be_visible()
            # Authoritative Core Calendar can include a confirmed booking on an
            # unpriced court: it MUST be visible instead of silently dropped.
            uncovered = page.locator(".court-lane").filter(has_text="DEMO Court C — needs price")
            expect(uncovered).to_be_visible()
            expect(uncovered.locator(".lane-cell.booked").first).to_be_visible()
            expect(uncovered.locator("em")).to_have_text("No rate")
            # The fake cancelled booking on Court A at 14:00 must never
            # contribute another booked half-hour cell.
            indoor = page.locator(".court-lane").filter(has_text="DEMO Indoor Court A")
            assert indoor.locator(".lane-cell.booked").count() == 6
            expect(page.get_by_text("Cancelled or failed bookings do not occupy capacity", exact=False)).to_be_visible()
            page.screenshot(path=str(folder/"07-synthetic-demo-calendar-FIXTURE-ONLY.png"),full_page=True)

            page.locator("#dateInput").fill("2026-11-10")
            expect(page.locator(".lane-cell.booked").first).to_be_visible()
            page.set_viewport_size({"width":390,"height":844})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.screenshot(path=str(folder/"08-synthetic-demo-mobile-FIXTURE-ONLY.png"),full_page=True)
            assert api_calls == []
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
