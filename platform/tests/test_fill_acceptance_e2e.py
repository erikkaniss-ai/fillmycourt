"""Local Chromium only: no deploy, hosted OAuth, provider or production traffic."""
import copy
import json
import os
from pathlib import Path
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright
from test_fill_operator_e2e import QuietHandler

ROOT = Path(__file__).resolve().parent
PINNED = json.loads((ROOT / "fixtures/get-acceptance-79977c8-NOT-RUN.json").read_text())
SHA = "79977c8672db84e6c062a804268dd9123e04f480"
ORG = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
DENIED = "33333333-3333-4333-8333-333333333333"


def test_fill_local_acceptance_report_and_missing_go(tmp_path):
    screenshots = Path(os.getenv("FILL_QA_ARTIFACT_DIR") or tmp_path)
    screenshots.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    calls, external, static = [], [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            # Fixed fixture-review clock; not a claim that old evidence is fresh today.
            page.add_init_script("Date.now=()=>Date.parse('2026-10-21T10:30:00Z'); sessionStorage.setItem('fill.access','fixture-session');")

            def route_request(route):
                req, url = route.request, urlparse(route.request.url)
                if url.hostname != "127.0.0.1":
                    external.append(req.url)
                    return route.abort()
                if not url.path.startswith("/api/"):
                    static.append((req.method, url.path))
                    return route.continue_()
                calls.append((req.method, url.path))
                assert req.method == "GET", "New viewer may not send files or writes"
                assert req.headers.get("authorization") == "Bearer fixture-session"
                if url.path == "/api/me":
                    body = {"user": {"email": "fixture@example.invalid"}}
                elif url.path == "/api/fmc/organizations":
                    body = {"items": [{"id": ORG, "name": "SYNTHETIC A", "role": "owner"},
                        {"id": OTHER, "name": "SYNTHETIC B", "role": "admin"},
                        {"id": DENIED, "name": "SYNTHETIC MANAGER", "role": "manager"}]}
                elif url.path.endswith("/today"):
                    body = {"summary": {}, "courts": [], "empty_windows": []}
                elif url.path.endswith("/connections"):
                    body = {"items": []}
                else:
                    raise AssertionError("Unexpected API route; no acceptance backend exists")
                route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

            page.route("**/*", route_request)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/", wait_until="networkidle")
            page.get_by_role("button", name="Provider evidence", exact=True).click()
            expect(page.locator("#acceptanceReview")).to_be_enabled()
            expect(page.locator("#clubUatBlockers")).to_contain_text("No supported connections returned")
            club_before = page.locator("#clubUatBlockers").inner_html()
            summary = page.locator("#acceptanceSummary")
            club_steps = page.locator("#clubNextSteps")
            candidate_steps = page.locator("#candidateNextSteps")
            expect(club_steps.locator('[data-club-next="club-uat-go"]')).to_have_count(1)
            expect(club_steps.locator('[data-club-next="club-pilot-go"]')).to_have_count(1)
            expect(candidate_steps.locator('[data-candidate-go]')).to_have_count(0)
            club_steps_before = club_steps.inner_html()
            expect(summary).to_contain_text("No local report reviewed")
            before = len(calls)

            def select_report(value):
                page.get_by_label("Expected GetACourt SHA", exact=True).fill(SHA)
                page.get_by_label("Local preflight report JSON", exact=True).set_input_files({
                    "name": "FIXTURE-ONLY-NOT-RUN.json", "mimeType": "application/json",
                    "buffer": json.dumps(value).encode(),
                })
                page.get_by_role("button", name="Review local acceptance report", exact=True).click()

            select_report(PINNED)
            report = page.locator("#acceptanceReport")
            expect(report).to_contain_text("not a club-specific report or club GO")
            expect(report).to_contain_text(SHA)
            expect(report.locator(".acceptance-checks > li")).to_have_count(7)
            expect(report.get_by_text("Missing / invalid exact scoped GO in this snapshot.", exact=True)).to_have_count(7)
            expect(report).to_contain_text("create-test-user-session")
            expect(summary).to_contain_text("7 blocked")
            expect(summary).to_contain_text("GO records flagged missing / invalid: 7 of 7")
            expect(summary).to_contain_text("Verified GO: none")
            expect(summary.locator(".acceptance-summary-list > li")).to_have_count(7)
            assert page.locator("#clubUatBlockers").inner_html() == club_before
            assert club_steps.inner_html() == club_steps_before
            expect(candidate_steps.locator('[data-candidate-go]')).to_have_count(7)
            expect(candidate_steps).to_contain_text("separate deployment GO first; do not deploy")
            expect(candidate_steps).to_contain_text("exact SHA/deploy/action scope")
            expect(candidate_steps.locator("button, input, form, a")).to_have_count(0)
            expect(club_steps.locator("button, input, form, a")).to_have_count(0)
            assert len(calls) == before
            assert page.evaluate("localStorage.length") == 0
            assert page.evaluate("sessionStorage.length") == 1
            page.locator(".acceptance-panel").evaluate("e=>e.scrollIntoView({block:'start'})")
            page.screenshot(path=str(screenshots / "fill-acceptance-desktop-FIXTURE-ONLY.png"))
            page.locator(".review-gate-columns").evaluate("e=>e.scrollIntoView({block:'start'})")
            club_box = page.locator(".review-gate-columns .uat-blockers").bounding_box()
            candidate_box = page.locator(".acceptance-summary").bounding_box()
            assert candidate_box["x"] > club_box["x"]
            assert abs(candidate_box["y"] - club_box["y"]) < 10
            page.screenshot(path=str(screenshots / "fill-gate-summary-desktop-FIXTURE-ONLY.png"))
            page.locator(".review-gate-columns").screenshot(path=str(screenshots / "fill-go-next-desktop-FIXTURE-ONLY.png"))
            page.set_viewport_size({"width": 320, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.locator(".acceptance-panel").evaluate("e=>e.scrollIntoView({block:'start'})")
            page.screenshot(path=str(screenshots / "fill-acceptance-mobile-FIXTURE-ONLY.png"))
            page.locator(".acceptance-summary").evaluate("e=>e.scrollIntoView({block:'start'})")
            club_box = page.locator(".review-gate-columns .uat-blockers").bounding_box()
            candidate_box = page.locator(".acceptance-summary").bounding_box()
            assert candidate_box["y"] > club_box["y"]
            assert abs(candidate_box["x"] - club_box["x"]) < 10
            page.screenshot(path=str(screenshots / "fill-gate-summary-mobile-FIXTURE-ONLY.png"))
            page.locator(".candidate-next-panel").evaluate("e=>e.scrollIntoView({block:'start'})")
            page.screenshot(path=str(screenshots / "fill-go-next-mobile-FIXTURE-ONLY.png"))

            bad = copy.deepcopy(PINNED)
            bad["checks"][0]["blockers"].append("PRIVATE_SECRET<img src=x onerror=alert(1)>")
            select_report(bad)
            expect(report).to_be_empty()
            expect(page.locator("#acceptanceMessage")).to_contain_text("Report unavailable")
            expect(page.locator("#acceptanceMessage")).not_to_contain_text("PRIVATE_SECRET")
            expect(summary).to_contain_text("rejected or unavailable")
            expect(summary).not_to_contain_text("7 checks:")
            expect(candidate_steps.locator('[data-candidate-go]')).to_have_count(0)
            expect(candidate_steps).not_to_contain_text(SHA)
            complete = copy.deepcopy(PINNED)
            for item in complete["checks"]:
                item["blockers"] = []
                item["preflight"] = "READY_FOR_MANUAL_GO_REVIEW"
            select_report(complete)
            expect(report.get_by_text("Ready for manual GO review only", exact=True)).to_have_count(7)
            expect(report).to_contain_text("No verified GO")
            expect(page.locator("#clubUatBlockers")).to_contain_text("Owner UAT GO")
            expect(summary).to_contain_text("0 blocked")
            expect(summary).to_contain_text("missing / invalid: 0 of 7")
            expect(summary).to_contain_text("Verified GO: none")
            expect(candidate_steps.locator('[data-candidate-go]')).to_have_count(0)
            expect(candidate_steps.locator('[data-candidate-next="candidate-unverified-go"]')).to_contain_text("no GO is verified")
            assert club_steps.inner_html() == club_steps_before
            assert page.locator("#clubUatBlockers").inner_html() == club_before

            page.locator("#orgSelect").select_option(OTHER)
            expect(report).to_be_empty()
            expect(summary).to_contain_text("No local report reviewed")
            expect(summary).not_to_contain_text(SHA)
            expect(club_steps).to_contain_text(OTHER)
            expect(club_steps).not_to_contain_text(ORG)
            expect(candidate_steps.locator('[data-candidate-go]')).to_have_count(0)
            expect(candidate_steps).not_to_contain_text(SHA)
            expect(page.locator("#acceptanceSha")).to_have_value("")
            assert page.locator("#acceptanceFile").input_value() == ""
            select_report(PINNED)
            expect(report).to_contain_text("SYNTHETIC B")
            expect(report).not_to_contain_text("SYNTHETIC A")
            page.locator("#orgSelect").select_option(DENIED)
            expect(report).to_be_empty()
            expect(page.locator("#acceptanceReview")).to_be_disabled()
            expect(summary).to_contain_text("Signed-in owner/admin review is required")
            expect(summary).not_to_contain_text(SHA)
            page.locator("#orgSelect").select_option(ORG)
            expect(page.locator("#acceptanceReview")).to_be_enabled()
            select_report(PINNED)
            page.get_by_role("button", name="Today", exact=True).click()
            expect(report).to_be_empty()
            expect(summary).to_be_empty()
            expect(club_steps).to_be_empty()
            expect(candidate_steps).to_be_empty()
            page.get_by_role("button", name="Provider evidence", exact=True).click()
            select_report(PINNED)
            page.get_by_role("button", name="Sign out", exact=True).click()
            expect(report).to_be_empty()
            expect(summary).to_be_empty()
            expect(club_steps).to_be_empty()
            expect(candidate_steps).to_be_empty()
            expect(page.locator("#acceptanceSha")).to_have_value("")
            assert page.locator("#acceptanceFile").input_value() == ""
            assert page.evaluate("sessionStorage.length") == 0
            assert external == []
            assert all(method == "GET" for method, _ in calls + static)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
