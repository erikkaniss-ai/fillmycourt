# GET-CTO-03 — consumer UI feasibility

Observed 2026-10-30 03:47–03:50 UTC (Europe/Lisbon: same time).
Reviewed source: `a17183088ce689eeaa17bc55588110a73cd467ea`, existing Draft PR #5.
Lease for this slice: this document only. Decisions #105/#106 apply.

## Method and limits

Chrome extension browser control successfully identified the ordinary browser and opened three named official consumer pages. The prior Windows URL-identification blocker did not recur through this available channel. Inspected rendered accessibility trees, then visible headings/date controls and the rendered iframe element. No provider API, hidden state, credentials, cookies, session inspection, authentication, account creation, booking-cell click, hold, payment, outreach or deploy. No network-write audit was performed; zero write actions were initiated by the executor. Site-internal page-load traffic was not inspected.

No real player offer was accepted. A visible court grid alone does not establish availability, total price or authenticated access. This is a bounded feasibility result, not evidence that an entire provider is unavailable.

## Supported / unavailable / unknown matrix

| Named official page | Consumer UI reachable | Complete court offer in EUR | Current Get reader | Next evidence needed |
|---|---|---|---|---|
| [MATCHi Sotra Padel](https://www.matchi.se/facilities/sotrapadel?lang=en) | SUPPORTED public facility page and dated Padel (Indoors) schedule; Friday 30 October, week 44, seven named court rows | UNKNOWN: court grid links point to `/login/auth`; no explicit court EUR total. Public activities and value cards use NOK and are not court offers | UNAVAILABLE for this observed layout: heading gate fails; zero visible native date inputs | Personal initial login when required, then a provider-specific date/sport/price observation on an eligible EUR venue; no currency conversion or activity substitution |
| [Smashpro Fly Padel](https://smashpro.pt/pt/c/fly-padel) | SUPPORTED consumer club page; after hydration a main-document court grid appears, with sport combobox, Hoje date button and five named courts | UNKNOWN: inspected grid exposes no explicit total EUR price or duration on an offer; booking cells were not clicked | UNAVAILABLE for this observed layout: heading gate fails; zero visible native date inputs | Inspect normal date/sport controls and a safe offer-detail boundary that does not create a hold; prove explicit full EUR total and date/court/duration before implementing the observation |
| [Smashpro Spot Padel Club](https://smashpro.pt/pt/c/spot-padel-club) | SUPPORTED directory page, explicitly unclaimed, with Reservar por WhatsApp | UNAVAILABLE on this inspected page; no priced court grid | SOURCE_UNCLAIMED is the appropriate fail-closed outcome | Exclude this directory page from available offers; no WhatsApp contact or invented slots |

## Observations that correct earlier assumptions

- MATCHi renders its schedule directly on `/facilities/sotrapadel`; the separate `/facility/booking/index` contact link is not evidence that the current allowlist must be widened. No navigation to that link was necessary. The inspected schedule has court names such as Pizzabakeren (Bane 1), Bane 2 and Bane 7 - Singelbanen. Slot links expose the login boundary; none was activated.
- Smashpro Fly Padel's schedule appears after hydration in the main document. Courts include Campo AQS SEGUROS, Campo ASD, Campo LOCKED IN ESCAPE ROOM FEIRA, Campo PROZIS and Campo SOLVERDE. The page's single iframe is Google Maps, with an address title; it is not the booking surface. No `allFrames` or additional origin grant is justified by this observation.
- Get's initial provider login plus provider-specific revocable grant remains a one-time onboarding step; normal repeat operation is Get Find. This receipt does not ask the player for repeated Reader gestures or start owner manual UAT before the credible bundle gate.

## Reproducible Get source gap

`getacourt/browser-companion/visible-provider-page.js` first requires a visible `h2,h3,[role=heading]` whose text matches its fixed booking-section expression, and subsequently one visible native `input[type=date]` and native sport `select` in that region.

The rendered MATCHi headings were Sotra Padel, Applications, Activities, About Sotra Padel, Court details, Hours of operation and Contact information. Fly Padel headings were Fly Padel, Sobre Fly Padel, Comodidades, Horário de funcionamento, Campos por região and footer headings. Neither page has a matching booking heading; both have zero visible native date inputs. Source inspection therefore predicts `OFFER_SECTION_MISSING` before any offer collection. The packaged extension was not injected during this research; this is a source-to-rendered-DOM comparison, not a live extension execution receipt.

## Next bounded task

Implement no speculative broad parser changes from this research alone. First inspect Fly Padel's normal date/sport controls without touching a reserving action, determine whether a non-reserving offer preview exposes the required total, then implement a provider-specific adapter only for that proven UI. If the explicit price requires authentication or a booking/hold boundary, record that boundary and stop. Retain the existing route, consent, freshness and session-isolation guards. P0 acceptance still requires two real independently sourced player-session court offers. `PUBLIC_GO=false`.

## GET-CTO-04 — ordinary date/sport controls and preview boundary

Observed 2026-10-30 approximately 03:53–03:55 UTC / Europe-Lisbon.
Baseline verified on GitHub and clean local branch: `6b35ac7eed09a02b396fb51c991ee8b0a303072f`.
Only this document is changed; no parser, permission, origin or frame change.

### Reproduction through normal UI

1. Open the canonical Fly Padel page and allow its ordinary schedule to finish loading.
2. Open the schedule sport combobox, which offers Todos desportos and Padel (5); choose Padel (5). The five named court rows remain visible.
3. Open the schedule Hoje date popover. Its calendar shows outubro 2026, selected 30 and enabled 31; older dates are disabled.
4. Select 31 and dismiss the date popover. The schedule briefly displays A procurar disponibilidade..., then renders the next day's court grid. The date control reads Amanhã; the browser URL becomes `https://smashpro.pt/pt/c/fly-padel?date=2026-10-31`. Grid hour labels change to 09–18. These labels describe the schedule, not a complete offer.
5. Inspect visible button text and accessibility labels without activating any grid cell. The court-cell buttons have empty text and no aria-label/title that identifies a non-reserving preview. No explicit EUR/€ price appears in the visible main-document text. Screenshot inspection confirms the date/sport selections and court rows, without a priced offer panel.

### Required-field receipt

| Field | Evidence / state |
|---|---|
| Provider / club | Smashpro / Fly Padel, official canonical club route |
| Selected date | VERIFIED 2026-10-31 via normal calendar and resulting URL |
| Selected sport | VERIFIED Padel (5), schedule combobox |
| Court names | VERIFIED five labelled rows; no individual row is promoted to an available offer |
| Offer start/end and duration | UNKNOWN: axis hours are not bound to an explicit priced offer; header search default 1h 30m is not a court-offer duration |
| Full EUR total | MISSING in inspected visible schedule; no currency or price invented |
| Freshness / provenance | Live ordinary consumer UI observation at the time above; provider source freshness unknown; no offer accepted |
| Official handoff | Canonical club page identified; no individual offer handoff proven |
| Safe non-reserving preview | NOT PROVEN: unnamed grid buttons do not establish their side effect; no grid button clicked |
| Authentication / writes | No login, account/session inspection, booking cell, hold, checkout, payment or contact action; ordinary filters only. Internal provider traffic was not audited |

### Additional concrete compatibility finding

The official date filter adds `?date=2026-10-31`. Both `additionalProviderRoute()` in `background.js` and the initial URL guard in `visible-provider-page.js` reject every Smashpro query parameter. Thus the observed filtered URL cannot be approved as an additional source, and a page whose own date control changes this URL fails a fresh reader invocation with `CLUB_PAGE_REQUIRED`. Together with the earlier heading/native-control gaps, this is a reproducible source compatibility issue. It is not permission to broadly allow query strings or alter canonical observation provenance.

### Stop condition and safe next step

GET-CTO-04 stops before an action whose booking/hold effect is unknown. No demonstrably non-reserving preview was exposed by the inspected controls. A future adapter needs first-party visible evidence that a specific details control is read-only and yields explicit date, court, start/end, duration and full EUR total; it must still stop at authentication/hold/checkout. Otherwise keep this source UNAVAILABLE for priced offers and assess another independently accessible consumer UI within the existing Get lane. No speculative parser implementation or API fallback follows from this receipt. `PUBLIC_GO=false`.

## Next-provider continuation — TieSports and Racket ID

Observed 30 October 2026, approximately 04:18–04:23 UTC / Europe-Lisbon.
Baseline verified: `3c1cd959ead5d7feaf6b6c76340fba1d3be58084`, existing Draft PR #5, clean checkout. Only this document changes.

Chrome's prior extension browser was unavailable and absent from current browser inventory. Opening installed Chrome did not restore its extension connection. These observations therefore used the ordinary public consumer UI in the in-app browser; they do not attest the owner's personal provider session or an installed Reader handoff. This was connection recovery, not a security-denial bypass. No cookies, credentials, hidden state, provider API or account creation.

### TieSports / TiePlayer — OPA OEIRAS

Official page: https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy

- The booking section explicitly states that online booking for this club is available only in TiePlayer app, with official App Store and Google Play links, and offers a public availability view below it.
- Opened Filter by sport and selected Padel. Opened the normal calendar and selected Saturday 31 October 2026; reopening it confirmed 31 as selected. No timetable cell was selected.
- Named courts are rendered, including SAVILLS (Court nº1) OUTDOOR, BEEFEATER LIGHT (Court nº2) OUTDOOR and CONSILCAR (Court Central). The page exposes a timetable and Available/Unavailable legend, but no complete court/time/duration/total-EUR offer in the inspected view.
- Result: public timetable SUPPORTED; complete web-bookable EUR offer UNAVAILABLE on this inspected surface; TiePlayer app session and prices UNKNOWN. No app installation or alternate API attempted. The app-only notice must not be transformed into a generic successful connector or a sold-out result.

### Racket ID — Carcavelos Tenis & Padel

Official portal: https://racket.id/booking

- Initial accessibility state was empty although the screenshot showed the normal player booking UI. After a normal club-card interaction the page exposed an accessibility tree and title Booking. No empty first snapshot is sufficient to conclude that this provider is inaccessible.
- Opened the named Carcavelos Tenis & Padel club card and selected SAT 31 OCT in the ordinary date strip. The screenshot shows 31 highlighted. The default Only roofed filter remained set; this is partial coverage. No claim of all-court availability.
- The expanded card shows time tiles (including 08:00, 08:30, 10:00 and later times) with coloured dots. No individual court identity, duration or full EUR total is shown on those tiles. Colours are not accepted as priced offers, and no time tile was activated because its booking/hold semantics were not established.
- Result: public player portal and named-club/time search SUPPORTED; complete priced offer and personal login UNKNOWN. This provider is a more concrete next web candidate than the OPA app-only booking page, but it is not yet connected live supply.
- Source compatibility remains unproven: the current generic reader expects a matching booking heading, native date input and native sport select; this portal renders custom date/time/club controls. Its recognition as `racket_id` in a fictional test is not actual UI adaptation or real Get receipt.

### Outcome and next bounded action

Two additional providers were inspected; zero complete available offers were imported into Get. The target of two real player-session platforms remains NOT MET. No selection, filter, colour or directory entry is counted as acceptance.

Main blocker: no proven read-only transition from Racket ID time search to a complete court/duration/EUR offer. The focused first-party help search returned product descriptions rather than an operational no-hold preview contract (https://racket.id/). Next: verify that specific ordinary UI transition through visible provider instructions, or use the owner's normal initial login when the provider requires it; stop before an action that creates a hold/booking. Implement no speculative adapter from colour/time tiles. TiePlayer requires an ordinary supported app session; no API or club feed substitutes for it.

Executor actions were page navigation, club-card expansion, date/sport filters, scrolling and visible UI inspection only. No provider booking/time cell, authentication, hold, checkout, payment, outreach, deployment or merge. Provider-internal traffic was not inspected. `PUBLIC_GO=false`.

## Racket ID priced preview and real local Get handoff — superseding the earlier missing-detail result

On the owner's explicit follow-up, the ordinary club/time search was continued. Baseline `fa79888d608c73c9bc3cecbd3036d81fc2008928`. Source lease for this implementation: `getacourt/browser-companion/{background.js,visible-provider-page.js,racket-preview.js}`, `getacourt/tests/{multi-provider-player-flow.test.mjs,visible-provider-page.test.mjs,racket-preview.test.mjs}`, and this document. No Platform/Core, workflow, hosting, permission or origin changes.

### Observed ordinary UI transition

1. Open `https://racket.id/booking`, choose SAT 31 OCT, expand Carcavelos Tenis & Padel.
2. Choose the club-level 08:00 search tile. Before any specific court is chosen, the interface displays `08:00–09:00 · 60 minutes`, club and Sat 31 Oct, with a separate Select courts action.
3. Open Select courts. This opens the court-choice preview and leaves a separate Cancel / Continue footer. The two rendered court quote cards were Padel 3 and Padel 6, each Roofed / No description / `30.6 eur`. The header binds Sat 31 Oct, 08:00-09:00, 60 min and Carcavelos Tenis & Padel. Continue was NEVER clicked. No confirmation, checkout, payment or reservation receipt was entered; the preview was closed using Cancel after capture. No provider transport or hidden state was inspected, so this is not a backend write audit or proof about undocumented provider internals.

### Real data receipt

| Field | Observed value |
|---|---|
| Provider / club | Racket ID / Carcavelos Tenis & Padel |
| Date | 2026-10-31, bounded requested date matched to visible Sat 31 Oct; year is not printed in the provider preview |
| Court / start / end | Padel 3 and Padel 6; 08:00–09:00 displayed local labels |
| Duration | 60 minutes, explicitly printed |
| Displayed court quote | 30.6 eur per court option, normalized to EUR 30.60; this is the full displayed court quote, not an attestation of possible later checkout fees |
| Capture used for Get | 2026-10-30T04:43:02.186Z |
| Source / coverage | Ordinary visible UI in the in-app browser; roofed-only, expanded-preview subset; provider freshness/timezone unknown |
| Official handoff | https://racket.id/booking (provider portal, not a court-specific deeplink) |

The sanitized observation was entered through the existing manual troubleshooting import into the local Get `find.html` served solely on 127.0.0.1. Matching exact-club/date/sport/60min filters accepted both offers and rendered the real names, time, EUR 30.60, source/partial label and official link. Its normal 60-second expiry subsequently cleared both cards. No fixture was used for this browser receipt. This is a real local browser handoff via diagnostic import, not a claim that the installed MV3 extension, protected hosted app, player identity or automatic multi-provider acceptance passed.

### Implementation and limits

- `racket-preview.js` reads only the already-open Select courts preview; it does not click, select, navigate or access sessions. It binds the visible header to the requested date/time/duration and exact visible Roofed / No description court cards, including explicit one- or two-decimal EUR prices. Changed/ambiguous layouts, extra fees/price labels, per-player prices, duplicate courts and mismatches fail closed. Native calendar/sport controls are not assumed.
- Get Find may read one uniquely matching, explicitly approved existing Racket tab in that browser profile. Existing tabs are never closed; no matching open preview yields unavailable. Temporary newly created tabs retain the prior cleanup. Revocation, strict schema, official URL and short-lived browser-only result handling remain enforced.
- This slice does NOT automate provider search-to-preview preparation. A complete one-Find integration across changing dates/clubs still needs the normal UI navigation adapter and installed-extension UAT; no repeated manual Reader steps are introduced as the accepted product UX. No new host grant, deployed version or automatic login is implied.
- Unit/DOM-shaped tests bind the inspected structure to strict Get normalization and exercise bad date/duration/price and existing-tab ownership. The new preview tests are included through the existing required visible-provider test entrypoint; no workflow edits.

Real Racket quote delivery is now evidenced locally. The full two-platform player-session MVP remains NOT ACCEPTED; the next bounded step is installed-extension verification of this existing-preview reader, followed by safe ordinary query-to-preview navigation. `PUBLIC_GO=false`.

## Reader 0.4.2 — automatic Racket search preparation; installed one-Find UAT pending

30 October 2026, continuation from verified `c06d27a0584b0c9a4ea8238c9dbb0ad22c73cb44`.
Lease: Get browser companion, its Get tests, and this document only. No shared workflows, Core, provider API, host-permission expansion or deploy.

Implemented the ordinary inspected search path behind Get Find: the page relay forwards the exact club name, the existing approved Racket source opens a task-owned temporary tab, and the provider-specific adapter operates only the visible date / exact club / start-time / Select courts controls. It validates the visible 60-minute summary before opening the priced preview, reads the strict quote, and returns it through the existing automatic extension relay. It never clicks Continue, a specific court checkbox, checkout or confirmation. Existing player tabs are preserved and task tabs retain per-source cleanup. Budget is 20 seconds; only one requested start time is inspected, with partial coverage. Only Padel and 60-minute preparation are supported; unproven 90-minute preparation fails closed. Exact club name is required (for example Carcavelos Tenis & Padel); area-wide discovery is not implied.

Consent checks are performed by the extension background, bound to the active task tab, epoch, exact first-party URL and approved Racket origin. The injected script uses runtime messaging rather than unsupported content-script permissions APIs. Revoke, missing grant, lost route or ambiguous controls stop navigation and suppress offers. DOM-shaped tests cover the complete no-import message/navigation path, task-tab ownership and revoke before further clicks. These are fixture tests, not live installed-extension evidence.

Reader manifest, background and visible popup identify 0.4.2 so a loaded browser copy can be distinguished from the prior build. No provider permission is silently granted; the initial player login and provider-specific grant remain owner-controlled and revocable.

### Actual protected browser attempt, approximately 08:50–08:56 Lisbon

- Chrome extension control was available. Opening the protected Get receiver initially showed Netlify Team protection; after normal loading it reached find.html without any authentication action by the executor. Team Login is therefore NOT a current blocker.
- Set exact club Carcavelos Tenis & Padel, date 2026-10-31, 08:00 start, 60 minutes; clicked Find courts once. No diagnostic import, DOM event fabrication, provider payload injection or manual observation transfer was used.
- The currently configured browser returned no verified offers; Racket ID remained not connected/unverified. This is not a live test of the new source build, because the browser's loaded Reader version/grant could not be verified or updated by the agent.
- Opening chrome://extensions/ was rejected by the browser URL security policy (only HTTP/HTTPS permitted). No native-app, CDP, browser command, profile-file or other workaround was attempted. The user must perform any existing extension reload/initial grant themselves.

### Concrete owner-side completion step

In the same Chrome profile, manually reload the existing unpacked GetACourt Reader from this checkout's `getacourt/browser-companion` folder and verify its popup says 0.4.2. If this is not the existing loaded folder, use the existing reader's Details/source location to reconcile it; do not install a duplicate. On https://racket.id/booking sign in normally if required, then use the Reader's existing Connect action to grant Racket site access once. Return to https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html and reload that page so its relay is current. Then the executor can repeat the same single Find and inspect only real returned quote cards. No public/private redeploy is needed for this source/extension setup step.

Status: automatic path implemented and fixture-verified; real installed-extension one-Find acceptance NOT RUN on the new build, no successful live claim. The prior real diagnostic quote receipt is preserved above but does not substitute for this test. `PUBLIC_GO=false`.

## Late checkpoint: exact protected 93, real provider UI, automatic relay still blocked

Observed 30 October 2026, 22:52-22:59 UTC / Europe-Lisbon. Baseline and protected static provenance: `93d6d8e1490e4e288638b8264e28ca6896a9ade5`. CTO granted this document only for the checkpoint append. No runtime, Reader, permissions, workflow or deployment changes accompany it. The source branch remains the existing Draft PR #5; the protected runtime remains exact 93.

### One Find after a legitimate external browser-context change

CTO released one exclusive ordinary HTTPS Get-only check after the browser's tab IDs changed externally. The existing protected `find.html` and its normal `/preview-build.json` visibly identified exact 93, site `5dbcc4a3-5c87-4c75-959f-9a4f9fbc9570` and zero functions. The page displayed Private. These observations do not independently re-audit every protection setting; the earlier anonymous-401 receipt remains separate.

With the clock read immediately before the click at 22:52:13 UTC, performed ONE Find for Carcavelos Tenis & Padel / 2026-10-31 / Padel / 08:00-23:00 / 60 minutes. No diagnostic import, event fabrication or observation injection. After the original 45-second deadline, the primary and independent additional groups reported only actual Reader **0.2.3**, `REQUEST_REJECTED`; expected Reader **0.4.2** did not respond. The initial acknowledgement was not compatible-version proof. Search exited its waiting state with zero verified offers and unknown availability, rather than claiming sold out. Changed tab IDs did not establish an updated Reader, its installation identity or its grants. No personal-login challenge was reached in this Get attempt.

Exact-head CI was rechecked: [Platform](https://github.com/erikkaniss-ai/fillmycourt/actions/runs/41126818609), [federated search](https://github.com/erikkaniss-ai/fillmycourt/actions/runs/41126818705), [accessibility](https://github.com/erikkaniss-ai/fillmycourt/actions/runs/41126818622) and [offline privacy](https://github.com/erikkaniss-ai/fillmycourt/actions/runs/41126818672) all succeeded. CI and fixture-browser results are not live player-supply acceptance.

Canonical same-channel-readback receipts: [Issue #11](https://github.com/erikkaniss-ai/fillmycourt/issues/11#issuecomment-6535216513) and [PR #5](https://github.com/erikkaniss-ai/fillmycourt/pull/5#issuecomment-6535217544). Local evidence: `get-93-new-context-one-find-visible-ax.txt`, `get-93-new-context-one-find-unsupported.png` and `get-93-new-context-reader-result.png`; the last image's SHA-256 is `81a39dd5c6a4274c559e07872f5761db69cafc3efb9e913d1debc4a2831f3dd9`. Files are in the existing external artifact directory `01a18303-1453-7991-8435-ef506c0670d7`, not served as inventory.

### Playtomic: actual ordinary player-browser quote, not a Get relay result

Opened the reviewed official [Cascais Padel & Nature club page](https://playtomic.com/clubs/cascais-padel-club) in ordinary Chrome; its normal account-header indicator appeared. No account identity, credentials, cookies or session state were inspected. The known ordinary date-filter URL `?date=2026-10-31` visibly selected Sat, Oct 31. The same previously inspected anchored price preview opened before a separate Continue button; Continue was untouched and Close dismissed the preview.

| Required field | Visible evidence |
|---|---|
| Provider / club / court | Playtomic / Cascais Padel & Nature / NATUREZA |
| Date / sport | 2026-10-31 / Padel |
| Local start / duration | 8:00 AM / 1 hr, 30 min |
| End | 09:30 derived from start plus duration; not separately printed |
| Displayed court total | EUR 36.00; separate `Continue - EUR 36.00` button not activated |
| Capture clock | 2026-10-30 22:56:58 UTC |
| Official handoff | https://playtomic.com/clubs/cascais-padel-club |
| Evidence class / coverage | Actual ordinary player-browser UI; one expanded court preview |
| Unknown | Provider freshness/timezone, player identity validation and any later checkout fees |

This is the displayed court quote, not an all-fees final-checkout attestation or a continuing fresh offer. No booking, hold or payment action was initiated; provider-internal traffic was not inspected. Evidence: `playtomic-real-20261031-0800-90min-36eur.png` and the matching sanitized `-visible.txt`. Nothing was entered into Get's diagnostic importer and no automatic transfer was accepted.

### TieSports: Padel Factory has a public dated schedule; price preview unproved

In the ordinary public [Padel Factory page](https://clubs.tiesports.com/en/lisboa/PadelFactory), selected Sat 31 Oct / Tomorrow through the normal calendar. The schedule displayed named rows including 1 Axians, 2 Logicalis, 3 Samucar, 4 Consulai, 5 Competição 1, 6 Competição 2 and further roofed courts. No explicit priced duration or full EUR court total was visible. The legend instructs the player to click a free slot to select it; no specific slot/court was clicked because a non-reserving price-preview boundary was not established. The schedule is not a complete available offer.

Evidence: `tiesports-padel-factory-20261031.png` and `tiesports-padel-factory-20261031-visible-dom.txt`. This is PUBLIC_UI evidence, not the owner's authenticated session or automatic Get acceptance. The earlier OPA app-only notice applies to that inspected club. It is not a whole-TieSports blocker: the indexed [official TieSports guide](https://www.tiesports.com/company/blog/book-padel-tennis-court-portugal) describes browser booking at clubs offering online payments. That general guide does not prove that selecting a Padel Factory slot is hold-free or exposes a complete price. Direct retrieval returned 403; no alternate retrieval route was attempted.

### Racket ID login boundary at the initial late checkpoint

The current ordinary Chrome `https://racket.id/booking` initially displayed `Log in to book`, rather than the earlier publicly visible timetable. Opened only the normal Authentication modal with blank email/password fields and preserved the tab for the owner's personal login. No credentials were entered or inspected. The user was asked only to perform that personal login, not extension management or technical repair. Earlier EUR 30.60 quotes remain historical observations, not current availability.

The owner then explicitly reported that the personal login was complete. A fresh ordinary page read showed the club search in place of the login gate. Chose SAT 31 OCT, Carcavelos Tenis & Padel, Padel, with the existing Only roofed filter. The club-level 08:00 control now produced a visible **08:00-09:30 / 90 minutes** default, rather than the earlier 60-minute observation. The same separate Select courts preview displayed **Padel Heineken Zero (4)**, Roofed / No description / **46 eur**, with Carcavelos Tenis & Padel, Sat 31 Oct, 08:00-09:30 and 90 min in its header. The year 2026 is bound to the requested calendar context, not printed in that preview. Official handoff remains https://racket.id/booking. The quote was captured before the 23:00:05 UTC clock read; no exact capture-second claim is made.

The provider itself displayed the lone court already checked upon opening this preview. The executor did not toggle any court checkbox or activate Continue. Captured the visible quote and then Cancel; both the modal and time-selection bar disappeared. No booking/hold/payment action was initiated, and no provider-internal transport audit was performed. Therefore this does not prove that the changed provider preview has no undocumented server-side hold semantics. Do not broaden automatic navigation on the strength of this checked default. Evidence: `racket-id-real-20261031-0800-90min-46eur.png`, matching `-visible.txt`, and `racket-id-preview-cancelled.png`. This is an ordinary player-browser quote after explicit owner login readiness, not Get automatic acceptance, a final all-fees price or continuously fresh inventory.

Source-to-visible-UI comparison found two additional gaps in exact 93: `search()` admits query duration 0/60 but waits for a literal 60-minute summary, while this path defaults to 90; the header/card parser only accepts numeric `Padel N` labels, while the current court has a sponsored name. An offline replay of the sanitized current header/card returns `OFFER_FORMAT_CHANGED`. This is a parser diagnostic, not an imported offer or live extension test. A separate narrow source proposal was sent to CTO; no parser, duration support or court-label acceptance changed in this document-only checkpoint. Canonical after-login receipts: [Issue #11](https://github.com/erikkaniss-ai/fillmycourt/issues/11#issuecomment-6535330249) and [PR #5](https://github.com/erikkaniss-ai/fillmycourt/pull/5#issuecomment-6535331013), both read back in their original channels.

### Recovery boundary and acceptance

The earlier extension-management denial explicitly prohibits alternate routes to the same blocked outcome. Official documentation and available plugin/capability research did not establish a permitted custom-Reader maintenance mechanism. No native-app, clipboard, CDP, profile-file, restart, installation or grant workaround was attempted. The historical owner-side technical completion request above is superseded by the owner's newer direction: involve the owner only for personal provider login; CTO owns the technical capability blocker. Do not ask the owner to repeat Reader checks.

The main automatic-search blocker is the actual unsupported Reader response. Repeat Find requires a meaningful external compatibility state change; no search loop or API fallback follows from these receipts. TieSports/Smashpro price-preview safety and MATCHi eligible EUR-venue/session evidence remain unresolved. Two real independent platforms delivered automatically into Get, and all-platform coverage, remain NOT ACCEPTED. `PUBLIC_GO=false`.
