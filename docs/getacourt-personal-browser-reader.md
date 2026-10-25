# GetACourt personal Playtomic reader v0.2.2

This is a browser-local, explicitly requested search of one personally approved
Playtomic club. It is not a provider API integration or an unattended supply
feed. No booking, hold, payment, provider credential, token, cookie or private
endpoint is used. No deployment is needed.

## Connect without copying codes

1. Existing owners reload the unpacked `getacourt/browser-companion` extension
   once for v0.2.2. New owners review and load that same folder in Chrome/Edge.
   Permissions remain only `activeTab`, `scripting` and `storage`.
2. Sign into Playtomic personally in that browser profile and open the intended
   official `https://playtomic.com/clubs/<slug>` page.
3. Click the GetACourt extension icon, then **Connect and open GetACourt**.
   The packaged reader opens itself. There is no extension ID, pairing code,
   localhost server or third-party password to enter.
4. Choose one day (today through the next 14 days), Padel/Tennis, start-time
   range and optional 60/90/120-minute duration. Press **Search this club**.
5. **Disconnect and clear**, in either reader or popup, withdraws the club
   association, clears the current results and cancels the current search.
   It does not log the owner out of Playtomic or remove the extension.

The club preference alone persists in extension local storage. The approved
tab and attempt budget are browser-session state. Reopening the reader or
restarting its service worker needs no codes and creates no new grant.
After browser restart, tab closure/navigation or lost activeTab access, renew
the grant from the intended club's icon. Permanent provider login, cross-device
access and unattended background reading are not promised.

The normal GetACourt profile's `personal-sources.html` link is now installation
guidance. That website cannot read the extension. The v0.1 localhost bridge,
ID/code inputs, external messaging listener and `externally_connectable`
manifest entry have been removed.

## Why removing the code does not weaken receiver authentication

Search runs in a packaged `chrome-extension://<installed-id>/reader.html`
page. The service worker accepts only the exact own-extension reader/popup
sender URLs and own runtime ID; the reader cannot grant source-tab consent.
Websites, localhost processes, other extensions, frames and altered paths are
rejected. No web-accessible resources are declared. The extension CSP permits
only packaged scripts/styles, no network connections, objects or frames.

This replaces the previous manual pairing secret with the browser's extension
origin boundary. It does not replace authentication with a public extension
ID or a localhost pathname. No capability is placed in a URL, clipboard,
persistent web storage, chat or analytics.

## What Search does

One explicit click inspects one approved club and one selected date. If needed
it moves only the approved club tab into a separate compact browser window
(480 pixels wide); the reader explains this before Search. Other tabs/windows
are not enumerated, resized or closed. The compact window exposes the English
mobile court/time accordion that was verified in the earlier live reader.

The injected code changes only the normal visible date/sport controls using
their input/change events and opens native court/time details. It never clicks
a button, submits a form or enters checkout. The provider's own UI may make its
normal filter requests; there is no direct provider HTTP client, network
inspection, cookie replay, hydration-state access or hidden-API use.

Search inspects at most 3 courts and expands at most 2 eligible start times per
court (6 total). It shares up to 20 matching explicit priced offers. Date,
sport, time and duration must match the request. The collector reads only
rendered, visible Book offer rows containing a court, start/end, duration and
EUR price. It does not activate Book. Hidden or uninspected offers are not
inventory, and an empty/unsupported subset is not proof that no courts are free.

At least 60 seconds separates attempts in the browser session, including failed
attempts after source-tab validation. Reconnect/disconnect cannot reset that
budget. Only one search runs at a time. There is no scheduler, automatic retry,
refresh loop, multi-venue crawl or automatic date iteration. Waiting for DOM
updates is bounded and does not issue provider requests.

Sign-in/security-check UI, unsupported language/layout, ambiguous controls,
loading timeouts, changed source tab, malformed offers and lost access stop
the search. The owner personally handles OAuth, MFA and CAPTCHA; nothing
bypasses them. Fixed failure codes replace raw browser/provider exceptions.

Revocation increments the worker generation immediately and serializes consent
writes so a late approval cannot undo a later withdrawal. It asks the injected
search to stop at its next checkpoint; already-started provider UI requests
cannot be undone. The worker unconditionally rejects a late withdrawn result,
even if cancellation delivery is delayed.

## Provenance, display and limits

The independent strict validator is bundled as `observation.js`; a contract
test requires exact equality with `assets/personal-source-observation.js`.
Results identify `user_ui_observation`, the clean club URL without account
queries, selected date/sport, capture UTC time and explicit offers. Coverage
remains `expanded_offers_only`; timezone and provider freshness remain UNKNOWN.
A stable DOM is not proof of a fresh provider response.

The reader renders text only and sorts the inspected offers by start time and
price. Results exist only in that reader page, expire after 60 seconds, and
clear when filters change, the page exits or access is withdrawn. They are
not uploaded, persisted, inserted into Core/main inventory, booked or paid.

## Browser-local comparison handoff

v0.2.2 adds an optional no-clipboard handoff for a current observation. After
an explicit successful Reader search, the user clicks **Open GetACourt
comparison**. The extension keeps only the already validated observation in
`chrome.storage.session` for its existing 60-second lifetime and opens exactly
`https://getacourt.com/search-all.html`, with no observation, identifier or
capability in the URL.

The receiving page first requires the user to complete the same Get search and
click **Receive prepared Reader offers**. The user must then click the
extension icon in that exact GetACourt tab and explicitly choose **Deliver
prepared Reader offers here**. `activeTab` grants a one-tab injection only for
that browser action; the extension has no host permission, web-accessible
resource or `externally_connectable` receiver. The tiny injected script can
deliver only the strict sanitized observation to the page's pending one-time
request. It has no network, provider, cookie, clipboard or persistent-storage
access. Delivery consumes the session copy; disconnect also clears it.

