# GetACourt release search: source decision and implementation

Owner direction, 27 October: park the browser extension and deliver ordinary web
search. Owner additionally confirmed **no real club has agreed to supply data**.
No existing provider credential, source grant or live inventory was inferred.

## Access investigation

| Path | Primary evidence | Usable now? |
| --- | --- | --- |
| Playtomic club API | [Official guide](https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide), [booking specification](https://third-party.playtomic.io/endpoints/bookings/): club-scoped booking/payment reads. No complete available-slot/price feed established by these documents. | No authorised Get supply connection. Booking gaps are not free inventory. |
| Playtomic Connect | [Official partner programme](https://playtomic.com/connect): certification/contract path. | Application/access not established; no invented endpoint. |
| TieSports | [Official features](https://www.tiesports.com/pt/tiemanager/todas-as-funcionalidades) advertises API/webhooks; [pricing](https://www.tiesports.com/pt/precos) includes operational API. | **First provider to qualify.** No public slot/price schema, credentials, scope or distribution agreement located. Search-index evidence only; direct documentation fetch returned 403. No protection bypass. |
| Racket ID | [Official product](https://racket.id/home), [player portal](https://racket.id/booking): court booking and price lists exist in the product. | Public portal requires normal player login. No supported partner slot/price API or Get access established. |
| Smashpro | [Official bookings product](https://smashpro.pt/pt/for-clubs/features/bookings): prices, durations and availability are club-managed. | No public integration specification or approved Get feed found. A public listing is insufficient. |
| Native Core | Read-only staging inventory inspection. | Only the original Cascais **test venue** is active; two F1 fixtures are inactive. No real eligible source. Existing hard fixture exclusion preserved. |
| Direct club-owned feed | Club supplies explicit current slots and total prices from its own canonical system. | **Implemented connection path, not an activated real source.** Requires the first consenting club. |

No real working source was selected under the access actually available. The
engineering choice is a direct canonical club feed; commercial priority is the
TieSports operational API. These choices do not assert a provider agreement.
No additional catalogue entries, accounts, outreach, provider requests or
synthetic inventory were substituted for real supply.

## Working web path

`find.html` -> same-origin GET `/api/gac/search-all` -> approved Core and/or
configured club feed -> dated, priced offers -> official club booking page.

The release entry has no extension, clipboard import, account-link requirement,
directory cards, reservation or payment controls. The homepage links to it.
`search-all.html` and the companion remain historical experimental work. Their
private draft job only runs with an explicit exact-head Reader scope; ordinary
release changes no longer trigger it. No archived worker/scheduler is revived.

## Direct-feed contract (GetACourt-defined; not a vendor API)

The club must own the authoritative inventory or have independently verified
rights to supply it. This adapter is **not** a proxy around a provider contract.
Its declared `approvalRef` references reviewed original evidence; configuring
that string is not itself evidence of a club agreement.

Server-only `GETACOURT_CLUB_FEEDS`: maximum five sources, each with this shape.
All values below are **FICTIONAL EXAMPLES**, not a live club or grant:

```json
[{
  "id": "example-club-feed",
  "clubId": "example-club",
  "clubName": "FICTIONAL EXAMPLE CLUB",
  "areas": ["Cascais"],
  "timezone": "Europe/Lisbon",
  "feedUrl": "https://club.example.org/getacourt/availability",
  "bookingUrl": "https://club.example.org/book",
  "courts": [{"id":"court-1","name":"FICTIONAL COURT","sport":"padel"}],
  "approvalRef": "FICTIONAL-EXAMPLE-NOT-APPROVAL",
  "validUntil": "2026-11-01T00:00:00Z",
  "maxAgeSeconds": 60,
  "authority": "club_canonical"
}]
```

One explicit search sends a GET to the exact reviewed HTTPS feed URL with
`sport`, `date`, `from`, `to`, `duration`. It sends no player location, caller
authorization, cookies, provider token or credentials. Feed and booking URLs
must share the club-controlled origin. URL credentials, nonstandard ports,
queries/fragments in configuration, literal/local hosts and vendor API origins
are refused. No browser-supplied URL is accepted. Redirects are refused. URLs
and their public DNS ownership must be reviewed before configuration.

The response uses `Content-Type: application/json`, at most 256 KiB:

```json
{
  "version":"gac-club-availability/v1",
  "clubId":"example-club",
  "date":"2026-10-28",
  "sport":"padel",
  "observedAt":"2026-10-27T12:00:00Z",
  "expiresAt":"2026-10-27T12:01:00Z",
  "offers":[{
    "id":"offer-1", "courtId":"court-1",
    "startsAt":"2026-10-28T18:00:00Z",
    "endsAt":"2026-10-28T19:30:00Z",
    "priceMinor":3600, "currency":"EUR"
  }]
}
```

`priceMinor` is the explicit total court price in integer cents, not a per-player
amount. No missing price or time is calculated from bookings, opening hours or
tariffs. Only configured courts/sports, exact dates and 60/90-minute intervals
are eligible. Times require explicit offsets; venue timezone renders Lisbon DST
offsets. Unknown fields/private data fail closed. Stale/future/expired evidence,
expired grants, contradictory quotes, unpriced or foreign courts are suppressed.
The link opens the official **club booking page**, not a claimed slot deep link.
The provider/club retains booking authority.

Snapshots expire at the earliest source expiry, grant expiry or 60-second page
limit. A bounded per-runtime cache reuses only fresh normalized results (20
entries); it stores no raw feed, customer data or credential. It is not a shared
cross-replica rate limiter. Agree publisher caching/rate limits and runtime
topology before a real feed is activated. One source failure preserves other
successful feeds; coverage always remains partial. Empty results never mean
all courts are sold out. No background polling, provider writes or DB writes.

## Live acceptance still needed

1. First named club/source owner and original permission to show availability,
   total prices and official booking link; supported data access and rate policy.
2. Court/sport map and club timezone; complete explicit slot/price response with
   independent comparison to the club's actual booking system.
3. Protected deployed search with one real current offer, stale/withdrawn offer
   rejection and correct official handoff; no transaction.

The unit/browser fixtures use unmistakably fictional clubs and intercepted
responses. They test the actual handler and release page, not live supply.
No source variable is configured by this change. Public release remains gated.

## Ready qualification request for TieSports (not sent)

We are building GetACourt, a Portugal court-search service. Can the operational
API provide a permitted read-only integration for one consenting club, returning
court identity, date, timezone, exact start/end, duration, available status,
total visitor price/currency, source timestamp/expiry and official booking link?
Please provide the supported API specification, authentication/scopes, club
activation requirements, rate limits, sandbox/test route and terms permitting
display of these offers in an external consumer search. We do not need customer
records, booking writes or payments for this first integration. Please also
confirm whether court availability and prices are supported separately from
financial exports, and whether a club invitation or partner agreement is needed.

Use the existing BD/provider contact route after explicit send authorisation;
do not send duplicate drafts or revive the earlier outreach campaign.
