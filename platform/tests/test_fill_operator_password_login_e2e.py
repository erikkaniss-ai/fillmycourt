"""Private Fill operator password sign-in UI against synthetic, mock API only.

No Supabase account is created; no password is sent to Netlify or Supabase.
"""
from __future__ import annotations

import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

PUBLIC = Path(__file__).resolve().parents[1] / "public"
ORG = "11111111-1111-4111-8111-111111111111"
COURT = "22222222-2222-4222-8222-222222222222"
TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2ln"

class Static(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)
    def log_message(self, *_args):
        pass

def test_operator_password_signin_then_get_only_workspace_and_logout():
    server = ThreadingHTTPServer(("127.0.0.1",0), Static)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    requests=[]
    attempts=0
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            page=browser.new_page(viewport={"width": 1200, "height":900})
            def route_handler(route):
                nonlocal attempts
                req=route.request
                url=urlparse(req.url).path
                requests.append((req.method,url))
                if url=="/api/fmc-auth/login":
                    assert req.method=="POST"
                    body=json.loads(req.post_data)
                    assert body=={"email":"operator@example.invalid","password":"synthetic-password"}
                    attempts+=1
                    if attempts==1:
                        route.fulfill(status=401,content_type="application/json",body='{"error":"INVALID_CREDENTIALS"}')
                    else:
                        route.fulfill(status=200,content_type="application/json",
                          body=json.dumps({"access_token":TOKEN,"expires_in":3600}))
                    return
                assert req.method=="GET"
                assert req.headers.get("authorization")=="Bearer "+TOKEN
                if url=="/api/me":
                    data={"user":{"email":"operator@example.invalid"}}
                elif url=="/api/fmc/organizations":
                    data={"items":[{"id":ORG,"name":"FAKE OPERATOR TEST CLUB","role":"owner"}]}
                elif url.endswith("/today"):
                    data={
                      "date":"2026-10-18","day_start":"2026-10-18T00:00:00+01:00",
                      "day_end":"2026-10-19T00:00:00+01:00",
                      "timezone":"Europe/Lisbon","currency":"EUR",
                      "summary":{"active_courts":1,"courts_with_rate_coverage":0,
                        "courts_without_rate_coverage":1,"utilization_pct":0,"revenue_minor":0,
                        "bookings":0,"empty_minutes":0},
                      "courts":[{"court_id":COURT,"court_name":"FICTIONAL COURT",
                        "has_rate_coverage":False,"capacity_minutes":0,"booked_minutes":0,
                        "held_minutes":0,"blocked_minutes":0,"empty_minutes":0,
                        "utilization_pct":0,"sellable_windows":[]}],
                      "empty_windows":[]}
                elif url.endswith("/calendar"):
                    data={"bookings":[],"holds":[],"blocks":[]}
                else:
                    raise AssertionError("Unauthorized mock API route "+url)
                route.fulfill(status=200,content_type="application/json",body=json.dumps(data))
            page.route("**/api/**",route_handler)
            page.goto(f"http://127.0.0.1:{server.server_port}/fill/",wait_until="networkidle")
            expect(page.locator("#authGate")).to_be_visible()
            expect(page.locator("#workspace")).to_be_hidden()
            page.locator("#operatorEmail").fill("operator@example.invalid")
            page.locator("#operatorPassword").fill("synthetic-password")
            page.locator("#operatorLoginButton").click()
            expect(page.locator("#operatorLoginError")).to_be_visible()
            expect(page.locator("#operatorPassword")).to_have_value("")
            page.locator("#operatorPassword").fill("synthetic-password")
            page.locator("#operatorLoginButton").click()
            expect(page.locator("#authGate")).to_be_hidden()
            expect(page.locator("#workspace")).to_be_visible()
            expect(page.locator("#identity")).to_have_text("operator@example.invalid")
            expect(page.get_by_text("FICTIONAL COURT",exact=False)).to_be_visible()
            assert page.evaluate("sessionStorage.getItem('fill.access')") == TOKEN
            assert page.evaluate("localStorage.getItem('fill.access')") is None
            page.get_by_role("button",name="Calendar").click()
            expect(page.get_by_role("heading",name="Day calendar")).to_be_visible()
            page.locator("#signOut").click()
            expect(page.locator("#authGate")).to_be_visible()
            assert page.evaluate("sessionStorage.getItem('fill.access')") is None
            assert attempts==2
            assert sum(1 for m,pth in requests if m=="POST")==2
            assert all(m=="GET" for m,pth in requests if pth!="/api/fmc-auth/login")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
