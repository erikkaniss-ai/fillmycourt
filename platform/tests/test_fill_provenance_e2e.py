"""Real Chromium UI, wholly synthetic local GET fixtures; no hosted UAT."""
import json
import os
from pathlib import Path
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright
from test_fill_operator_e2e import QuietHandler

ORG = "11111111-1111-4111-8111-111111111111"
PC = "22222222-2222-4222-8222-222222222222"
IDS = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"]
FLAGS = dict(pilot_ready=False, provider_requests_allowed=False, can_display_available_slots=False)


def test_operator_can_review_stored_evidence_without_provider_requests(tmp_path):
    screenshots = Path(os.getenv("FILL_QA_ARTIFACT_DIR") or tmp_path)
    screenshots.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    calls, mode = [], ["normal"]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.add_init_script("sessionStorage.setItem('fill.access','fixture-session')")

            def respond(route):
                req = route.request
                url = urlparse(req.url)
                calls.append((req.method, url.path, parse_qs(url.query)))
                assert req.method == "GET", "No writes in evidence viewer"
                assert url.hostname == "127.0.0.1", "No external API request"
                assert req.headers.get("authorization") == "Bearer fixture-session"
                status = 200
                if url.path == "/api/me":
                    body = {"user": {"email": "fixture@example.invalid"}}
                elif url.path == "/api/fmc/organizations":
                    body = {"items": [{"id": ORG, "name": "SYNTHETIC CLUB", "role": "owner"}]}
                elif url.path.endswith("/today"):
                    body = {"summary": {}, "courts": [], "empty_windows": []}
                elif url.path.endswith("/connections"):
                    body = {"items": [{"id": PC, "provider": "playtomic"}]}
                else:
                    assert url.path == f"/api/fmc/{ORG}/provider-provenance/{PC}"
                    query = parse_qs(url.query)
                    assert query["max_age_seconds"] == ["60"] and query["limit"] == ["50"]
                    following = "after_booking_id" in query
                    if following:
                        assert query["after_booking_id"] == [IDS[1]]
                    statuses = ["receipt_unavailable"] if following else ["missing_receipt_reference", "stale_receipt"]
                    if mode[0] == "foreign":
                        statuses = ["foreign_receipt"]
                    if mode[0] == "empty":
                        statuses = []
                    body = dict(mode="read_only_source_review", as_of="2026-10-21T05:00:00Z",
                        max_age_seconds=60, items=[dict(booking_id=IDS[i], status=s, **FLAGS)
                            for i, s in enumerate(statuses)], summary={}, status="needs_review",
                        has_more=not following and mode[0] == "normal",
                        next_after_booking_id=IDS[1] if not following and mode[0] == "normal" else None, **FLAGS)
                    if not statuses:
                        body["status"] = "no_shadow_bookings"
                    if mode[0] == "unsafe":
                        body["pilot_ready"] = True
                    if mode[0] in ("403", "404", "502"):
                        status, body = int(mode[0]), {"message": "PRIVATE_BACKEND_DETAILS"}
                route.fulfill(status=status, content_type="application/json", body=json.dumps(body))

            page.route("**/api/**", respond)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/", wait_until="networkidle")
            page.get_by_role("button", name="Provider evidence", exact=True).click()
            expect(page.locator("#provenanceConnection")).to_contain_text("Playtomic")
            assert len(calls) == 4, "Selecting tab must not infer receipt age or run report"
            page.locator("#provenanceConnection").select_option(PC)
            page.get_by_label("Maximum receipt age (seconds)").fill("60")
            page.get_by_role("button", name="Review stored evidence", exact=True).click()
            expect(page.locator("#provenanceReport")).to_contain_text("Receipt reference missing")
            expect(page.locator("#provenanceReport")).to_contain_text("Receipt is too old or expired")
            expect(page.locator("#provenanceReport")).to_contain_text("More bookings remain")
            expect(page.locator("#provenanceMessage")).to_contain_text("Pilot remains unapproved")
            page.screenshot(path=str(screenshots / "fill-provenance-desktop-FIXTURE-ONLY.png"), full_page=True)
            page.set_viewport_size({"width": 320, "height": 800})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.screenshot(path=str(screenshots / "fill-provenance-mobile-FIXTURE-ONLY.png"), full_page=True)
            page.get_by_role("button", name="Review next page", exact=True).click()
            expect(page.locator("#provenanceReport")).to_contain_text("Receipt missing or inaccessible")
            expect(page.locator("#provenanceNext")).to_be_hidden()
            for value in ("foreign", "empty", "unsafe", "403", "404", "502"):
                mode[0] = value
                page.get_by_role("button", name="Review stored evidence", exact=True).click()
                if value == "foreign":
                    expect(page.locator("#provenanceReport")).to_contain_text("different connection or organisation")
                elif value == "empty":
                    expect(page.locator("#provenanceMessage")).to_contain_text("No stored shadow bookings")
                else:
                    expect(page.locator("#provenanceReport")).to_be_empty()
                    expect(page.locator("#provenanceMessage")).to_contain_text(
                        "permission" if value == "403" else "unavailable")
                    expect(page.locator("#provenanceMessage")).not_to_contain_text("PRIVATE_BACKEND_DETAILS")
            page.get_by_role("button", name="Sign out", exact=True).click()
            expect(page.locator("#provenanceReport")).to_be_empty()
            expect(page.locator("#provenanceConnection")).not_to_contain_text(PC)
            expect(page.locator("#workspace")).to_be_hidden()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    assert all(method == "GET" for method, _, _ in calls)
