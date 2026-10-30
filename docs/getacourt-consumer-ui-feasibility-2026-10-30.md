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
