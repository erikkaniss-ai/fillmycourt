"""Visual browser acceptance for the Fill read-only operator MVP.

All responses below are local fixtures. The test proves that the UI renders
Today, recovery capacity and Calendar without a partner connection or write.
"""
from __future__ import annotations

import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


PUBLIC_ROOT = Path(__file__).resolve().parents[1] / "public"


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_ROOT), **kwargs)

    def log_message(self, *_args):
        pass


def _json(route, value):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(value))


def test_fill_operator_readonly_browser_flow(tmp_path):
    today = {
        "date": "2026-10-16", "day_start": "2026-10-16T00:00:00+01:00",
        "day_end": "2026-10-17T00:00:00+01:00", "timezone": "Europe/Lisbon",
        "currency": "EUR",
        "summary": {
            "capacity_minutes": 1080, "booked_minutes": 180, "held_minutes": 0,
            "blocked_minutes": 0, "empty_minutes": 900, "utilization_pct": 16.7,
            "bookings": 1, "cancellations": 0, "revenue_minor": 3600,
            "active_courts": 2, "courts_with_rate_coverage": 1,
            "courts_without_rate_coverage": 1, "bookable_60_starts": 5,
            "bookable_90_starts": 4, "highest_single_quote_minor": 3600,
            "highest_single_quote_duration_minutes": 90,
        },
        "courts": [
            {
                "court_id": "court-fixture", "court_name": "Fixture Court — not a partner",
                "has_rate_coverage": True, "open_start_minute": 540,
                "open_end_minute": 1080, "capacity_minutes": 540,
                "booked_minutes": 180, "held_minutes": 0, "blocked_minutes": 0,
                "bookings": 1, "cancellations": 0, "revenue_minor": 3600,
                "utilization_pct": 33.3, "empty_minutes": 360,
                "sellable_windows": [{"start_minute": 540, "end_minute": 1080}],
            },
            {
                "court_id": "court-unpriced", "court_name": "Unpriced Court — fixture",
                "has_rate_coverage": False, "open_start_minute": 0, "open_end_minute": 0,
                "capacity_minutes": 0, "booked_minutes": 0, "held_minutes": 0,
                "blocked_minutes": 0, "bookings": 0, "cancellations": 0,
                "revenue_minor": 0, "utilization_pct": 0, "empty_minutes": 0,
                "sellable_windows": [],
            },
        ],
        "empty_windows": [{
            "court_id": "court-fixture", "court_name": "Fixture Court — not a partner",
            "starts_at": "2026-10-16T12:00:00+01:00",
            "ends_at": "2026-10-16T15:00:00+01:00", "duration_minutes": 180,
            "bookable_60_count": 5, "min_60_amount_minor": 2400,
            "max_60_amount_minor": 2400, "bookable_90_count": 4,
            "min_90_amount_minor": 3600, "max_90_amount_minor": 3600,
            "best_amount_minor": 3600, "best_duration_minutes": 90,
            "best_starts_at": "2026-10-16T12:00:00+01:00", "currency": "EUR",
        }],
    }
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    requests = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.add_init_script("localStorage.setItem('fill.access', 'fixture-session')")

            def fulfill(route):
                request = route.request
                path = urlparse(request.url).path
                requests.append((request.method, path))
                assert request.method == "GET"
                if path == "/api/me":
                    _json(route, {"user": {"email": "operator@example.test"}})
                elif path == "/api/fmc/organizations":
                    _json(route, {"items": [{"id": "org-fixture", "name": "Fixture Club", "role": "manager"}]})
                elif path == "/api/fmc/org-fixture/today":
                    _json(route, today)
                elif path == "/api/fmc/org-fixture/calendar":
                    _json(route, {"bookings": [{"court_id": "court-fixture", "status": "confirmed", "starts_at": "2026-10-16T09:00:00+01:00", "ends_at": "2026-10-16T12:00:00+01:00", "source": "fixture"}], "holds": [], "blocks": []})
                else:
                    route.fulfill(status=404, content_type="application/json", body="{}")

            page.route("**/api/**", fulfill)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/", wait_until="networkidle")
            expect(page.get_by_role("heading", name="Today")).to_be_visible()
            expect(page.get_by_text("Staging · read-only.")).to_be_visible()
            expect(page.get_by_text("Needs rate coverage")).to_be_visible()
            expect(page.get_by_text("Fixture Court — not a partner").first).to_be_visible()

            page.get_by_role("button", name="Revenue & Capacity").click()
            expect(page.get_by_role("heading", name="Recovery candidates")).to_be_visible()
            expect(page.get_by_text("Capacity candidate only")).to_be_visible()
            expect(page.get_by_text("not a forecast")).to_be_visible()

            page.get_by_role("button", name="Calendar").click()
            expect(page.locator(".lane-cell.booked").first).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.screenshot(path=str(tmp_path / "fill-operator-fixture.png"), full_page=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    assert requests == [
        ("GET", "/api/me"), ("GET", "/api/fmc/organizations"),
        ("GET", "/api/fmc/org-fixture/today"), ("GET", "/api/fmc/org-fixture/calendar"),
    ]
