# GetACourt federated discovery — 25 October 2026

## Working slice

The existing `personal-sources.html` route now contains a real read-only search
form and a shared results screen. It calls `GET /api/gac/search-all`. The existing
profile link reaches this route; the original homepage, native search, account,
Watch and booking flows are not replaced. The no-code Playtomic reader setup is
retained in an accessible disclosure. The extension itself is unchanged.

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
No player password, token, extension bridge or third-party session is used.
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
attempt as a passed browser check. The dedicated GitHub workflow must finish
successfully before claiming browser acceptance. Existing Platform, accessibility
and offline/privacy regressions remain required and unchanged.

Next: integrate the current personal Playtomic observation path into common
source-labelled results without treating an owner's session as a shared supply
feed; add real TieSports/Racket ID adapters on verified player routes; onboard
one club-authorised internal system. Homepage entry/promotion, protected hosted
acceptance and real supply coverage remain distinct from this source slice.
No new production deploy, schema, provider write, account, booking, payment or
customer message is authorized or performed here.
