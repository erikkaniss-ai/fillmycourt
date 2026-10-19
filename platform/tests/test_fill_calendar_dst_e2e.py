"""Core-shaped operator Calendar E2E across Portuguese 23h/25h DST days.

No real user/provider data, no network. Ensures bookings during the autumn
repeated local hour do not disappear or double-count in the 30-min timeline.
"""
from __future__ import annotations

import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1] / "public"
ORG = "11111111-1111-4111-8111-111111111111"
COURT = "22222222-2222-4222-8222-222222222222"

DAYS = {
    "2026-10-25": {
        "start": "2026-10-25T00:00:00+01:00",
        "end": "2026-10-26T00:00:00+00:00",
        # Local 01:30 repeats; these are distinct instants one hour apart.
        "event_start": "2026-10-25T01:30:00+01:00",
        "event_end": "2026-10-25T01:30:00+00:00",
        "hours": 25,
        "cells": 50,
    },
    "2026-03-29": {
        "start": "2026-03-29T00:00:00+00:00",
        "end": "2026-03-30T00:00:00+01:00",
        # Clocks jump from 00:59 to 02:00: 60 elapsed minutes.
        "event_start": "2026-03-29T00:30:00+00:00",
        "event_end": "2026-03-29T02:30:00+01:00",
        "hours": 23,
        "cells": 46,
    },
}


class Static(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        pass


def test_operator_calendar_portugal_dst_repeated_and_missing_hours():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Static)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    requests = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.add_init_script("sessionStorage.setItem('fill.access', 'fixture-session')")

            def respond(route):
                request = route.request
                assert request.method == "GET", "Calendar must remain GET-only"
                url = urlparse(request.url)
                requests.append(url.path)
                if url.path == "/api/me":
                    body = {"user": {"email": "operator@example.invalid"}}
                elif url.path == "/api/fmc/organizations":
                    body = {"items": [{"id": ORG, "name": "SYNTHETIC DST CLUB", "role": "manager"}]}
                elif url.path.endswith("/today"):
                    day = parse_qs(url.query)["date"][0]
                    details = DAYS.get(day, DAYS["2026-10-25"])
                    body = {
                        "date": day, "day_start": details["start"], "day_end": details["end"],
                        "timezone": "Europe/Lisbon", "currency": "EUR",
                        "summary": {
                            "capacity_minutes": 0, "booked_minutes": 0,
                            "held_minutes": 0, "blocked_minutes": 0, "empty_minutes": 0,
                            "utilization_pct": 0, "bookings": 1, "cancellations": 0,
                            "revenue_minor": 0, "active_courts": 1,
                            "courts_with_rate_coverage": 0, "courts_without_rate_coverage": 1,
                            "bookable_60_starts": 0, "bookable_90_starts": 0
                        },
                        "courts": [{
                            "court_id": COURT, "court_name": "SYNTHETIC DST Court",
                            "has_rate_coverage": False, "capacity_minutes": 0,
                            "booked_minutes": 0, "held_minutes": 0, "blocked_minutes": 0,
                            "empty_minutes": 0, "bookings": 1, "revenue_minor": 0,
                            "utilization_pct": 0, "sellable_windows": []
                        }],
                        "empty_windows": []
                    }
                elif url.path.endswith("/calendar"):
                    start = parse_qs(url.query)["start"][0]
                    day = start[:10]
                    details = DAYS.get(day, DAYS["2026-10-25"])
                    assert parse_qs(url.query)["end"][0] == details["end"]
                    body = {
                        "bookings": [{
                            "court_id": COURT, "starts_at": details["event_start"],
                            "ends_at": details["event_end"], "status": "confirmed",
                            "source": "SYNTHETIC-DST-FIXTURE"
                        }, {
                            "court_id": COURT, "starts_at": details["start"],
                            "ends_at": details["event_start"], "status": "cancelled",
                            "source": "SYNTHETIC-CANCELLED-FIXTURE"
                        }],
                        "holds": [], "blocks": []
                    }
                else:
                    route.fulfill(status=404, content_type="application/json", body="{}")
                    return
                route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

            page.route("**/api/**", respond)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/", wait_until="networkidle")
            for day, details in DAYS.items():
                page.locator("#dateInput").fill(day)
                page.get_by_role("button", name="Calendar").click()
                expect(page.locator(".calendar-dst-note")).to_contain_text(
                    f"{details['hours']} hours"
                )
                expect(page.locator(".court-lane")).to_have_count(1)
                expect(page.locator(".court-lane .lane-cell")).to_have_count(details["cells"])
                expect(page.locator(".court-lane .lane-cell.booked")).to_have_count(2)
                if day == "2026-10-25":
                    # Both 01:00 ticks must be distinct and carry different offsets.
                    labels = page.locator(".time-axis span").all_text_contents()
                    one_oclock = [label for label in labels if label.startswith("01:00")]
                    assert len(one_oclock) == 2, labels
                    assert one_oclock[0] != one_oclock[1], one_oclock
                    assert any("UTC+1" in t for t in one_oclock), one_oclock
                    assert any("UTC+0" in t for t in one_oclock), one_oclock
                else:
                    # Nonexistent 01:00 hour must not appear on spring-forward day.
                    labels = page.locator(".time-axis span").all_text_contents()
                    assert not any(label.startswith("01:00") for label in labels)
                    assert any(label.startswith("02:00") for label in labels)
            assert requests
            assert all(url.startswith("/api/") for url in requests)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
