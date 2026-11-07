# GAC-PLAY-01 — fictional event discovery

## 1 November 2026 — static package integrity candidate

The source/fictional UX baseline `e62111b6e7c34521d11fb2bb3b290f97b1d0db14` was accepted separately from release preparation. GET-STATIC-PACKAGE-01 fixes the static package's omitted event assets; it does not deploy that source, update the installed Reader or accept live event data. The final source/test SHA belongs to the existing PR5/Issue11 completion receipt.

The explicit package has 20 source files: Find HTML, 14 reviewed top-level assets (including the Leaflet license) and five pinned Leaflet PNGs. No directory-wide copying, companion, auth app, server function or environment file is included. The previous unused `federated-search.css` package entry is removed. HTML links/scripts, static module imports/re-exports and CSS references must close within that exact list. Relative parent traversal, wrong case, encoded/escaped paths, URL queries/fragments, remote dependencies, dynamic imports, inline active HTML, unsupported CSS resource escapes and extra input files fail closed. This is a constrained packaging grammar, not a general-purpose web bundler or a security audit of arbitrary JavaScript. The two default Leaflet runtime marker images are explicit reviewed roots; the pinned vendor JS/CSS is copied byte-for-byte.

`createStaticPackage` is a pure in-memory builder; `writeStaticPackage` reads regular exact-case files, rejects symlinks and creates a fresh output directory only after validation. It emits the source SHA, per-file SHA-256/byte count/dependency graph and the existing protection/CSP headers. The empty functions directory and `functions: 0` metadata describe a local artifact, not proof of a hosting configuration or live protection. Normal CI-only prepare/gate/verify and owner SHA markers are preserved; local verification never sets `GITHUB_ACTIONS` or calls deploy.

The real Chromium package test serves only generated files with their actual HTTP headers and checks all four 320/390/768/1440 viewports: module/style loading without 404, closed REAL game/tournament mode, explicit fictional opt-in, filters, one map/list projection, keyboard marker/detail/disabled handoff, empty storage and zero Reader/provider requests. OSM tiles are replaced with a blank local fixture. Optional `GAC_PACKAGE_AXE_FILE` supplies an already installed axe-core for an additional local automated audit; CI browser assertions run regardless, and the separate existing Get accessibility workflow remains mandatory. No full assistive-technology or live provider acceptance is inferred.

### Leaflet static image provenance

