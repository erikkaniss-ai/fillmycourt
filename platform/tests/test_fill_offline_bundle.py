"""Verify the standalone offline bundle using real Chromium with network denied."""
from __future__ import annotations
from pathlib import Path
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright


def test_offline_fill_synthetic_html_all_views(tmp_path):
    path=tmp_path / "FillMyCourt-OFFLINE-SYNTHETIC-DEMO.html"
    script=Path(__file__).resolve().parents[1] / "scripts" / "build_fill_synthetic_demo.py"
    subprocess.run([sys.executable,str(script),"--output",str(path)],check=True)
    text=path.read_text(encoding="utf-8")
    assert 'src="/fill/' not in text and 'href="/fill/styles.css"' not in text
    assert "connect-src &#39;none&#39;" in text
    network=[]
    with sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page(viewport={"width":1280,"height":860})
        page.on("request", lambda req: network.append(req.url) if req.url.startswith(("https:","http:")) else None)
        page.goto(path.as_uri(),wait_until="load")
        expect(page.locator("#demoNotice")).to_be_visible()
        expect(page.locator("#authGate")).to_be_hidden()
        expect(page.locator("#workspace")).to_be_visible()
        assert page.evaluate("document.querySelector('#orgSelect').getBoundingClientRect().right <= document.querySelector('.sidebar').getBoundingClientRect().right")
        expect(page.get_by_text("DEMO Indoor Court A").first).to_be_visible()
        expect(page.locator("#identity")).to_contain_text("SYNTHETIC DEMO")
        page.get_by_role("button",name="Revenue & Capacity").click()
        expect(page.get_by_role("heading",name="Recovery candidates")).to_be_visible()
        page.get_by_role("button",name="Calendar").click()
        expect(page.locator(".lane-cell.booked").first).to_be_visible()
        expect(page.locator(".lane-cell.blocked").first).to_be_visible()
        uncovered = page.locator(".court-lane").filter(has_text="DEMO Court C — needs price")
        expect(uncovered.locator(".lane-cell.booked").first).to_be_visible()
        assert page.locator(".court-lane").filter(has_text="DEMO Indoor Court A").locator(".lane-cell.booked").count() == 6
        page.set_viewport_size({"width":390,"height":844})
        expect(page.locator(".calendar-swipe-hint")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        assert page.evaluate("localStorage.getItem('fill.access') === null")
        assert network == []
        browser.close()
