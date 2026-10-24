# GetACourt personal Playtomic reader v0.2.0

This is a browser-local, explicitly requested search of one personally approved
Playtomic club. It is not a provider API integration or an unattended supply
feed. No booking, hold, payment, provider credential, token, cookie or private
endpoint is used. No deployment is needed.

## Connect without copying codes

1. Existing owners reload the unpacked `getacourt/browser-companion` extension
   once for v0.2.0. New owners review and load that same folder in Chrome/Edge.
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
v0.2.0's automatic filtering/window behavior. After source CI, v0.2.0 needs the
owner's one-time extension reload and a fresh no-code Search/Disconnect check
in their own signed-in browser. Record actual results separately; never
substitute these fictional tests for live acceptance.
