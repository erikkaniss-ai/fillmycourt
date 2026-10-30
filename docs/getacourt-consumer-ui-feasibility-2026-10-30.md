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
