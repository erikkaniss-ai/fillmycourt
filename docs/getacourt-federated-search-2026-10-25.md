# GetACourt federated discovery — 25 October 2026

## Working slice

The new `search-all.html` page contains a real read-only search form and a
shared results screen calling `GET /api/gac/search-all`. The existing profile
link reaches `personal-sources.html`, which remains inert guidance (no script
or network) and now has an ordinary link to the new page. The original homepage,
native search, account, Watch and booking flows are not replaced. No-code
Playtomic setup is retained; the extension itself is unchanged.

The initial candidate incorrectly reused the legacy guide route and failed its
existing no-script regression. The new screen was moved to its own route and
the inert page restored. No legacy security assertion was relaxed or removed.

The handler executes independent source adapters with a bounded timeout and
AbortSignal. An unavailable Core source cannot erase the club directory. Native
Core uses the existing approved-venue configuration and GET availability route;
no authorization header is forwarded. An empty allowlist makes no Core request.
The known Cascais staging fixture remains excluded even if accidentally listed.
Prices require an explicit nonnegative integer minor-unit amount; missing price
is not zero. Time filtering uses an explicit IANA timezone; repeated DST wall
hours have distinct UTC instants and visible offsets. Duplicates collapse;
contradictory same-slot prices are suppressed rather than choosing one silently.

## What is and is not connected

- Core: operational read adapter, dependent on actual configured approved venues.
- Playtomic: reviewed club directory route and the existing separate personal
  extension. **No Playtomic offers enter this web endpoint yet.**
- TieSports / TiePlayer, Racket ID, Smashpro: reviewed directory routes only,
  not live availability adapters. One venue can have multiple source routes.
- Club internal systems: explicit not-connected status; no fabricated inventory.

Directory entries and available offers are separate response/UI collections.
A listing, opening hours, an unclaimed profile, empty booking history or a source
error never means a court is free or every court is occupied. This initial
three-venue catalogue is not Portugal-wide coverage. Native-to-external club
identity is not fuzzy-matched; future cross-source slot consolidation requires
an explicit verified mapping, not a similar club name.

## Public directory evidence

Only minimal public names, area, sport and entry URLs are retained; no photos,
player account IDs or historical live offers are copied.

- Cascais Padel & Nature: `https://playtomic.com/clubs/cascais-padel-club`,
  source route verified in the 24 October owner-session receipt. A 25 October
  anonymous web request was denied; no current availability was inferred.
- Quinta da Marinha: `https://www.racketspro.pt/quinta-da-marinha`, reviewed
  25 October; official club page identifies Cascais, padel/tennis and a Racket ID
  reservation link. `https://racket.id/booking` is a general player portal, NOT a
  slot-specific deep link: the player must select this club.
- Same venue: `https://smashpro.pt/pt/c/rackets-pro-academy-quinta-da-marinha`,
  reviewed 25 October; explicitly unclaimed. It remains labelled that way.
- OPA OEIRAS: `https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy`, reviewed
  25 October; official page names padel and pickleball. Directory only.

Review dates describe directory evidence, not inventory freshness. Exact area
matching deliberately avoids inventing coordinates or proximity. The new route
rejects unsupported coordinate parameters instead of silently ignoring them.

## Browser behavior

No automatic initial search or background polling. Requests use same-origin GET
and no-store; only hosting's normal same-origin session may accompany them.
No player password, token, server-visible extension bridge or third-party session is used.
All text is inserted with textContent; source links have exact host/path rules,
no query/account identifiers and no automatic navigation. No booking controls.
Offer snapshots expire after 60 seconds, on changed filters, and on page exit.
Aborted/late search responses cannot restore a previous query. Directory entries
remain clearly unverified. If the whole search endpoint fails, a labelled local
public-directory fallback remains available, never fabricated offers.

## Validation and remaining work

13 Node contract groups exercise the actual endpoint plus query validation,
price/fixture/DST safety, deduplication, source timeout/auth failures, redaction
and source URL policy. Nine Chromium cases test the actual page and actual
handler at 320/390/1440 with an in-process **fictional** Core, source/API failures,
query races and expiry. This is not real club inventory or hosted acceptance.
The local container browser denies loopback navigation; do not describe that
attempt as a passed browser check. The initial dedicated GitHub workflow
40146625736 passed all nine browser cases and 13 Node groups, but full Platform CI
rejected the guide-route conflict. The corrected exact HEAD must pass every
workflow before overall acceptance. Existing Platform, accessibility and
offline/privacy regressions remain required and unchanged.

