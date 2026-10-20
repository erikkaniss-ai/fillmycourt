# GetACourt / FillMyCourt — official provider activation gates (20 October 2026)

**STATUS: RESEARCH + SYNTHETIC ENGINEERING ONLY.** No live provider access, OAuth, external tokens, customer data, booking/holds/payments or outreach authorised. Owner Decisions #1–#104 unchanged.

## Verified official Playtomic interface

Primary API guide updated 14 October 2026: https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide

- Playtomic club/chain OAuth 2.0 Client ID/Secret access is a **club-owned read-only** API, NOT a verified player-delegated GetACourt OAuth flow.
- The public endpoints describe club bookings and payments; there is no verified complete available-court slot feed or create/edit booking capability.
- Historic booking data limited to last three months, plus future bookings (up to 365 days per request); times in UTC.
- Calls rate-limited usually **one request per minute**; no dedicated sandbox. Eligible individual/multi-location clubs require Champion/Master plans; chain owners contact their account manager.
- Playtomic Connect certification: https://playtomic.com/connect — official application, technical review, signed legal framework, onboarding and access to approved club data.
- Unauthorized integration warning, updated 2 Oct: https://helpmanager.playtomic.com/hc/en-gb/articles/47390286355089-Third-party-integrations-and-Playtomic-Connect

## Non-negotiable source-authority distinction

Booked slots or payments do not themselves constitute a complete, authoritative **available court inventory**. Never infer or publish real availability without written source authorization, verified complete club-hours/blocks/court map, freshness/failure policy and authorized booking/handoff endpoint. A GetACourt player's consent cannot grant third-party API rights.

## Portugal P0 activation matrix

| Path | Current authority | Next verified evidence required |
| --- | --- | --- |
| Playtomic club API | Official club/chain read-only booking/payment route | Named consenting eligible club, data/scope/retention agreement, credentials only server-side, contract terms, provider tests, owner GO |
| Playtomic Connect | Official partner program | Application acceptance, signed partner contract and explicit endpoint scopes before any live connection |
| Playtomic player OAuth | Unverified | Provider-issued code/delegation specification, player scope & revoke rules, availability rights, owner GO |
| TieSports / Racket ID / Smashpro | Public club software only, player data rights unverified | Written provider API scopes, supported access and contract |
| Native/manual | Club-authorized manual sources possible | Timestamped source-provenance, comprehensive inventory, no invented real-venue slots |

## Engineering gate

1. Provider Connection Foundation is deliberately synthetic and transport-free. Credentials are forbidden in this slice; internal consent never upgrades unverified capability.
2. syntheticReadPreflight simulates >=60-second polling intervals and fixture freshness only. Rate eligibility never authorizes outbound requests or available-slot display; all statuses fail closed.
3. Separately gate club bookings.read, availability.read, provider_handoff, player account link and provider-native booking writes. None of these are inferred from another.
4. Before authorised live pilot: contractual scope/DPA, access revocation, 429 backoff, freshness, DST, cross-tenant isolation, provider-source error/denial tests, protected hosted UAT, explicit new owner GO.

## Owner-only commercial gate

Select one named eligible Portugal club for permitted read-only pilot **or** approve a Playtomic Connect application. Confirm contracting OS entity and legal authority before external account identifiers, real tokens, emails, customer data or provider API requests. Production remains unchanged.