Official package [leaflet 1.9.4](https://registry.npmjs.org/leaflet/1.9.4), [distribution tarball](https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz), npm integrity `sha512-nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==`. The archive was verified against this SHA-512 before extracting the five `package/dist/images/` files. License is the existing `assets/leaflet-1.9.4-LICENSE.txt` (BSD-2-Clause); archive vendor JS/CSS SHA-256 matched the already pinned source bytes. No vendor code or stylesheet was modified.

| Image | SHA-256 |
| --- | --- |
| layers.png | `1dbbe9d028e292f36fcba8f8b3a28d5e8932754fc2215b9ac69e4cdecf5107c6` |
| layers-2x.png | `066daca850d8ffbef007af00b06eac0015728dee279c51f3cb6c716df7c42edf` |
| marker-icon.png | `574c3a5cca85f4114085b6841596d62f00d7c892c7b03f28cbfa301deb1dc437` |
| marker-icon-2x.png | `00179c4c1ee830d3a108412ae0d294f55776cfeb085c60129a39aa6fc4ae2528` |
| marker-shadow.png | `264f5c640339f042dd729062cfc04c17f8ea0f29882b538e3848ed8f10edb4da` |

```text
node --test getacourt/tests/private-reader-preview.test.mjs
python -m pytest getacourt/tests/test_private_event_bundle.py -v
```

---

This source slice adds three discovery intentions to the existing `find.html`: courts, games/notices, and tournaments/mini-tournaments. The existing court Reader protocol and first-party grants are unchanged. One existing Leaflet instance renders either court offers or event examples.

## Acceptance boundary

The default mode is Your sessions. Live event read/display rights are unverified, so event intentions display no real event data and make no provider request. Explore demo is an explicit opt-in. Every event card, marker and detail is labelled fictional; all event handoff buttons are focusable but `aria-disabled`, with no navigation, application, registration or payment effect. Demo source URLs use reserved `.invalid` hosts. No real event feed, provider session, roster, source grant or registration outcome is claimed.

`event-discovery.mjs` is a pure, PII-free projection. Event rows use two named demo sources; separate source-state fixtures demonstrate examples, offline and empty responses without hiding other sources. REAL mode fails closed even if an input claims verified rights. Personal-scope event fixtures require the matching opaque viewer scope; private and revoked records are not projected. Source-state fixtures admit public fictional scope only. No scope identifier or roster data is returned. Revocation and version selection precede event projection so older records cannot resurrect a withdrawn event.

## Semantics

- Identity is provider plus source event ID. Explicit tournament parent identity groups source-labelled multi-court records into one event; counts are never summed from court locks. Different providers' IDs never collide or silently merge.
- Populated games, source-proven empty 0/4 candidates and player-needed notices are distinct. Empty candidates say Start an open game. Unscheduled notices explicitly have no confirmed court/time and remain list-only when venue is unknown.
- Capacity, confirmed count and remaining places are independently nullable, source-proven and retain people/pairs/teams units. Missing counts are not derived from rosters or subtraction. Inconsistent counts become unknown.
- Entry price retains the exact person/pair/team/event unit. A court booking total is not an event entry fee. Fees included/additional/unknown and changed-price examples are explicit. Price sorting groups entry units and never converts them.
- Lifecycle, registration, eligibility, court assignment and freshness are independent. Full/cancelled/stale/closed states do not promise available places. Approval, membership and partner approval are explicit.
- Start/end/deadline use offset-bearing instants plus the declared IANA timezone. Filters use the event's local date/time; DST repeated hours preserve their distinct offsets. Unknown-time notices require the separate inclusion checkbox. Invalid ranges and reversed known notice intervals fail closed.
- One filtered event array drives cards and map groups. Unknown positions remain list-only; radius filtering excludes them only when a starting place and radius are selected. Multiple filtered events at a venue produce one count marker. Keyboard marker activation focuses the same card and opens its detail.
- Source text is rendered with `textContent`. Event-level URLs require literal exact demo origin/path/ID and reject query, userinfo, fragment, foreign origin and club/search fallback. Even a valid URL never enables a demo handoff.
- Pure activity labels distinguish detail, handoff, pending application, waitlist, user report and source-confirmed registration. A handoff has an unknown outcome and is never a sale. This slice sends no analytics or registration request.

The finite fixtures use a labelled fictional scenario clock at 08:00 UTC on the chosen day. Fresh/stale examples describe that scenario, not live freshness. There is no persistence, timer refresh, scheduler, native join/cancel, provider fetch or second map.

## Validation and acceptance mapping

| Criterion | Evidence |
| --- | --- |
| AC01 | Distinct intentions and game kinds, 0/4 and missing court/time unit/browser cases |
| AC02 | Source identity, entry unit/fees, local times/deadline and freshness in card/detail |
| AC03 | Shared filtered map/list keys, responsive 320/390/1440, keyboard detail/CTA and axe audit |
| AC04 | Source rating unchanged; approval/membership/partner states shown independently |
| AC05 | Full/cancelled/stale/closed examples; REAL event empty means unverified access, not sold out |
| AC06 | Provider ID collision and explicit tournament-parent grouping tests; pair counts stay pairs |
| AC07 | No booking-total conversion; price-change and incomplete-fee examples |
| AC08 | Literal exact event URL validation; disabled demo CTA retains source and states no outcome |
| AC09 | Distinct pure activity categories; handoff/self-report do not confirm registration or sale |
| AC10 | Private/personal/revoked scope tests; no roster/profile/session fields in projected output |
| AC11 | Out-of-order, unknown, waitlist, stale, cancelled, DST, malformed input, malicious text/URL and zero-effects tests |
| AC12 | NOT ACCEPTED here: real event rights, named live source, exact installed/hosted version and real mobile/player UAT remain separately gated |

Local and CI commands:

```text
node --test getacourt/tests/event-*.test.mjs
python -m pytest getacourt/tests/test_federated_browser.py getacourt/tests/test_court_search_browser.py -v
node getacourt/tests/browser-accessibility.mjs
```

The existing federated CI run block includes the new event contracts and syntax checks. Existing browser/a11y entry points include event states; all external/provider requests are denied, and map background tiles are fulfilled with deterministic local images. Screenshots are actual local Chromium renders of fictional data, not live provider acceptance. No deploy, protected-preview placement, new-SHA approval marker or public release is authorized by these checks.

The Get-specific federated, accessibility and offline-privacy workflows check out the exact pull-request head. Platform CI remains supplementary and may use its configured merge ref; its result is not relabelled as exact-head execution. Existing private-preview approval gates, workflow permissions and hosting configuration are unchanged.
