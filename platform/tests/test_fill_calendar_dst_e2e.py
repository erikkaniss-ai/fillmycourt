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
    "2027-03-28": {
        "start": "2027-03-28T00:00:00+00:00",
        "end": "2027-03-29T00:00:00+01:00",
        # An elapsed 60-minute booking straddles the nonexistent 01:00 hour.
        "event_start": "2027-03-28T00:30:00+00:00",
        "event_end": "2027-03-28T02:30:00+01:00",
        "hours": 23,
        "cells": 46,
    },
    "2027-10-31": {
        "start": "2027-10-31T00:00:00+01:00",
        "end": "2027-11-01T00:00:00+00:00",
        # The two 01:30 instants are separated by 60 elapsed minutes.
        "event_start": "2027-10-31T01:30:00+01:00",
        "event_end": "2027-10-31T01:30:00+00:00",
        "hours": 25,
        "cells": 50,
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
                if details["hours"] == 25:
                    # Both 01:00 ticks must be distinct and carry different offsets
                    # on autumn rollbacks, independent of calendar year.
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


# These two cases use only fresh, intercepted CI Chromium contexts.
import pytest as _calendar_403_pytest
from contextlib import contextmanager as _calendar_403_contextmanager


def _calendar_403_dom_check(condition, message):
    if not condition:
        _calendar_403_pytest.fail(message, pytrace=False)


@_calendar_403_contextmanager
def _calendar_403_native_dom_context(capsys, *, viewport_width=1280, money_minor=None):
    import hashlib
    import re
    import uuid
    from datetime import date, datetime, time, timedelta, timezone
    from pathlib import Path
    from urllib.parse import parse_qs, urljoin, urlsplit

    from playwright.sync_api import sync_playwright

    check = _calendar_403_dom_check
    origin = "https://fill-dom.invalid"
    directory = Path(__file__).resolve().parents[1] / "public" / "fill"
    specifications = {
        "index.html": ("d11d4d6601dfe7eef0475845a27d6b40d39b993d", "text/html; charset=utf-8"),
        "app.js": ("37156a8f2fd3853e64ee59937396af931e8f3e71", "text/javascript; charset=utf-8"),
        "styles.css": ("981513c686c0db94e35511ef854d51c8b1efdc7c", "text/css; charset=utf-8"),
        "demo-fixture.js": ("24ca61105686a7e4130786f408371f0c3bd8f618", "text/javascript; charset=utf-8"),
    }
    assets = {}
    for name, (expected, mime) in specifications.items():
        raw = (directory / name).read_bytes()
        canonical = raw.replace(b"\r\n", b"\n")
        actual = hashlib.sha1(b"blob " + str(len(canonical)).encode() + b"\0" + canonical).hexdigest()
        check(actual == expected, "Native DOM fixture static asset pin differs.")
        assets[origin + "/fill/" + ("" if name == "index.html" else name)] = (raw, mime)

    state = {
        "mode": None, "stage": "setup", "api": [], "static": [], "calendar": 0,
        "held": [], "violations": [], "passed": False, "today": None,
        "context_closed": False, "browser_closed": False, "driver_stopped": False,
    }
    permission = "FICTIONAL NATIVE DOM PERMISSION DENIED"
    court_label = "FICTIONAL NATIVE DOM COURT"
    readouts = ("#kpis", "#courtUtilisation", "#emptyCapacity",
                "#revenueKpis", "#opportunityQueue", "#courtComparison")
    seed = uuid.uuid4().hex
    driver = browser = context = page = None
    cleanup_errors = []

    def traffic_violation(kind, route):
        state["violations"].append(kind)
        route.abort("blockedbyclient")

    def fulfilled_json(route, status, body):
        route.fulfill(status=status, content_type="application/json",
                      body=json.dumps(body), headers={"Cache-Control": "no-store"})

    def record_api(label, route):
        expected = ["me", "organizations", "today", "calendar", "calendar"]
        position = len(state["api"])
        if position >= len(expected) or label != expected[position]:
            traffic_violation("api_ledger", route)
            return False
        state["api"].append(label)
        return True

    def today_dto(requested):
        from zoneinfo import ZoneInfo

        selected = date.fromisoformat(requested)
        tz = ZoneInfo("Europe/Lisbon")
        begin = datetime.combine(selected, time.min, tzinfo=tz)
        finish = datetime.combine(selected + timedelta(days=1), time.min, tzinfo=tz)
        minutes = int((finish.astimezone(timezone.utc) - begin.astimezone(timezone.utc)).total_seconds() / 60)
        dto = {
            "date": selected.isoformat(), "day_start": begin.isoformat(), "day_end": finish.isoformat(),
            "timezone": "Europe/Lisbon", "currency": "EUR",
            "summary": {"active_courts": 1, "courts_with_rate_coverage": 1, "capacity_minutes": minutes,
                        "booked_minutes": minutes, "held_minutes": 0, "blocked_minutes": 0,
                        "empty_minutes": 0, "utilization_pct": 100, "revenue_minor": 2400,
                        "bookings": 1, "cancellations": 0},
            "courts": [{"court_id": "fictional-native-court", "court_name": court_label,
                        "has_rate_coverage": True, "capacity_minutes": minutes, "booked_minutes": minutes,
                        "held_minutes": 0, "blocked_minutes": 0, "empty_minutes": 0,
                        "utilization_pct": 100, "bookings": 1, "cancellations": 0, "revenue_minor": 2400,
                        "sellable_windows": [{"starts_at": begin.isoformat(), "ends_at": finish.isoformat(),
                                              "start_minute": 0, "end_minute": minutes}]}],
            "empty_windows": [],
        }

        if money_minor is not None:
            dto["summary"].update(revenue_minor=money_minor, booked_minutes=0,
                empty_minutes=minutes, utilization_pct=0, bookings=0,
                bookable_60_starts=1, bookable_90_starts=0,
                highest_single_quote_minor=money_minor,
                highest_single_quote_duration_minutes=60)
            dto["courts"][0].update(revenue_minor=money_minor, booked_minutes=0,
                empty_minutes=minutes, utilization_pct=0, bookings=0)
            dto["empty_windows"] = [{"court_id": dto["courts"][0]["court_id"],
                "court_name": court_label, "starts_at": begin.isoformat(),
                "ends_at": (begin + timedelta(minutes=60)).isoformat(),
                "duration_minutes": 60, "bookable_60_count": 1,
                "bookable_90_count": 0, "min_60_amount_minor": money_minor,
                "max_60_amount_minor": money_minor, "min_90_amount_minor": None,
                "max_90_amount_minor": None, "best_amount_minor": money_minor,
                "best_duration_minutes": 60, "best_starts_at": begin.isoformat(),
                "currency": "EUR"}]
        return dto

    def occupied(source):
        day = state["today"]
        return {"bookings": [{"court_id": "fictional-native-court", "status": "confirmed",
                              "starts_at": day["day_start"], "ends_at": day["day_end"], "source": source}],
                "holds": [], "blocks": []}

    def intercept(route):
        request = route.request
        if request.method != "GET":
            traffic_violation("method", route)
            return
        url = urlsplit(request.url)
        if url.scheme != "https" or url.netloc != "fill-dom.invalid":
            traffic_violation("origin", route)
            return
        if request.url in assets:
            if request.url in state["static"]:
                traffic_violation("static_repeat", route)
                return
            state["static"].append(request.url)
            raw, mime = assets[request.url]
            route.fulfill(status=200, content_type=mime, body=raw, headers={"Cache-Control": "no-store"})
            return
        query = parse_qs(url.query, keep_blank_values=True)
        if url.path == "/api/me" and not query:
            if not record_api("me", route):
                return
            fulfilled_json(route, 200, {"user": {"email": "qa@example.invalid"}})
        elif url.path == "/api/fmc/organizations" and not query:
            if not record_api("organizations", route):
                return
            fulfilled_json(route, 200, {"items": [{"id": "fictional-native-org",
                                                  "name": "FICTIONAL NATIVE DOM CLUB", "role": "support"}]})
        elif url.path == "/api/fmc/fictional-native-org/today":
            if set(query) != {"date"} or len(query["date"]) != 1 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", query["date"][0]):
                traffic_violation("today_query", route)
                return
            if not record_api("today", route):
                return
            state["today"] = today_dto(query["date"][0])
            fulfilled_json(route, 200, state["today"])
        elif url.path == "/api/fmc/fictional-native-org/calendar":
            day = state["today"]
            if not day or query != {"start": [day["day_start"]], "end": [day["day_end"]]}:
                traffic_violation("calendar_query", route)
                return
            if not record_api("calendar", route):
                return
            state["calendar"] += 1
            number = state["calendar"]
            if number > 2 or state["mode"] not in ("current403", "stale403"):
                traffic_violation("calendar_count", route)
                return
            if state["mode"] == "stale403" and number == 1:
                state["held"].append(route)
            elif number == 1 or state["mode"] == "stale403":
                fulfilled_json(route, 200, occupied("FICTIONAL NEWER NATIVE SNAPSHOT"))
            else:
                fulfilled_json(route, 403, {"error": permission})
        else:
            traffic_violation("unrecognized_favicon" if url.path == "/favicon.ico" else "path", route)

    def operation(stage, action):
        state["stage"] = stage
        try:
            return action()
        except Exception:
            _calendar_403_pytest.fail("Native DOM fictional operation failed at " + stage + ".", pytrace=False)

    def evaluate(stage, expression, argument=None):
        return operation(stage, lambda: page.evaluate(expression, argument))

    def wait_dom(stage, expression, argument=None):
        handle = operation(stage, lambda: page.wait_for_function(expression, arg=argument))
        operation(stage, handle.dispose)

    def visit(view):
        operation("navigation", lambda: page.locator(".nav-item[data-view='" + view + "']").click())

    def frame_barrier():
        evaluate("dom_completion", "() => new Promise(resolve => requestAnimationFrame(() => resolve()))")

    def session_and_identity():
        session_ok = evaluate("session_boolean",
                              "expected => sessionStorage.getItem('fill.access') === expected", seed)
        check(session_ok is True, "Native DOM fictional operator session changed.")
        check(evaluate("session_presence", "() => sessionStorage.getItem('fill.access') !== null") is True,
              "Native DOM fictional session is absent.")
        check(operation("auth_visibility", lambda: page.locator("#authGate").is_hidden()),
              "Native DOM operator auth gate changed.")
        check(operation("workspace_visibility", lambda: page.locator("#workspace").is_visible()),
              "Native DOM operator workspace changed.")

    def snapshot():
        result = {}
        for selector in (*readouts, "#calendarTimeline", "#error", "#identity"):
            raw = operation("snapshot", lambda s=selector: page.locator(s).inner_html())
            result[selector] = hashlib.sha256(raw.encode()).hexdigest()
        result["error_hidden"] = operation("snapshot", lambda: page.locator("#error").is_hidden())
        result["org"] = operation("snapshot", lambda: page.locator("#orgSelect").input_value())
        return result

    def traffic_complete():
        check(not state["violations"], "Native DOM strict request boundary was violated.")
        check(state["api"] == ["me", "organizations", "today", "calendar", "calendar"],
              "Native DOM fictional GET ledger changed.")
        check(len(state["static"]) == 4 and set(state["static"]) == set(assets),
              "Native DOM static delivery closure changed.")
        check(state["calendar"] == 2 and not state["held"], "Native DOM held request completion changed.")

    try:
        driver = operation("driver", lambda: sync_playwright().start())
        browser = operation("browser", lambda: driver.chromium.launch(headless=True))
        check(browser.browser_type.name == "chromium", "Native DOM fixture did not launch Chromium.")
        context = operation("context", lambda: browser.new_context(
            viewport={"width": viewport_width, "height": 900}, timezone_id="Europe/Lisbon", service_workers="block"))
        def guarded_intercept(route):
            try:
                intercept(route)
            except Exception:
                state["violations"].append("interceptor_error")
                try:
                    route.abort("blockedbyclient")
                except Exception:
                    state["violations"].append("abort_error")

        operation("interception", lambda: context.route("**/*", guarded_intercept))
        initialization = ("if (location.origin === " + json.dumps(origin)
                          + ") { sessionStorage.setItem('fill.access', " + json.dumps(seed) + "); }")
        operation("storage_initialization", lambda: context.add_init_script(script=initialization))
        page = operation("page", context.new_page)
        operation("timeout", lambda: page.set_default_timeout(5000))
        bundle = {
            "state": state, "page": page, "check": check, "operation": operation, "evaluate": evaluate,
            "wait_dom": wait_dom, "visit": visit, "frame": frame_barrier, "session": session_and_identity,
            "snapshot": snapshot, "traffic": traffic_complete, "permission": permission,
            "court_label": court_label, "readouts": readouts, "origin": origin, "fulfilled_json": fulfilled_json,
        }
        yield bundle
    finally:
        for route in list(state["held"]):
            try:
                route.abort("blockedbyclient")
                state["held"].remove(route)
            except Exception:
                cleanup_errors.append("held_route")
        for resource, flag, method in ((context, "context_closed", "close"),
                                       (browser, "browser_closed", "close"),
                                       (driver, "driver_stopped", "stop")):
            if resource is not None:
                try:
                    getattr(resource, method)()
                    state[flag] = True
                except Exception:
                    cleanup_errors.append(flag)
        if cleanup_errors:
            _calendar_403_pytest.fail("Native DOM fictional fixture cleanup failed.", pytrace=False)
        if state["passed"] and not state["violations"]:
            check(state["context_closed"] and state["browser_closed"] and state["driver_stopped"]
                  and not state["held"], "Native DOM fixture did not fully close.")
            with capsys.disabled():
                print(("FILL_EUR_NATIVE_LAYOUT_SYNTHETIC_PASS width=" + str(viewport_width) + " minor=" + str(money_minor) + " regions=" + str(state.get("money_checks", 0)) + " case=" if money_minor is not None else "FILL_CALENDAR_REAL_DOM_CI_PASS case=") + state["mode"]
                      + " engine=chromium native_dom=1 static=4 api=5 calendar=2 unknown=0"
                      + " held_pending=0 context_closed=1 browser_closed=1 driver_stopped=1")
        else:
            with capsys.disabled():
                print(("FILL_EUR_NATIVE_LAYOUT_SYNTHETIC_NOT_PASS width=" + str(viewport_width) + " minor=" + str(money_minor) + " regions=" + str(state.get("money_checks", 0)) + " case=" if money_minor is not None else "FILL_CALENDAR_REAL_DOM_CI_NOT_PASS case=") + (state["mode"] or "unset")
                      + " stage=" + state["stage"] + " unknown=" + str(len(state["violations"]))
                      + " boundary=" + (state["violations"][0] if state["violations"] else "none")
                      + " context_closed=" + str(int(state["context_closed"]))
                      + " browser_closed=" + str(int(state["browser_closed"]))
                      + " driver_stopped=" + str(int(state["driver_stopped"]))
                      + " held_pending=" + str(len(state["held"])))
        if state["violations"]:
            _calendar_403_pytest.fail("Native DOM strict request boundary was violated.", pytrace=False)


@_calendar_403_pytest.fixture()
def _calendar_403_native_dom(capsys):
    with _calendar_403_native_dom_context(capsys) as bundle:
        yield bundle


def _calendar_403_native_populated(bundle, mode):
    bundle["state"]["mode"] = mode
    page, check = bundle["page"], bundle["check"]
    bundle["operation"]("navigation", lambda: page.goto(bundle["origin"] + "/fill/", wait_until="domcontentloaded"))
    bundle["wait_dom"]("bootstrap",
                      "() => document.querySelector('#authGate').hidden && "
                      "!document.querySelector('#workspace').hidden && "
                      "document.querySelector('#courtComparison').textContent.includes('FICTIONAL NATIVE DOM COURT')")
    bundle["session"]()
    bundle["visit"]("today")
    check(bundle["operation"]("today_visible", lambda: page.locator("#todayView").is_visible()),
          "Native DOM Today navigation did not expose its readout.")
    check(bundle["evaluate"]("today_populated",
                            "label => document.querySelector('#courtUtilisation').textContent.includes(label)",
                            bundle["court_label"]) is True, "Native DOM Today precondition was not populated.")
    bundle["visit"]("revenue")
    check(bundle["operation"]("revenue_visible", lambda: page.locator("#revenueView").is_visible()),
          "Native DOM Revenue navigation did not expose its readout.")
    check(bundle["evaluate"]("revenue_populated",
                            "label => document.querySelector('#courtComparison').textContent.includes(label)",
                            bundle["court_label"]) is True, "Native DOM Revenue precondition was not populated.")
    return bundle["snapshot"]()


def test_calendar_current403_real_dom_evicts_cached_readouts(_calendar_403_native_dom):
    bundle = _calendar_403_native_dom
    before = _calendar_403_native_populated(bundle, "current403")
    page, check = bundle["page"], bundle["check"]
    bundle["visit"]("calendar")
    bundle["wait_dom"]("occupied_calendar", "() => document.querySelectorAll('#calendarTimeline .lane-cell.booked').length > 0")
    bundle["visit"]("calendar")
    bundle["wait_dom"]("permission",
                      "message => !document.querySelector('#error').hidden && "
                      "document.querySelector('#error').textContent.includes(message)", bundle["permission"])
    check(bundle["evaluate"]("calendar_cleared", "() => document.querySelector('#calendarTimeline').innerHTML === ''") is True,
          "Native DOM denied Calendar was not empty.")
    check(bundle["evaluate"]("no_false_free", "() => document.querySelectorAll('#calendarTimeline .lane-cell.open').length === 0") is True,
          "Native DOM denied Calendar exposed false free cells.")
    bundle["visit"]("today")
    check(bundle["operation"]("today_visible", lambda: page.locator("#todayView").is_visible()),
          "Native DOM Today navigation changed.")
    bundle["visit"]("revenue")
    check(bundle["operation"]("revenue_visible", lambda: page.locator("#revenueView").is_visible()),
          "Native DOM Revenue navigation changed.")
    check(bundle["evaluate"]("readouts_empty",
                            "ids => ids.every(id => {const node=document.querySelector(id);"
                            "return node.innerHTML === '' && node.textContent === '';})",
                            list(bundle["readouts"])) is True,
          "Native DOM current403 did not empty ordinary Today and Revenue readouts.")
    bundle["session"]()
    after = bundle["snapshot"]()
    check(after["org"] == before["org"] and after["#identity"] == before["#identity"],
          "Native DOM current403 changed operator organization or identity.")
    bundle["traffic"]()
    bundle["state"]["passed"] = True


def test_calendar_stale403_real_dom_preserves_newer_readouts(_calendar_403_native_dom):
    bundle = _calendar_403_native_dom
    _calendar_403_native_populated(bundle, "stale403")
    page, check = bundle["page"], bundle["check"]
    def request_older():
        with page.expect_request(lambda request: "/calendar?" in request.url):
            bundle["visit"]("calendar")

    def request_newer():
        with page.expect_response(lambda response: "/calendar?" in response.url and response.status == 200):
            bundle["visit"]("calendar")

    bundle["operation"]("older_request_barrier", request_older)
    bundle["operation"]("newer_response_barrier", request_newer)
    bundle["wait_dom"]("newer_calendar",
                      "() => document.querySelector('#calendarTimeline').innerHTML.includes('FICTIONAL NEWER NATIVE SNAPSHOT')")
    check(len(bundle["state"]["held"]) == 1, "Native DOM older request was not deterministically held.")
    newer = bundle["snapshot"]()
    check(newer["error_hidden"], "Native DOM newer success has an error.")
    def release_older():
        with page.expect_response(lambda response: "/calendar?" in response.url and response.status == 403) as denied:
            route = bundle["state"]["held"][0]
            bundle["fulfilled_json"](route, 403, {"error": bundle["permission"]})
            bundle["state"]["held"].remove(route)
        denied.value.finished()

    bundle["operation"]("older_finished", release_older)
    bundle["frame"]()
    check(bundle["snapshot"]() == newer, "Native DOM stale403 changed newer readouts or error state.")
    bundle["session"]()
    bundle["visit"]("today")
    check(bundle["operation"]("today_visible", lambda: page.locator("#todayView").is_visible()),
          "Native DOM stale403 changed Today visibility.")
    bundle["visit"]("revenue")
    check(bundle["operation"]("revenue_visible", lambda: page.locator("#revenueView").is_visible()),
          "Native DOM stale403 changed Revenue visibility.")
    after = bundle["snapshot"]()
    check(all(after[key] == newer[key] for key in (*bundle["readouts"], "#calendarTimeline", "#identity", "org")),
          "Native DOM stale403 purged authorized shared readouts.")
    bundle["traffic"]()
    bundle["state"]["passed"] = True


def _calendar_403_guard_negative_control(capsys, control):
    check = _calendar_403_dom_check
    configurations = {
        "unknown_get": ("GET", "/__fixture_guard__/unknown", "path"),
        "empty_post": ("POST", "/__fixture_guard__/method", "method"),
    }
    check(control in configurations, "Native DOM guard control selection is unsupported.")
    method, path, category = configurations[control]
    child = None
    evidence = None
    diagnostic = {"abort_class": "unset"}
    expected_message = "Native DOM strict request boundary was violated."
    with _calendar_403_pytest.raises(
        _calendar_403_pytest.fail.Exception,
        match=r"^Native DOM strict request boundary was violated\.$",
    ) as rejected_child:
        with _calendar_403_native_dom_context(capsys) as bundle:
            child = bundle
            # Run the complete protected positive body before the extra attempt.
            # It alone sets its original positive-completion flag.
            test_calendar_current403_real_dom_evicts_cached_readouts(bundle)
            page = bundle["page"]
            target = bundle["origin"] + path

            def attempt():
                handle = None
                try:
                    # A test-owned promise handle avoids blocking the request
                    # event timeout if rejection is broken. No window export
                    # or application state instrumentation is installed.
                    with page.expect_event(
                        "requestfailed",
                        predicate=lambda request: request.url == target and request.method == method,
                    ) as failed:
                        handle = page.evaluate_handle(
                            "configuration => ({completion: fetch(configuration.path, "
                            "{method: configuration.method}).then("
                            "() => ({fulfilled:true,rejected:false,type_error:false}), "
                            "error => ({fulfilled:false,rejected:true,type_error:error instanceof TypeError}))})",
                            {"path": path, "method": method},
                        )
                    request = failed.value
                    outcome = handle.evaluate("async box => await box.completion")
                    reason = request.failure
                    diagnostic["abort_class"] = {
                        "net::ERR_BLOCKED_BY_CLIENT": "blocked_by_client",
                        "net::ERR_BLOCKED_BY_CLIENT; Inspector": "blocked_by_client_inspector",
                        "net::ERR_BLOCKED_BY_CLIENT.Inspector": "blocked_by_client_dot_inspector",
                        "net::ERR_FAILED.Inspector": "failed_dot_inspector",
                        "net::ERR_ABORTED.Inspector": "aborted_dot_inspector",
                        "net::ERR_FAILED; Inspector": "failed_inspector",
                        "net::ERR_ABORTED; Inspector": "aborted_inspector",
                        "net::ERR_FAILED": "failed",
                        "net::ERR_ABORTED": "aborted",
                        "net::ERR_INTERNET_DISCONNECTED": "offline",
                    }.get(reason, "other")
                    return {
                        "request_aborted": reason in ("net::ERR_BLOCKED_BY_CLIENT", "net::ERR_BLOCKED_BY_CLIENT.Inspector"),
                        "same_fixture_target": request.url == target,
                        "expected_method": request.method == method,
                        "empty_payload": request.post_data in (None, ""),
                        "browser_rejected": type(outcome) is dict and outcome.get("rejected") is True,
                        "browser_not_fulfilled": type(outcome) is dict and outcome.get("fulfilled") is False,
                        "browser_type_error": type(outcome) is dict and outcome.get("type_error") is True,
                    }
                finally:
                    if handle is not None:
                        handle.dispose()

            evidence = bundle["operation"]("guard_attempt", attempt)
            # No manually assigned qualification/violation/cleanup flags here.
            # The original context's late boundary check must reject the child.

    check(child is not None and evidence is not None, "Native DOM guard attempt evidence is incomplete.")
    check(str(rejected_child.value) == expected_message, "Native DOM child failed for an unrelated reason.")
    check(set(evidence) == {"request_aborted", "same_fixture_target", "expected_method", "empty_payload",
                            "browser_rejected", "browser_not_fulfilled", "browser_type_error"},
          "Native DOM guard observation fields are incomplete.")
    with capsys.disabled():
        print("FILL_CALENDAR_REAL_DOM_GUARD_OBSERVED control=" + control
              + " abort_class=" + diagnostic["abort_class"]
              + " request_aborted=" + str(int(evidence["request_aborted"]))
              + " same_target=" + str(int(evidence["same_fixture_target"]))
              + " expected_method=" + str(int(evidence["expected_method"]))
              + " empty_payload=" + str(int(evidence["empty_payload"]))
              + " browser_rejected=" + str(int(evidence["browser_rejected"]))
              + " browser_not_fulfilled=" + str(int(evidence["browser_not_fulfilled"]))
              + " browser_type_error=" + str(int(evidence["browser_type_error"])))
    check(all(value is True for value in evidence.values()),
          "Native DOM guard did not prove an aborted empty request and rejected browser promise.")
    state = child["state"]
    check(state["violations"] == [category], "Native DOM guard rejection category was not exact.")
    check(state["passed"] is True, "Native DOM positive checks did not complete before the guard attempt.")
    check(state["api"] == ["me", "organizations", "today", "calendar", "calendar"]
          and len(state["static"]) == 4 and len(set(state["static"])) == 4 and state["calendar"] == 2,
          "Native DOM rejected attempt contaminated the allowed ledger.")
    check(not state["held"] and state["context_closed"] and state["browser_closed"] and state["driver_stopped"],
          "Native DOM expected rejection did not complete real fixture cleanup.")
    with capsys.disabled():
        print("FILL_CALENDAR_REAL_DOM_GUARD_CONTROL_PASS control=" + control
              + " proof=rejection_boundary child_qualification=not_accepted"
              + " boundary=" + category + " exact_child_failure=1 request_aborted=1 browser_rejected=1"
              + " browser_type_error=1 empty_payload=1 static=4 api=5 calendar=2 rejected=1"
              + " held_pending=0 context_closed=1 browser_closed=1 driver_stopped=1")


def test_calendar_native_dom_guard_rejects_unknown_get_after_positive(capsys):
    _calendar_403_guard_negative_control(capsys, "unknown_get")


def test_calendar_native_dom_guard_rejects_empty_post_after_positive(capsys):
    _calendar_403_guard_negative_control(capsys, "empty_post")



def _eur_native_money_readable(bundle, capsys, width, minor, region, selector, expected):
    """Read actual text range geometry after native scrolling; never alter DOM."""
    check, operation, page = bundle["check"], bundle["operation"], bundle["page"]
    target = page.locator(selector).filter(has_text=expected)
    stage = "eur_money_" + region
    matched = operation(stage + "_count", target.count)
    if matched != 1:
        with capsys.disabled():
            print("FILL_EUR_NATIVE_LOOKUP_NOT_PASS synthetic_only=1 width=" + str(width)
                  + " minor=" + str(minor) + " region=" + region + " matched=" + str(matched))
    check(matched == 1,
          "Synthetic EUR money region did not contain one expected amount.")
    operation(stage + "_scroll", target.scroll_into_view_if_needed)
    bundle["frame"]()
    metrics = operation(stage + "_measure", lambda: target.evaluate(r"""(el, expected) => {
      const tolerance = 0.75;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const matches = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const offset = node.textContent.indexOf(expected);
        if (offset < 0 || /[0-9.,]/.test(node.textContent[offset + expected.length] || '')) continue;
        const range = document.createRange();
        range.setStart(node, offset); range.setEnd(node, offset + expected.length);
        matches.push(range);
      }
      const result = {exact_text: matches.length === 1, ranges: 0,
        viewport: true, clip: '', ellipsis: false, occluded: false, shown: true};
      if (matches.length !== 1) return result;
      const rects = Array.from(matches[0].getClientRects()).filter(r => r.width > 0 && r.height > 0);
      result.ranges = rects.length;
      const selector = a => a.id ? '#' + a.id : a.tagName.toLowerCase() +
        (a.classList.length ? '.' + Array.from(a.classList).join('.') : '');
      const inside = (r, box, x, y) => (!x || (r.left >= box.left - tolerance && r.right <= box.right + tolerance)) &&
        (!y || (r.top >= box.top - tolerance && r.bottom <= box.bottom + tolerance));
      for (const r of rects) {
        if (!inside(r, {left: 0, top: 0, right: innerWidth, bottom: innerHeight}, true, true)) result.viewport = false;
        for (let a = el; a; a = a.parentElement) {
          const style = getComputedStyle(a), bounds = a.getBoundingClientRect();
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) result.shown = false;
          const x = a === el || ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX);
          const y = a === el || ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY);
          const box = a === el ? bounds : {left: bounds.left + a.clientLeft, top: bounds.top + a.clientTop,
            right: bounds.left + a.clientLeft + a.clientWidth, bottom: bounds.top + a.clientTop + a.clientHeight};
          if (!inside(r, box, x, y) && !result.clip) result.clip = selector(a);
          if (style.textOverflow === 'ellipsis' && style.overflowX !== 'visible' && a.scrollWidth > a.clientWidth + tolerance) result.ellipsis = true;
        }
        for (const x of [r.left + Math.min(1, r.width / 4), r.left + r.width / 2, r.right - Math.min(1, r.width / 4)]) {
          const hit = document.elementFromPoint(x, r.top + r.height / 2);
          if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) result.occluded = true;
        }
      }
      return result;
    }""", expected))
    passed = (metrics["exact_text"] and metrics["ranges"] > 0 and metrics["viewport"]
              and not metrics["clip"] and not metrics["ellipsis"]
              and not metrics["occluded"] and metrics["shown"])
    with capsys.disabled():
        if passed:
            print("FILL_EUR_NATIVE_MONEY_REGION_PASS synthetic_only=1 width=" + str(width)
                  + " minor=" + str(minor) + " region=" + region
                  + " exact_text=1 unclipped=1 no_ellipsis=1 unobscured=1")
        else:
            print("FILL_EUR_NATIVE_MONEY_REGION_FINDING synthetic_only=1 width=" + str(width)
                  + " minor=" + str(minor) + " region=" + region
                  + " exact_text=" + str(int(metrics["exact_text"]))
                  + " viewport=" + str(int(metrics["viewport"]))
                  + " clip=" + (metrics["clip"] or "none")
                  + " ellipsis=" + str(int(metrics["ellipsis"]))
                  + " occluded=" + str(int(metrics["occluded"])))
    check(passed, "Synthetic EUR amount failed real text-range readability.")
    bundle["state"]["money_checks"] = bundle["state"].get("money_checks", 0) + 1


@_calendar_403_pytest.mark.parametrize("width", [320, 390, 1440])
@_calendar_403_pytest.mark.parametrize("minor,expected", [
    (0, "\u20ac0.00"), (1, "\u20ac0.01"), (99, "\u20ac0.99"),
    (100, "\u20ac1.00"), (12345, "\u20ac123.45")])
def test_eur_money_native_layout_synthetic_matrix(capsys, width, minor, expected):
    with _calendar_403_native_dom_context(capsys, viewport_width=width, money_minor=minor) as bundle:
        _calendar_403_native_populated(bundle, "current403")
        bundle["visit"]("today")
        bundle["frame"]()
        _eur_native_money_readable(bundle, capsys, width, minor, "today_revenue",
                                   "#kpis .kpi strong", expected)
        bundle["visit"]("revenue")
        bundle["frame"]()
        for region, selector in [
            ("recovery_highest_quote", "#revenueKpis .kpi strong"),
            ("opportunity_best_quote", "#opportunityQueue .opportunity-metrics b"),
            ("comparison_revenue", "#courtComparison .comparison-row:not(.comparison-head) > span:nth-of-type(2)"),
            ("comparison_best_quote", "#courtComparison .comparison-row:not(.comparison-head) > span:last-of-type")]:
            _eur_native_money_readable(bundle, capsys, width, minor, region, selector, expected)
        bundle["visit"]("calendar")
        bundle["wait_dom"]("occupied_calendar", "() => document.querySelectorAll('#calendarTimeline .lane-cell.booked').length > 0")
        bundle["visit"]("calendar")
        bundle["wait_dom"]("permission",
                          "message => !document.querySelector('#error').hidden && "
                          "document.querySelector('#error').textContent.includes(message)", bundle["permission"])
        bundle["session"]()
        bundle["traffic"]()
        bundle["check"](bundle["state"]["money_checks"] == 5,
                        "Synthetic EUR money qualification matrix was incomplete.")
        bundle["state"]["passed"] = True
