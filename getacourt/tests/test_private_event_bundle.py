"""Actual isolated static-package browser boot. Fictional events, no services.

Uses the exported local writer, never --prepare or fake GITHUB_ACTIONS. The
server reads only the generated bundle and enforces its actual HTTP headers.
"""
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = Path(os.environ.get("GAC_PACKAGE_ARTIFACT_DIR", str(ROOT / "test-artifacts" / "static-package")))
BLANK_TILE = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=")


@pytest.fixture(scope="module")
def packaged_url(tmp_path_factory):
    output = tmp_path_factory.mktemp("gac-static") / "bundle"
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    result = subprocess.run(["node", "--input-type=module", "-e", """
      import {writeStaticPackage} from './getacourt/qa/private-reader-preview.mjs';
      const result=await writeStaticPackage({sourceRoot:'getacourt',sourceSha:process.argv[1],output:process.argv[2]});
      console.log(JSON.stringify(result));
    """, sha, str(output)], cwd=ROOT, check=True, capture_output=True, text=True, timeout=30)
    assert json.loads(result.stdout) == {"files": 25, "functions": 0, "sourceSha": sha}
    assert list((output / "functions").iterdir()) == []
    proof = json.loads((output / "asset-integrity.json").read_text())
    assert proof["source_sha"] == sha
    assert len(proof["assets"]) == 20
    for name, row in proof["assets"].items():
        content = (output / name).read_bytes()
        assert hashlib.sha256(content).hexdigest() == row["sha256"]
        assert len(content) == row["bytes"]
    assert json.loads((output / "preview-build.json").read_text())["source_sha"] == sha
    headers = dict(line.strip().split(": ", 1) for line in (output / "_headers").read_text().splitlines()[1:])
    assert headers["Cache-Control"] == "private, no-store"
    assert "connect-src 'none'" in headers["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    allowed = set(proof["assets"]) | {"preview-build.json", "asset-integrity.json"}
    bad_requests, requests = [], []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            parsed = urlparse(self.path)
            name = unquote(parsed.path).lstrip("/")
            requests.append(name)
            if parsed.query or parsed.fragment or name not in allowed:
                bad_requests.append(self.path)
                self.send_error(404)
                return
            content = (output / name).read_bytes()
            mime = {".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript",
                    ".css": "text/css", ".png": "image/png", ".json": "application/json"}.get(Path(name).suffix, "text/plain")
            self.send_response(200)
            for key, value in headers.items():
                self.send_header(key, value)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def do_POST(self):
            bad_requests.append("POST " + self.path)
            self.send_error(405)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"url": f"http://127.0.0.1:{server.server_port}", "sha": sha, "requests": requests, "bad": bad_requests, "proof": proof}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()
        assert bad_requests == []


