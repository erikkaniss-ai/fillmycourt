"""Build a single-file, fully offline FillMyCourt SYNTHETIC UI demo.

This build deliberately has no JWT, Supabase, server, real courts or public deploy.
It changes the *generated* application to demo-only; normal source is untouched.
"""
from __future__ import annotations

import argparse
from pathlib import Path

PLATFORM = Path(__file__).resolve().parents[1]
SRC = PLATFORM / "public" / "fill"


def exactly_once(source: str, needle: str, replacement: str) -> str:
    assert source.count(needle) == 1, "Unexpected frontend contract: " + needle[:90]
    return source.replace(needle, replacement)


def bundle(path: Path) -> None:
    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "styles.css").read_text(encoding="utf-8")
    fixture = (SRC / "demo-fixture.js").read_text(encoding="utf-8")
    app = (SRC / "app.js").read_text(encoding="utf-8")

    assert "</script" not in app.lower() and "</script" not in fixture.lower()
    assert "new URLSearchParams(location.search).get(\"demo\") === \"1\"" in app
    assert "SYNTHETIC FIXTURE" in html

    # The generated stand-alone file is deliberately locked to fixture mode.
    app = exactly_once(
        app,
        '  state.demo = canExploreDemo && new URLSearchParams(location.search).get("demo") === "1";',
        '  state.demo = true; // OFFLINE-ONLY artifact: synthetic records, never live routes'
    )
    app = exactly_once(
        app,
        '      if (state.demo) el.signOut.textContent = "Exit demo";',
        '      if (state.demo) { el.signOut.textContent = "OFFLINE DEMO"; el.signOut.disabled = true; }'
    )

    csp = ('<meta http-equiv="Content-Security-Policy" '
           'content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; '
           'style-src &#39;unsafe-inline&#39;; img-src data:; connect-src &#39;none&#39;; '
           'object-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">')
    html = exactly_once(html, '  <meta charset="utf-8">', '  <meta charset="utf-8">\n  ' + csp)
    html = exactly_once(
        html, "<title>FillMyCourt — Operator workspace</title>",
        "<title>FillMyCourt — OFFLINE SYNTHETIC DEMO</title>"
    )
    html = exactly_once(
        html, '<link rel="stylesheet" href="/fill/styles.css">',
        "<style>\n" + css + "\n</style>"
    )
    html = exactly_once(
        html, '<script src="/fill/demo-fixture.js" defer></script>',
        "<script>\n" + fixture + "\n</script>"
    )
    html = exactly_once(
        html, '<script src="/fill/app.js" defer></script>',
        "<script>\n" + app + "\n</script>"
    )
    # Offline artifact must be a self-contained HTML document.
    assert 'src="/' not in html and 'href="/fill/styles.css"' not in html
    assert "OFFLINE SYNTHETIC DEMO" in html and "SYNTHETIC FIXTURE" in html
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path,
                        default=PLATFORM / "qa-artifacts" / "FillMyCourt-OFFLINE-SYNTHETIC-DEMO.html")
    args = parser.parse_args()
    bundle(args.output)
    print("OFFLINE synthetic FillMyCourt demo bundled: " + str(args.output))