This is a browser-local convenience path, not a provider API bridge. The Get
page still validates the same date, sport, range, duration, strict field set
and 60-second capture bound before displaying a partial, non-bookable card.
Clipboard/manual paste remains an optional fallback. Until the matching Get
page source is protected-hosted, this path is source-only and must not be
presented as deployed acceptance.

TiePlayer, Racket ID and Smashpro are not connected in this companion.
Licensed API delegation, redistribution rights, Portugal-wide coverage,
production activation and deployment remain separate scopes requiring their
own evidence/authorization.

## Verification

- Node contracts cover exact packaged senders, no external bridge, no-code
  reopen, session/preference separation, query limits, source changes, fixed
  errors, global cooldown, revoke/approval races, late results and strict schema.
- `personal-reader-browser.mjs` tests native date/sport controls, bounded real
  DOM expansion and mid-update cancellation on fictional provider HTML.
  The fixture URL is fulfilled entirely in-process; no live provider traffic.
- Responsive reader fixtures at 390/1440 pixels verify text-only rendering,
  no code inputs, expiry, no automatic search, no web storage and late-result
  rejection after disconnect.
- Mandatory pinned Chromium CI additionally loads the actual MV3 package in
  a fresh temporary profile and verifies its native own-page messaging and
  refusal to approve a non-provider tab. Branded Chrome cannot run this
  side-loading smoke test; the optional local Chrome fixture run does not
  claim native extension installation proof.

The earlier v0.1.1 real owner session demonstrated one explicit offer transfer,
60-second expiry, changed-tab rejection and disconnect. It does not establish
v0.2.0's automatic filtering/window behavior. After source CI, v0.2.2 needs the
owner's one-time extension reload and a fresh no-code Search/Disconnect check
in their own signed-in browser. Record actual results separately; never
substitute these fictional tests for live acceptance.

## 25 October 2026 — observed public Playtomic grid variant, price popup and strictly bounded Reader support

**Observed real public UI (source route, NOT CI fixture):** https://playtomic.com/clubs/cascais-padel-club?date=2026-10-26 , Cascais Padel & Nature, Monday 26 Oct 2026, padel, court NATUREZA, displayed 6:30 AM start, 1 hr 30 min, EUR36.00, UI action `Continue - €36.00`. Read-only single-club public-browser test clicked one visibly white available court cell to DISCLOSE the price, not Continue; no sign-in, booking, hold or payment took place. Visible anchored overlay is `div` with `ui-stroke-neutral-default absolute z-50`; court shown in `div.font-bold`, displayed start in `div.text-xs`, selected `bg-secondary-energy-50` row's two `div.text-sm` for duration/price; Continue is a button and MUST NEVER be clicked. The grid cell is a white `div[type=button]` with `absolute z-0 h-11 cursor-pointer bg-white` token classes, not nested `details/summary`. Separate observations found the requested 17:00–22:00 window unavailable in the inspected NATUREZA grid; this is not a guarantee that all other clubs or dates are sold out. Provider freshness and actual customer-facing price at later request time remain unknown.

**Updated existing Reader source in Draft PR5, no deploy:** `browser-companion/capture.js` supports both original verified nested-details Book disclosure and the latest anchored visible grid popup. The new path accepts only a **currently visible popup** with the actual NATUREZA/court name, strict 12-hour time label, selected duration, explicit total EUR price, and a visible `Continue` button whose amount exactly matches the displayed total, but which the Reader NEVER activates. Its read-only parser calculates an end *label* from start plus duration but does not infer UTC or provider guarantees. Unknown duration/price, mismatched Continue amount, unverified data, missing panel or malformed time fail closed and return no offer. `browser-companion/search.js` keeps 1-club/1-day/limited court attempts, visible date/sport controls, 60-second budget, stop on MFA/CAPTCHA/timeout, only attempts bounded explicitly white `div[type=button]` schedule disclosures and uses `Close` only to dismiss; never triggers Continue/Book/checkout, holds or payments. This remains partial sampling rather than provider inventory completeness.

**Tests:** `getacourt/tests/personal-playtomic-reader.test.mjs` preserves all credential/transport/revocation restrictions, updates the prohibition to specifically bar Book/Continue/Pay control activation while permitting only strictly guarded white grid disclosure and named Close. `getacourt/tests/personal-reader-browser.mjs` has a fully synthetic actual Chromium grid + anchored popup test: court NATUREZA, 06:30–08:00, 90 min, EUR36.00 parsed, checkout click count 0, and conflicting Continue EUR amount rejected. Existing nested-details browser regression is retained. The real public UI read confirmed this layout; exact new Reader code still needs owner-installed Chrome extension reload and acceptance, so CI and a separate web observation are NOT end-to-end browser execution of this new build.

**TieSports discovery:** OPA OEIRAS and Padel Factory show public court calendars, but the inspected UI did not yield confirmed price-qualified available offers. OPA online booking is app-only via TiePlayer. Padel Factory grid uses `rct-item` reserved statuses; loading could not be independently ruled out when evaluating empty cells, so never infer open slots by subtracting reservations. Padel Factory is included in the reviewed club directory only, not an active availability/price adapter. This provider's partial UI status does not block Get's independently available Core or Playtomic personal Reader path.

**Remaining product gate:** the requested cross-provider automatically fresh Get search is not complete. Actual owner-installed Reader v0.3 grid parser must be tested with live Playtomic normal UI, including query date/sport and price label, cancellation/revoke, and failure handling; protected hosted `search-all` source has not been deployed; TiePlayer/Racket ID/Smashpro/internal APIs have no verified priced availability integration. No production/main merge, provider contract, paid request, new account, booking or payment was authorized by this source work.