def parity(page):
    rows = page.evaluate("""() => ({
      list:[...document.querySelectorAll('#offers [data-event-mapped="true"]')].map(e=>e.dataset.eventKey).sort(),
      map:[...document.querySelectorAll('[data-event-keys]')].flatMap(e=>JSON.parse(e.dataset.eventKeys)).sort()
    })""")
    assert rows["list"] == rows["map"]


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_packaged_find_boot_and_fictional_events_without_missing_assets_or_service_effects(packaged_url, width):
    origin = packaged_url["url"]
    forbidden, errors, failures = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get("GAC_CHROMIUM_PATH") or shutil.which("chromium"), args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": width, "height": 950}, reduced_motion="reduce")

        def route_request(route):
            url = route.request.url
            if url.startswith(origin + "/"):
                route.continue_()
            elif route.request.resource_type == "image" and re.fullmatch(r"https://tile\.openstreetmap\.org/\d{1,2}/\d{1,7}/\d{1,7}\.png", url):
                route.fulfill(status=200, content_type="image/png", headers={"access-control-allow-origin": "*"}, body=BLANK_TILE)
            else:
                forbidden.append(url)
                route.abort()

        context.route("**/*", route_request)
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("response", lambda r: failures.append((r.status, r.url)) if r.status >= 400 else None)
        page.add_init_script("""window.bundleSourceCalls=[];
          for(const name of ['gac:auto-search-request','gac:additional-sources-request'])
            window.addEventListener(name,()=>window.bundleSourceCalls.push(name));""")
        try:
            response = page.goto(origin + "/find.html")
            assert response.headers["cache-control"] == "private, no-store"
            assert "connect-src 'none'" in response.headers["content-security-policy"]
            expect(page.locator(".leaflet-container")).to_have_count(1)
            expect(page.locator("#realMode")).to_have_attribute("aria-pressed", "true")
            page.get_by_role("button", name="Join a game", exact=True).click()
            expect(page.locator("#offers .event-card")).to_have_count(0)
            expect(page.locator("#offers")).to_contain_text("Games are not connected yet")
            page.get_by_role("button", name="Find games", exact=True).click()
            page.get_by_role("button", name="Tournaments & mini-tournaments", exact=True).click()
            expect(page.locator("#offers")).to_contain_text("Tournaments are not connected yet")
            page.get_by_role("button", name="Join a game", exact=True).click()
            page.get_by_role("button", name="Explore demo", exact=True).click()
            expect(page.locator("#offers .event-card")).to_have_count(10)
            expect(page.locator("#demoBanner")).to_be_visible()
            expect(page.locator('[data-event-kind="start_open_match"]')).to_contain_text("0 / 4 people")
            expect(page.locator('[data-event-kind="player_needed"]')).to_contain_text("Time unconfirmed")
            expect(page.locator("#sourceStatus")).to_contain_text("Offline fictional example")
            expect(page.locator("#sourceStatus")).to_contain_text("Empty fictional response")
            assert page.locator("#offers a").count() == 0
            parity(page)
            page.locator("#eventEntry").select_option("pair")
            expect(page.locator("#offers .event-card")).to_have_count(1)
            expect(page.locator("#offers")).to_contain_text("€26.00 / pair")
            parity(page)
            page.locator("#eventEntry").select_option("any")
            page.locator("#offers .event-card" if width < 768 else "#offersHeading").first.evaluate("el => el.scrollIntoView({block:'start'})")
            ARTIFACTS.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(ARTIFACTS / f"packaged-games-{width}-FICTIONAL.png"))
            axe_file = os.environ.get("GAC_PACKAGE_AXE_FILE")

            def audit(label):
                if axe_file:
                    page.evaluate(Path(axe_file).read_text(encoding="utf8"))
                    result = page.evaluate("""async () => {
                      const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});
                      return {violations:r.violations.map(v=>({id:v.id,nodes:v.nodes.length})),passes:r.passes.length};
                    }""")
                    assert result["violations"] == [], (width, label, result)

            audit("games")
            page.locator("#offers .event-cta").first.focus()
            page.keyboard.press("Enter")
            expect(page.locator("#mapSelection")).to_contain_text("No registration, application or payment was made")
            assert page.url == origin + "/find.html"
            page.get_by_role("button", name="Tournaments & mini-tournaments", exact=True).click()
            expect(page.locator("#offers .event-card")).to_have_count(3)
            expect(page.locator("#offers")).to_contain_text("4 / 8 pairs")
            expect(page.locator("#offers")).to_contain_text("€30.00 / pair")
            parity(page)
            page.locator("[data-result-pin]").first.focus()
            page.keyboard.press("Enter")
            expect(page.locator("#offers .card:focus details")).to_have_attribute("open", "")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            page.locator("#offers .event-card" if width < 768 else "#offersHeading").first.evaluate("el => el.scrollIntoView({block:'start'})")
            page.screenshot(path=str(ARTIFACTS / f"packaged-tournaments-{width}-FICTIONAL.png"))
            audit("tournaments")
            page.get_by_role("button", name="Your sessions", exact=True).click()
            expect(page.locator("#offers .event-card")).to_have_count(0)
            expect(page.locator("[data-result-pin]")).to_have_count(0)
            audit("real-empty")
            assert page.evaluate("window.bundleSourceCalls") == []
            assert page.evaluate("localStorage.length+sessionStorage.length") == 0
            assert context.request.get(origin + "/preview-build.json").json()["source_sha"] == packaged_url["sha"]
            for name in ["event-discovery.mjs", "event-discovery-view.mjs", "event-demo-fixtures.mjs", "event-discovery.css"]:
                assert "assets/" + name in packaged_url["requests"]
            for name, row in packaged_url["proof"]["assets"].items():
                if name.startswith("assets/images/"):
                    image = context.request.get(origin + "/" + name)
                    assert image.status == 200
                    assert image.headers["content-type"] == "image/png"
                    assert hashlib.sha256(image.body()).hexdigest() == row["sha256"]
            assert errors == []
            assert failures == []
            assert forbidden == []
            (ARTIFACTS / f"packaged-proof-{width}.json").write_text(json.dumps({
                "source_sha": packaged_url["sha"], "width": width, "fictional_only": True,
                "missing_assets": failures, "external_service_requests": forbidden,
                "page_errors": errors, "provider_reader_events": page.evaluate("window.bundleSourceCalls"),
                "axe_exercised": bool(axe_file), "tile_background": "local blank fixture",
                "functions": 0, "asset_hashes": packaged_url["proof"]["assets"]}, indent=2), encoding="utf8")
        finally:
            context.close()
            browser.close()
