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
CLUB_PACKAGE = json.loads((ROOT / "fixtures/club-go-package-INCOMPLETE-FIXTURE-ONLY.json").read_text())
GET_PACKAGE = json.loads((ROOT / "fixtures/get-go-package-DECLARED-FIXTURE-ONLY.json").read_text())
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
                elif url.path.endswith("/preflight"):
                    body = {"mode": "read_only_operations_preflight", "contract_version": "provider-provenance-operations-preflight/v1",
                        "as_of": "2026-10-21T10:00:00Z", "operations_runtime_sha": "a" * 40,
                        "runtime_identity_source": "railway_build_environment_not_independent_attestation", "status": "operations_checks_passed",
                        "checks": {k: "pass" for k in ["operations_service", "non_production_runtime", "runtime_revision_matches",
                            "provider_reads_disabled_in_this_api", "owner_admin_scope", "authenticated_rls_context", "repeatable_read_only",
                            "schema_rls_select", "reader_columns_present", "get_routes_present"]},
                        "not_assessed": ["external_runtime_identity", "protected_host", "two_org_hosted_uat", "worker_provider_read_state", "fixture_provisioning", "owner_uat_go"],
                        **{k: False for k in ["hosted_uat_ready", "uat_accepted", "pilot_ready", "provider_requests_allowed", "can_display_available_slots", "deploy_allowed"]}}
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
            club_draft = page.locator("#clubGoRequest")
            candidate_drafts = page.locator("#candidateGoRequests")
            club_package_summary = page.locator("#clubPackageSummary")
            get_package_summary = page.locator("#getPackageSummary")
            club_missing, get_missing = page.locator("#clubPackageMissing"), page.locator("#getPackageMissing")
            club_preparation, get_preparation = page.locator("#clubPackageSteps"), page.locator("#getPackageSteps")
            club_preparation_summary, get_preparation_summary = page.locator("#clubPackageStepsSummary"), page.locator("#getPackageStepsSummary")
            for item in [club_preparation_summary, get_preparation_summary]:
                expect(item).to_contain_text("No current source/check context")
                expect(item.locator("[data-package-preparation-group]")).to_have_count(0)
            for item in [club_preparation, get_preparation]:
                expect(item).to_contain_text("No current source/check context")
                expect(item.locator("[data-package-step]")).to_have_count(0)
            for item in [club_missing, get_missing]:
                expect(item.locator("[data-package-component]")).to_have_count(0)
            for item in [club_package_summary, get_package_summary]:
                expect(item).to_contain_text("No current source/check context")
                expect(item).not_to_contain_text("PRESENT")
            expect(club_draft.locator('[data-go-template="club-uat"]')).to_have_count(1)
            expect(club_draft).to_contain_text(ORG)
            expect(club_draft).to_contain_text("[REQUIRED: exact approved Operations SHA")
            expect(candidate_drafts.locator("details")).to_have_count(0)
            club_draft_before = club_draft.inner_html()
            expect(page.locator("#clubPackageReview")).to_be_disabled()
            expect(page.locator("#getPackageReview")).to_be_disabled()
            expect(page.locator("#getPackageCheck")).to_be_disabled()
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
            expect(candidate_drafts.locator("details")).to_have_count(7)
            assert club_draft.inner_html() == club_draft_before
            for item in PINNED["checks"]:
                draft = candidate_drafts.locator(f'[data-go-template="{item["id"]}"]')
                expect(draft).to_contain_text(SHA)
                expect(draft).to_contain_text(", ".join(item["requiredGoActions"]))
                expect(draft).to_contain_text("UNSENT DRAFT · NOT GO")
            for drafts in [club_draft, candidate_drafts]:
                expect(drafts.locator("button, input, textarea, form, a, [contenteditable]")).to_have_count(0)
            expect(candidate_drafts).not_to_contain_text(ORG)
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
            # Native disclosure only: keyboard expansion does not send, save or grant GO.
            club_toggle = club_draft.locator("summary")
            club_toggle.focus()
            page.keyboard.press("Enter")
            expect(club_draft.locator("details")).to_have_attribute("open", "")
            expect(club_draft.locator("pre")).to_be_visible()
            oauth_draft = candidate_drafts.locator('[data-go-template="google-oauth"]')
            oauth_draft.locator("summary").click()
            expect(oauth_draft.locator("pre")).to_be_visible()
            expect(oauth_draft).to_contain_text("Separate explicit state-change GO REQUIRED")
            expect(oauth_draft).to_contain_text("any new deploy needs separate deployment GO")
            page.locator(".club-request-panel").screenshot(path=str(screenshots / "fill-go-request-club-desktop-FIXTURE-ONLY.png"))
            page.locator(".candidate-request-panel").screenshot(path=str(screenshots / "fill-go-request-get-desktop-FIXTURE-ONLY.png"))
            assert len(calls) == before
            assert page.evaluate("sessionStorage.length") == 1
            page.set_viewport_size({"width": 320, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            for name, panel in [("club", ".club-request-panel"), ("get", ".candidate-request-panel")]:
                page.locator(panel).evaluate("e=>e.scrollIntoView({block:'start'})")
                page.screenshot(path=str(screenshots / f"fill-go-request-{name}-mobile-FIXTURE-ONLY.png"))
            for draft in [club_draft, oauth_draft]:
                text = draft.locator("pre")
                assert text.evaluate("e=>e.scrollWidth <= e.clientWidth")
                assert text.evaluate("e=>!e.isContentEditable && getComputedStyle(e).whiteSpace==='pre-wrap'")
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
            club_toggle.click()
            expect(club_draft.locator("details")).not_to_have_attribute("open", "")

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
            expect(candidate_drafts.locator("details")).to_have_count(0)
            expect(candidate_drafts).not_to_contain_text(SHA)
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
            expect(candidate_drafts.locator("details")).to_have_count(0)
            expect(candidate_drafts).to_contain_text("No verified GO; do not execute")
            assert club_draft.inner_html() == club_draft_before
            assert club_steps.inner_html() == club_steps_before
            assert page.locator("#clubUatBlockers").inner_html() == club_before

            # New local completeness surfaces: declarations only, no approval or live check.
            page.get_by_label("Expected Operations SHA", exact=True).fill("a" * 40)
            page.get_by_role("button", name="Check Operations preflight", exact=True).click()
            expect(page.locator("#clubPackageReview")).to_be_enabled()
            package_calls = len(calls)
            package_blockers = page.locator("#clubUatBlockers").inner_html()
            club_result, get_result = page.locator("#clubPackageResult"), page.locator("#getPackageResult")

            def inspect_package(domain, value):
                page.locator(f"#{domain}PackageFile").set_input_files({
                    "name": "SANITIZED-FIXTURE-ONLY.json", "mimeType": "application/json", "buffer": json.dumps(value).encode(),
                })
                expect(page.locator(f"#{domain}PackageResult")).to_be_empty()
                expect(page.locator(f"#{domain}PackageSummary")).not_to_contain_text("of 15 PRESENT")
                expect(page.locator(f"#{domain}PackageMissing [data-package-component]")).to_have_count(0)
                expect(page.locator(f"#{domain}PackageSteps [data-package-step]")).to_have_count(0)
                expect(page.locator(f"#{domain}PackageStepsSummary [data-package-preparation-group]")).to_have_count(0)
                expect(page.locator(f"#{domain}PackageStepsSummary")).not_to_contain_text("Preparation notes:")
                page.locator(f"#{domain}PackageReview").click()

            inspect_package("club", CLUB_PACKAGE)
            expect(club_result).to_contain_text("1 of 13")
            expect(club_result).to_contain_text("original-authority: UNKNOWN")
            expect(club_result).to_contain_text("protected-deploy: MISSING")
            expect(club_result).to_contain_text("Verified GO: none")
            expect(club_package_summary).to_contain_text("1 of 13 PRESENT")
            expect(club_package_summary).to_contain_text("11 MISSING; 1 UNKNOWN")
            expect(club_package_summary).to_contain_text(ORG)
            expect(club_package_summary).not_to_contain_text(SHA)
            club_package_snapshot = club_package_summary.inner_html()
            expect(club_missing.locator('[data-package-part="MISSING"]')).to_have_count(11)
            expect(club_missing.locator('[data-package-part="UNKNOWN"]')).to_have_count(1)
            expect(club_missing.locator('[data-package-component="source-binding"]')).to_have_count(0)
            expect(club_missing.locator('[data-package-component="original-authority"]')).to_contain_text("Original approval and delegation")
            club_missing_before = club_missing.inner_html()
            expect(club_preparation.locator('[data-package-step-state="MISSING"]')).to_have_count(11)
            expect(club_preparation.locator('[data-package-step-state="UNKNOWN"]')).to_have_count(1)
            expect(club_preparation.locator('[data-package-step="source-binding"]')).to_have_count(0)
            expect(club_preparation).to_contain_text("Uncertainty is unresolved; independent review is needed")
            expect(club_preparation).to_contain_text("two already authorised synthetic organisations")
            expect(club_preparation).to_contain_text("Do not infer a provider SLA")
            club_preparation_before = club_preparation.inner_html()
            expect(club_preparation_summary).to_contain_text("Preparation notes: 12; 11 MISSING; 1 UNKNOWN")
            expect(club_preparation_summary).to_contain_text(ORG)
            expect(club_preparation_summary).to_contain_text("a" * 40)
            expect(club_preparation_summary).not_to_contain_text(SHA)
            expect(club_preparation_summary.locator("[data-package-preparation-group]")).to_have_count(4)
            expect(club_preparation_summary.locator('[data-package-preparation-group="runtime-isolation"]')).to_contain_text("4 MISSING; 0 UNKNOWN")
            expect(club_preparation_summary.locator('[data-package-preparation-group="authority-source"]')).to_contain_text("0 MISSING; 1 UNKNOWN")
            club_preparation_summary_before = club_preparation_summary.inner_html()
            club_package_before = club_result.inner_html()
            page.get_by_label("GetACourt package check", exact=True).select_option("google-oauth")
            inspect_package("get", GET_PACKAGE)
            expect(get_result).to_contain_text("15 of 15")
            expect(get_result).to_contain_text("independent manual review required")
            expect(get_result).to_contain_text("Verified GO: none")
            expect(get_result).to_contain_text("separate-state-change-go: PRESENT")
            expect(get_result).not_to_contain_text(ORG)
            expect(get_package_summary).to_contain_text("15 of 15 PRESENT")
            expect(get_package_summary).to_contain_text("0 MISSING; 0 UNKNOWN")
            expect(get_package_summary).to_contain_text("check google-oauth")
            expect(get_package_summary).to_contain_text(SHA)
            expect(get_package_summary).not_to_contain_text(ORG)
            expect(get_package_summary).to_contain_text("independent manual review still required")
            expect(get_missing.locator("[data-package-component]")).to_have_count(0)
            expect(get_missing).to_contain_text("Original evidence and GO remain unverified; do not execute")
            expect(get_preparation.locator("[data-package-step]")).to_have_count(0)
            expect(get_preparation).to_contain_text("Independent original-evidence and authority review is still required")
            expect(get_preparation).to_contain_text("Verified GO: none. Execution NOT_RUN; do not execute")
            expect(get_preparation_summary.locator("[data-package-preparation-group]")).to_have_count(0)
            expect(get_preparation_summary).to_contain_text("Absence of notes is not approval")
            expect(get_preparation_summary).to_contain_text("Independent original-evidence and authority review still required")
            expect(get_preparation_summary).not_to_contain_text("Preparation notes:")
            for item in [club_package_summary, get_package_summary]:
                expect(item).to_contain_text("Verified GO: none. Execution NOT_RUN")
                expect(item).to_contain_text("Existing blockers stay open")
                expect(item.locator("button, input, form, a")).to_have_count(0)
            assert club_package_summary.inner_html() == club_package_snapshot
            assert club_result.inner_html() == club_package_before
            assert page.locator("#clubUatBlockers").inner_html() == package_blockers
            assert len(calls) == package_calls
            mixed_package = copy.deepcopy(GET_PACKAGE)
            mixed_package["items"][0]["state"] = "UNKNOWN"
            mixed_package["items"][1]["state"] = "MISSING"
            mixed_package["items"].pop()
            inspect_package("get", mixed_package)
            expect(get_package_summary).to_contain_text("12 of 15 PRESENT")
            expect(get_missing.locator('[data-package-part="MISSING"]')).to_have_count(2)
            expect(get_missing.locator('[data-package-part="UNKNOWN"]')).to_have_count(1)
            expect(get_missing.locator('[data-package-component="separate-state-change-go"]')).to_have_count(1)
            expect(get_missing.locator('[data-package-component="protected-deploy"]')).to_have_count(0)
            expect(get_preparation.locator('[data-package-step-state="MISSING"]')).to_have_count(2)
            expect(get_preparation.locator('[data-package-step-state="UNKNOWN"]')).to_have_count(1)
            expect(get_preparation.locator('[data-package-step="source-binding"]')).to_contain_text("exact Get SHA and this single selected check")
            expect(get_preparation.locator('[data-package-step="separate-state-change-go"]')).to_contain_text("separate original GO")
            expect(get_preparation.locator('[data-package-step="protected-deploy"]')).to_have_count(0)
            expect(get_preparation.locator('[data-package-step="club-wide-coverage"]')).to_have_count(0)
            expect(get_preparation_summary).to_contain_text("Preparation notes: 3; 2 MISSING; 1 UNKNOWN")
            expect(get_preparation_summary).to_contain_text("check google-oauth")
            expect(get_preparation_summary).to_contain_text(SHA)
            expect(get_preparation_summary).not_to_contain_text(ORG)
            expect(get_preparation_summary).not_to_contain_text("Operations SHA")
            expect(get_preparation_summary.locator("[data-package-preparation-group]")).to_have_count(2)
            expect(get_preparation_summary.locator('[data-package-preparation-group="authority-source"]')).to_contain_text("1 MISSING; 1 UNKNOWN")
            expect(get_preparation_summary.locator('[data-package-preparation-group="consent-device"]')).to_contain_text("1 MISSING; 0 UNKNOWN")
            assert club_preparation_summary.inner_html() == club_preparation_summary_before
            assert club_preparation.inner_html() == club_preparation_before
            assert club_missing.inner_html() == club_missing_before
            assert club_package_summary.inner_html() == club_package_snapshot
            for item in [club_missing, get_missing, club_preparation, get_preparation]:
                expect(item.locator("button, input, form, a")).to_have_count(0)
            for item in [club_preparation, get_preparation]:
                expect(item).to_contain_text("not an execution order, assignment or evidence collection")
                expect(item).to_contain_text("Verified GO: none. Execution NOT_RUN")
            for item in [club_preparation_summary, get_preparation_summary]:
                expect(item).to_contain_text("not work completed, verified evidence or readiness")
                expect(item).to_contain_text("Verified GO: none. Execution NOT_RUN")
                expect(item).to_contain_text("Existing blockers stay open; do not execute")
                expect(item.locator("button, input, form, a")).to_have_count(0)
            assert page.locator("#clubUatBlockers").inner_html() == package_blockers
            assert len(calls) == package_calls

            def assert_preparation_beside_own_blockers():
                for domain, anchor, parent in [("club", "clubUatBlockers", "uat-blockers"), ("get", "acceptanceSummary", "acceptance-summary")]:
                    panel = page.locator(f".{domain}-package-preparation-summary-panel")
                    expect(panel).to_have_count(1)
                    expect(page.locator(f"#{domain}PackageStepsSummary")).to_have_count(1)
                    expect(panel.locator(f"h4#{domain}PackageStepsSummaryHeading")).to_have_count(1)
                    assert panel.evaluate("(e,a)=>e.parentElement.classList.contains(a.parent) && e.previousElementSibling.id===a.anchor && e.nextElementSibling.classList.contains(a.next)", {
                        "parent": parent, "anchor": anchor, "next": f"{domain}-package-summary-panel",
                    })
                    expect(panel).to_contain_text("Nothing is sent, approved or executed here")
                    expect(panel.locator("button, input, form, a")).to_have_count(0)
                    box, blocker_box = panel.bounding_box(), page.locator(f"#{anchor}").bounding_box()
                    assert abs(box["x"] - blocker_box["x"]) <= 1
                    assert 0 <= box["y"] - (blocker_box["y"] + blocker_box["height"]) <= 48
                    detail_box = page.locator(f".{domain}-package-summary-panel").bounding_box()
                    assert box["y"] + box["height"] <= detail_box["y"]

            page.set_viewport_size({"width": 1440, "height": 1000})
            assert_preparation_beside_own_blockers()
            for domain in ["club", "get"]:
                panel = page.locator(f".{domain}-package-panel")
                panel.screenshot(path=str(screenshots / f"fill-go-package-{domain}-desktop-FIXTURE-ONLY.png"))
                page.locator(f".{domain}-package-summary-panel").screenshot(path=str(screenshots / f"fill-go-package-summary-{domain}-desktop-FIXTURE-ONLY.png"))
                page.locator(f".{domain}-package-missing-panel").screenshot(path=str(screenshots / f"fill-go-package-missing-{domain}-desktop-FIXTURE-ONLY.png"))
                page.locator(f".{domain}-package-preparation-panel").screenshot(path=str(screenshots / f"fill-go-package-preparation-{domain}-desktop-FIXTURE-ONLY.png"))
                page.locator(f".{domain}-package-preparation-summary-panel").screenshot(path=str(screenshots / f"fill-go-package-preparation-summary-{domain}-desktop-FIXTURE-ONLY.png"))
            club_summary_box = page.locator(".club-package-summary-panel").bounding_box()
            get_summary_box = page.locator(".get-package-summary-panel").bounding_box()
            assert get_summary_box["x"] > club_summary_box["x"]
            assert club_summary_box["y"] >= page.locator("#clubUatBlockers").bounding_box()["y"]
            assert get_summary_box["y"] >= summary.bounding_box()["y"]
            page.set_viewport_size({"width": 320, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            assert_preparation_beside_own_blockers()
            for domain in ["club", "get"]:
                page.locator(f".{domain}-package-panel").evaluate("e=>e.scrollIntoView({block:'start'})")
                page.screenshot(path=str(screenshots / f"fill-go-package-{domain}-mobile-FIXTURE-ONLY.png"))
                page.locator(f".{domain}-package-summary-panel").evaluate("e=>e.scrollIntoView({block:'start'})")
                page.screenshot(path=str(screenshots / f"fill-go-package-summary-{domain}-mobile-FIXTURE-ONLY.png"))
                page.locator(f".{domain}-package-missing-panel").evaluate("e=>e.scrollIntoView({block:'start'})")
                page.screenshot(path=str(screenshots / f"fill-go-package-missing-{domain}-mobile-FIXTURE-ONLY.png"))
                page.locator(f".{domain}-package-preparation-panel").evaluate("e=>e.scrollIntoView({block:'start'})")
                page.screenshot(path=str(screenshots / f"fill-go-package-preparation-{domain}-mobile-FIXTURE-ONLY.png"))
                # Capture the complete card at the actual 320px layout; viewport
                # scroll rounding must not crop a wrapped heading or final warning.
                page.locator(f".{domain}-package-preparation-summary-panel").screenshot(path=str(screenshots / f"fill-go-package-preparation-summary-{domain}-mobile-FIXTURE-ONLY.png"))
            bad_package = copy.deepcopy(GET_PACKAGE)
            bad_package["token"] = "PRIVATE_SECRET<img>"
            inspect_package("get", bad_package)
            expect(get_result).to_contain_text("Manifest rejected")
            expect(get_result).not_to_contain_text("PRIVATE_SECRET")
            expect(get_package_summary).to_contain_text("rejected or unavailable")
            expect(get_package_summary).not_to_contain_text("15 of 15 PRESENT")
            expect(get_package_summary).not_to_contain_text("PRIVATE_SECRET")
            expect(get_missing.locator("[data-package-component]")).to_have_count(0)
            expect(get_missing).not_to_contain_text("PRIVATE_SECRET")
            expect(get_preparation.locator("[data-package-step]")).to_have_count(0)
            expect(get_preparation).to_contain_text("rejected or unavailable")
            expect(get_preparation).not_to_contain_text("PRIVATE_SECRET")
            expect(get_preparation_summary).to_contain_text("rejected or unavailable")
            expect(get_preparation_summary).not_to_contain_text("PRIVATE_SECRET")
            expect(get_preparation_summary).not_to_contain_text("Preparation notes:")
            expect(get_preparation_summary.locator("[data-package-preparation-group]")).to_have_count(0)
            assert club_preparation_summary.inner_html() == club_preparation_summary_before
            assert club_preparation.inner_html() == club_preparation_before
            assert club_missing.inner_html() == club_missing_before
            assert club_package_summary.inner_html() == club_package_snapshot
            assert club_result.inner_html() == club_package_before
            inspect_package("get", GET_PACKAGE)
            assert len(calls) == package_calls
            assert page.evaluate("localStorage.length") == 0
            assert page.evaluate("sessionStorage.length") == 1

            page.locator("#orgSelect").select_option(OTHER)
            for domain in ["club", "get"]:
                expect(page.locator(f"#{domain}PackageResult")).to_be_empty()
                assert page.locator(f"#{domain}PackageFile").input_value() == ""
                expect(page.locator(f"#{domain}PackageSummary")).not_to_contain_text("PRESENT")
                expect(page.locator(f"#{domain}PackageMissing [data-package-component]")).to_have_count(0)
                expect(page.locator(f"#{domain}PackageSteps [data-package-step]")).to_have_count(0)
                expect(page.locator(f"#{domain}PackageStepsSummary [data-package-preparation-group]")).to_have_count(0)
                expect(page.locator(f"#{domain}PackageStepsSummary")).not_to_contain_text("Preparation notes:")
            expect(page.locator("#getPackageCheck")).to_have_value("")
            expect(report).to_be_empty()
            expect(summary).to_contain_text("No local report reviewed")
            expect(summary).not_to_contain_text(SHA)
            expect(club_steps).to_contain_text(OTHER)
            expect(club_steps).not_to_contain_text(ORG)
            expect(candidate_steps.locator('[data-candidate-go]')).to_have_count(0)
            expect(candidate_steps).not_to_contain_text(SHA)
            expect(candidate_drafts.locator("details")).to_have_count(0)
            expect(candidate_drafts).not_to_contain_text(SHA)
            expect(club_draft).to_contain_text(OTHER)
            expect(club_draft).not_to_contain_text(ORG)
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
            expect(club_draft.locator("details")).to_have_count(0)
            expect(candidate_drafts.locator("details")).to_have_count(0)
            expect(page.locator("#clubPackageReview")).to_be_disabled()
            expect(page.locator("#getPackageReview")).to_be_disabled()
            for item in [club_preparation, get_preparation]:
                expect(item.locator("[data-package-step]")).to_have_count(0)
            for item in [club_preparation_summary, get_preparation_summary]:
                expect(item.locator("[data-package-preparation-group]")).to_have_count(0)
            page.locator("#orgSelect").select_option(ORG)
            expect(page.locator("#acceptanceReview")).to_be_enabled()
            select_report(PINNED)
            page.get_by_role("button", name="Today", exact=True).click()
            expect(report).to_be_empty()
            expect(summary).to_be_empty()
            expect(club_steps).to_be_empty()
            expect(candidate_steps).to_be_empty()
            expect(club_draft).to_be_empty()
            expect(candidate_drafts).to_be_empty()
            expect(club_result).to_be_empty()
            expect(get_result).to_be_empty()
            expect(club_package_summary).to_be_empty()
            expect(get_package_summary).to_be_empty()
            expect(club_missing).to_be_empty()
            expect(get_missing).to_be_empty()
            expect(club_preparation).to_be_empty()
            expect(get_preparation).to_be_empty()
            expect(club_preparation_summary).to_be_empty()
            expect(get_preparation_summary).to_be_empty()
            page.get_by_role("button", name="Provider evidence", exact=True).click()
            select_report(PINNED)
            page.get_by_role("button", name="Sign out", exact=True).click()
            expect(report).to_be_empty()
            expect(summary).to_be_empty()
            expect(club_steps).to_be_empty()
            expect(candidate_steps).to_be_empty()
            expect(club_draft).to_be_empty()
            expect(candidate_drafts).to_be_empty()
            expect(club_result).to_be_empty()
            expect(get_result).to_be_empty()
            expect(club_package_summary).to_be_empty()
            expect(get_package_summary).to_be_empty()
            expect(club_missing).to_be_empty()
            expect(get_missing).to_be_empty()
            expect(club_preparation).to_be_empty()
            expect(get_preparation).to_be_empty()
            expect(club_preparation_summary).to_be_empty()
            expect(get_preparation_summary).to_be_empty()
            expect(page.locator("#acceptanceSha")).to_have_value("")
            assert page.locator("#acceptanceFile").input_value() == ""
            assert page.evaluate("sessionStorage.length") == 0
            assert external == []
            assert all(method == "GET" for method, _ in calls + static)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
