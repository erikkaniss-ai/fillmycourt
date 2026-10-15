# Nick search adapter RFC, 2026-10-15
Nick integration API/docs and data permissions not yet provided. No claims of real availability or native booking authority.

One search contract: Candidate {provider_name,provider_club_id,name,sports[],coordinates?,address?,last_verified_at?,booking_page_url?,booking_capability: directory_only|external_handoff|core_native|authorized_provider_write,availability_freshness_seconds?}. All fields explicitly source-derived. Do not guess a link or a lat/lon.

A thin isolated adapter can run standalone or inside Core discovery aggregation; add circuit breaker/timeouts, dedup (provider authoritative IDs), licensing verification, no PII transfer, auth/rate budgets, and per-provider capability table. Nick's results are directory candidates until independently authorized availability/booking evidence. Only Core can commit native bookings; never run two booking writers.

Need Nick's endpoint/repo/docs, license, geography, freshness, sample responses, rate limits, fees and booking authorization to pick design.

## UPDATE — Source-to-booking authority (2026-10-15)
Nick's browser-based provider search (as described by the owner) is unverified; check CORS, platform authorization and whether outputs originate from a lawful supported route. Do not deploy request impersonation, anti-bot evasion or unattended UI automation against blocked provider endpoints. Provider confirmed booking links and permitted club data may be consumed, but an authenticated user must continue with provider-owned checkout. Full authority model in [Provider-owned booking architecture](getacourt-provider-owned-booking-rfc.md).