Next: integrate the current personal Playtomic observation path into common
source-labelled results without treating an owner's session as a shared supply
feed; add real TieSports/Racket ID adapters on verified player routes; onboard
one club-authorised internal system. Homepage entry/promotion, protected hosted
acceptance and real supply coverage remain distinct from this source slice.
No new production deploy, schema, provider write, account, booking, payment or
customer message is authorized or performed here.

## G2: owner-controlled personal Playtomic offer comparison

The federated page now accepts an explicit **sanitized observation** copied by the owner from the installed personal Playtomic Reader. It is a user-initiated browser-to-browser clipboard action, **NOT automatic multi-club provider authorization, real-time server availability, provider OAuth or a new API adapter**. The existing browser extension keeps all access credentials, page access and approval in Chrome. Copying is optional: no provider auth, cookies, refresh tokens or player identifiers appear in the strict schema; the web form never uploads or persists the pasted report. The imported text is cleared on click, a new search/filter change, navigation/page exit and observation expiry. Treat the browser/OS clipboard itself as an external surface until replaced; never copy an account export.

Flow: (1) conduct a normal search-all.html query with location, date, sport, time and duration; (2) in the personal Reader, search the same date and sport for a personally approved Playtomic club, then click **Copy observed offers to compare**; (3) return to the web search, paste only this short report into **Personal Playtomic offers** and click **Compare observed offers**. If Clipboard API is denied, the Reader exposes a selected read-only sanitized text field for a normal Ctrl+C. The web page must be hosted to run GET /api/gac/search-all; this source-only candidate has not been deployed. The import does NOT turn on automatic provider reading or grant the web app access to Playtomic.

The bridge validates exact allowed top-level and per-offer fields, verifies the original strict Playtomic observation schema, requires clean official HTTPS club URL, matching date/sport and query time/duration, and rejects future/older-than-60-second captures and sensitive or additional fields. The UI labels personal cards separately from Core results, with unknown source freshness, unknown timezone, **no UTC start instant**, bookingEnabled=false, partial observed coverage and a link to the **club page only**. No price or free court can be invented from a listing. Known catalog club IDs may be mapped by exact vetted URL only; other Playtomic clubs remain unmapped personal observations rather than falsely joined by name. A missing/changed query clears personal cards while retaining independent Core/club statuses.

CI: getacourt/tests/personal-observation-bridge.test.mjs checks strict evidence boundaries, time/DST uncertainty, price cents, unknown/foreign source, sensitive fields, stale data, no network/storage/booking and no false Core authority. The existing dedicated federated-search CI now runs those Node tests plus 320/390/1440 Chromium fixture cases that compare a fictional Playtomic observed court beside two fictional Core offers and reject injected tokens/mismatched dates. Personal Reader's mandatory Chromium tests now verify explicit sanitized copy and clearance after 60 seconds. None of these fictional observations proves a live provider feed, player authentication, official permitted redistribution or production acceptance.

**Still required for end-state:** multi-venue delegated player discovery, provider-specific approved connectors (TiePlayer, Racket ID, Smashpro, club internal), legitimate provider/club permissions, protected hosting and real owner's Playtomic v0.2.2 source/UI acceptance. The browser-local handoff below removes clipboard/paste but deliberately remains multi-gesture so the extension receives `activeTab` only after the player chooses the exact receiving page. Do not interpret passing source CI as completed nationwide free-slot searching.

## G2.1: browser-local no-clipboard handoff (source-only)

Reader v0.2.2 can retain one already validated `user_ui_observation` in
extension session storage for less than 60 seconds and open the fixed public
comparison URL without adding any data to the URL. It does not use
`externally_connectable`, permanent host permissions, a web-accessible resource,
provider HTTP, cookies, token forwarding, clipboard read/write or server
upload.

The player first searches the same date/time in the page, explicitly requests
the prepared Reader observation, and then invokes the extension action in that
same exact `https://getacourt.com/search-all.html` tab. Only that `activeTab`
gesture allows the extension to inject its tiny local relay. The relay returns a
single strict sanitized report to the page's one-time request; success deletes
the session copy, as do expiry and disconnect. A forged/extra-field observation,
wrong origin/path, missing request, stale capture or changed page query is
rejected by the existing strict page validator. The observation remains
user-observed, partial, timezone/freshness-unknown and non-bookable.

Node contracts cover strict sender/page selection, no URL/clipboard payload,
single-use delivery, expired/credential-bearing rejection and disconnect
clearance. The federated Chromium fixture additionally covers unsolicited page
events, user-gesture nonce matching and hostile extra fields. This is not live
Playtomic acceptance and cannot work on an older hosted Get page until this
exact source is separately approved and deployed.
