# GetACourt First: consumer launch roadmap
Reprioritization approved by product owner, 2026-10-15. Sequencing only; approved product logic Decisions #1–#96 unchanged.

## Product MVP (P0)
- Search and map REAL clubs, geocode city/address plus near-me GPS, distance bands, sports, indoor/outdoor, stable geo sort.
- Distinguish club DIRECTORY from authoritative LIVE AVAILABILITY; never show test inventory in public release, or infer slot availability from directory data.
- Every club has provider/permission provenance, coords, up-to-date authoritative booking destination. Missing live feed -> no fabricated slots; optional approved external handoff explicitly labeled.
- Native direct booking for connected clubs ONLY: one Core booking authority, freshness validation, authenticated identity, server hold/confirm, final price and cancellation policy, receipt/history and exception handling. Unsupported provider -> handoff, not fake direct booking.
- Nick search product is a read-only optional discovery adapter or separately mounted module: do not block launch, no permission to book inferred.
- Installable PWA before native app-store binaries; iOS/Android mobile app builds in parallel after booking and push/auth contracts. PWA is not automatically in App Store/Google Play.
- FillMyCourt Core stays priority for needed inventory and booking operations. The full club UI, financial fees/settlement and CRM automation are deferred.
- MVP release acceptance: minimum REAL verified clubs in launch region, zero staging fixture listings, geo distances & accurate timestamps, booking for at least one approved integrated club, fully tested auth and cancellation, privacy/terms, browser mobile QA, logs & rollback.
- Any public branch release needs explicit owner GO; existing published Get branch is bound to public getacourt.com. Never enable billing/provider writes/CRM sends or production automatically.
## Consumer feature recommendations for owner review
Public: Search/map, venue details, distance, price when verified, connected-booking badge, authorized external booking deep link, PWA install.
Conditional: Native slot booking / My bookings only for authorised Core-integrated clubs after booking GO; provider-handoff for others.
Hide initially: My Watches and Play Routine until background worker/notifications are genuinely active; split payments, payment preference, deposit, pseudo checkout for unsupported clubs; B2B analytics/CRM/campaigns and prominence of For Clubs.

## UPDATE — Provider-owned booking is the default for established clubs (2026-10-15)
The owner clarified that clubs generally already use Playtomic-like booking platforms. **GetAcourt's role is discovery and a user-initiated provider-owned checkout/handoff, not competing booking creation in our Core.** Core native write remains available only when a club explicitly connects our booking authority. For supported partners, evaluate official provider-hosted white-label/embedded checkout, never assume arbitrary embeds or ability to read protected availability from a PWA. A browser request from the actual user's device is still subject to CORS and platform access controls. Full contract: [Provider-owned booking architecture](getacourt-provider-owned-booking-rfc.md).

Replace the earlier blanket MVP requirement "book directly through our Core on at least one connected club" with a two-step release criterion: (1) real geo-search and verified official partner booking handoff; (2) approved provider-hosted checkout or explicitly authorized native/API booking, with final confirmation owned by that provider. **Do not claim handoff as in-app direct booking.** No public activation before separate gate.
