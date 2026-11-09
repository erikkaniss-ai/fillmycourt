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

## Worker-side provider authorization gate — added in Draft PR #5

The existing Playtomic worker can acquire club credentials if a DB connection is configured. A new mandatory gate in platform/src/fmc/provider_read_gate.py is now called BEFORE credential access by platform/src/fmc/v1_workers.py.

Default is DENY. The gate requires ALL of:

- Exact deployment environment flag FMC_OFFICIAL_PROVIDER_READS_ENABLED=true (not enabled by this work).
- Configured Playtomic club connection with write_mode=read_sync and official_read_authorized set to Boolean true.
- A named internal config.official_grant status=approved, authority=club_or_certified_partner, exact organization_id / tenant_id binding, opaque agreement_ref and owner_approval_ref, UTC approved_at and future UTC expires_at.
- Exact scopes list [bookings.read], with no extra scope and no players, payments, account-link, availability or booking.write permission inferred.

The gate returns a limited internal read receipt, NOT a provider token and NOT provider-issued proof. Written provider/club rights remain a separate approval and documentation requirement.

DO NOT ENABLE LIVE CONNECTIVITY YET: the worker now reserves one shared connection-level data-request interval of at least 60 seconds and processes one page per leased job; it stores the next page, fixed window and observed count in the durable job payload, atomically with shadow observations. Deferred 202/429 requests preserve progress and retry budget. Nevertheless the OAuth access-token request is a separate HTTP call; the provider's exact rate-limit treatment for token traffic, live scope agreement, GDPR privacy review, authorized club and hosted acceptance are still UNVERIFIED. No deployment feature flag, staging credential, real provider access or production settings changed.

The Playtomic adapter now describes supported source code without inventing rights: read_sync=true (adapter capability), handoff=false, availability_read=false, player_delegated_oauth=false, authorized_native_write=false.

## Durable one-page pagination and per-connection pacing — source-only

- `platform/src/fmc/provider_page_budget.py` validates a fixed UTC window, page number 0–48, opaque cursor shape, source page response and next-page count. It rejects invalid, expired or rewritten checkpoint windows.
- `platform/src/fmc/supabase_v1.py` adds atomic `reserve_provider_request` and lease-token-bound `checkpoint_provider_job` / `defer_provider_job` for retries and cursor requeue.
- `platform/supabase/migrations/20261020185000_provider_request_windows.sql` provides one private rate-reservation row per provider connection, shared across streams and worker processes. Initial -infinity next_allowed timestamp is explicitly handled for PostgreSQL 16.
- `platform/src/fmc/v1_workers.py` processes exactly one authorized club-bookings page per lease. Page records and queued next-page job checkpoint commit in the same database transaction, or both roll back. A completion timestamp is cleared while an export is ongoing.
- Supported `bookings.read` remains a source observation, **not** an availability read or a booking-write operation. Players/payments/player OAuth are still blocked by the separate official grant gate.
- Safety limits are applied to maximum page and record counts. A 202/429 defer retains the cursor and does not count as a terminal failure.

**Remaining pre-activation gate:** documented permission of a named club/Playtomic Connect partner, exact auth-token request pacing, token lifetime/refresh strategy, proof of no cross-tenant data exposure, live 429/202 tests in authorized controlled context, operator QA, and explicit owner GO. Source-only CI cannot prove real-provider rate-limit compliance. Public sites, production, provider credentials and environment flags remain unchanged.

## OAuth and data-request pacing across worker leases (source only)

Playtomic's official club API guide describes OAuth 2.0 club client credentials and an access token typically valid for around one hour. It does **not** establish that OAuth token issuance is excluded from the provider's usual one-call-per-minute limit. The worker therefore conservatively treats token requests and booking reads as TWO distinct provider HTTP operations with separate one-minute reservations. Source: https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide

- `platform/src/fmc/provider_token_sessions.py` reuses a club-scoped in-memory Playtomic client/token for one long-lived provider worker process. Key binding includes organization, connection, tenant and a non-reversible fingerprint of client credentials. Rotation replaces the cached client. No token is serialized to a job, PostgreSQL, browser, log or dashboard.
- `platform/src/fmc/playtomic.py` now supports `token_usable` with safety margin, explicit forced refresh and rejection of too-short token lifetime. OAuth `202/429` respects Retry-After and defers without deleting a durable cursor.
- `platform/src/fmc/v1_workers.py` uses the SAME `reserve_provider_request` DB rate-budget for authorization and page reads. If no sufficiently valid token is in the current process cache, the worker reserves one slot, obtains the token, then delays the job at least 60 seconds BEFORE sending its next data page. If the token remains valid, it reserves a separate slot and performs exactly one bookings page. No OAuth redirect or player account linking is introduced.
- Unit tests use only local MockTransport/fakes, validating reuse, credential rotation, revocation isolation, OAuth rate-limit deferral, separate reservations, and restart behavior. A worker restart loses its token and safely repeats authentication under a new reservation, never sending the subsequent page in the same interval.

**Operational constraint:** this is deliberately an in-memory session cache, not a cross-replica token vault. Multiple active provider worker replicas or rapidly cycling processes may repeatedly obtain tokens and delay data progress. A permitted pilot requires verified single-worker runtime topology or an approved encrypted shared-session design. Do not set FMC_OFFICIAL_PROVIDER_READS_ENABLED=true, provision live credentials, or claim live Playtomic readiness until this topology, provider-side token pacing rules, authorised club/Connect agreement, DPA, revoked-credential negative checks and hosted UAT are accepted.

## Local session withdrawal on the next sync attempt — 21 October 2026

The worker previously denied a withdrawn/expired internal grant before credentials or network, but left its earlier token cached. It now discards that connection's in-memory session when the connection lookup or official-read gate rejects the next leased attempt, including disabled connections, revoked/expired grants, disabled deployment opt-in and invalid scope. Cached clients retained by the worker have their token and expiry cleared; other connections stay isolated. A later reviewed approval obtains a fresh token in a separately paced OAuth operation before any bookings page.

Provider authentication failure, invalid token lifetime and provider scope denial also discard the local session. A mocked `401/403` causes one bookings GET and no immediate OAuth retry, observations or shadow writes. Existing `202/429` and authorization-pacing deferrals retain the session and durable page state.

`platform/tests/test_provider_session_revocation.py` first reproduced all eight missing eviction cases locally, then passed with the fix. All HTTP is MockTransport, credentials/tokens are fictional, and denied-grant tests reject credential lookup, rate reservation and shadow writes. Existing token lifecycle, grant and paging regressions remain required, including PostgreSQL 16 CI for database cases.

This is local cache invalidation on an attempted sync, not provider-side token revocation, immediate idle-worker invalidation, cross-replica invalidation or cancellation of an already in-flight request. Real revocation/401/403 UAT, provider token policy and written club permission still require explicit scoped GO. No connection, feature flag, credentials, schema, deployed worker, Control Tower or public site is changed by this source-only slice.

## Booking-read provenance and pilot evidence — 21 October 2026

The worker now records a whitelisted `provider-bookings-provenance/v1` receipt for each successfully processed booking page, including an empty final page. It records the organization/connection, exact `bookings.read` scope, hash of the reviewed internal permission snapshot, approval/expiry timestamps, observation time, fixed export window, page, record count and fingerprints. No client credentials, provider tenant identifier, agreement/contact details or raw booking records are copied into the receipt. Normalized record fingerprints use the existing observation serialization, including Unicode handling.

Receipts use the existing organization-scoped `provider_observations` table under its current RLS with a separate `bookings_provenance` stream, null external ID, explicit time/window columns and `complete=false`. No migration or new grant is introduced. The receipt, original normalized observations, shadow booking metadata reference and next-page checkpoint share one transaction. A failure rolls all of them back; the independent request-rate reservation remains consumed. Re-inserting the identical receipt is idempotent; a later actual page read has a distinct observation time and receipt. Existing booking observation deduplication and reconciliation payloads are unchanged. Previously stored rows are not backfilled or retrospectively accepted. Hashes are internal integrity references, not provider signatures or proof of a provider agreement.

`export_final_page` means only that this bookings export reported no next page. It never establishes comprehensive court inventory, free slots or provider booking authority. Every receipt and linked shadow booking retain `availability_feed_authorized=false`; the receipt additionally fixes `can_display_available_slots=false` and `writes_authorized=false`. The permission snapshot is checked again for expiry/opt-in after the page returns, but it is still the fetched connection snapshot, not independent contractual verification or real-time in-flight revocation.

Before a named-club pilot can be accepted, record all of the following under a separately approved scope:

1. Named club/provider entitlement, approved contracting party, exact permitted endpoints/data purposes, retention/privacy terms and owner GO. Playtomic club booking events do not grant a complete availability feed; TieSports still requires its own documented provider contract and supported scope.
2. Match each shadow record to its receipt by fingerprint **and** organization/connection. Inspect the recorded permission hash/validity, window/page and normalized record fingerprints. Missing, old, foreign or historical pre-receipt evidence stays unverified; never relabel it as current approval.
3. Verify independently the authorized inventory source, completeness, freshness/expiry and stop policy before displaying any availability. An empty bookings page is not evidence of a free court. No freshness threshold or actual club hours are invented here.
4. On the exact protected candidate, complete operator tenant isolation, second-organization 403, mobile viewports and logout/relogin; then separately approved provider 401/403, revoke, 202/429, cursor recovery and retention UAT. Source CI and fictional receipts do not satisfy these hosted/live gates.

This slice adds evidence capture only. It does not enable a provider, add a public endpoint or Connect UI, change the single Core booking writer, deploy the worker, change Control Tower or authorize outreach/transactions. No real club, provider credential or request was used.

## Read-only pilot provenance review — 21 October 2026

`platform/src/fmc/provider_provenance_review.py` adds an **unmounted server-side review**, not a public endpoint or background job. `review_provider_provenance` requires an authenticated user, organization/connection, aware review time and an explicit positive `max_age_seconds`. No default freshness SLA is selected. It reads only Playtomic shadow bookings in that organization, using existing owner/admin/manager/analyst membership and authenticated RLS inside a `REPEATABLE READ, READ ONLY` transaction. Existing non-review transaction behavior is unchanged; no new grant, role, migration or runtime configuration is introduced.

The review checks the metadata reference, receipt fingerprint/schema/flags, row and payload organization/connection, observation/window timestamps, permission validity, current reviewed permission hash, and a scoped source-record fingerprint matching the booking's external reference. A receipt is stale when its observation age reaches the caller's explicit limit or its recorded permission has expired. Future timestamps, altered payloads and malformed receipt shapes fail closed. Empty booking exports cannot validate a shadow record without a matching source record.

Statuses distinguish `missing_receipt_reference`, `receipt_unavailable`, `foreign_receipt`, `stale_receipt`, `invalid_receipt`, `permission_changed`, `permission_not_current` and `record_not_linked`. Cross-organization rows hidden by RLS remain `receipt_unavailable`: the review deliberately does not bypass RLS to reveal whether a foreign receipt exists or disclose its contents. A visible row/payload with a wrong organization or connection is `foreign_receipt`. Legacy records are not backfilled, repaired, deleted or automatically accepted.

Reads are batched, with a maximum 100-booking page and a UUID keyset cursor; there is no per-booking query loop. A truncated page is `needs_review`, and the report supplies `has_more` / `next_after_booking_id`. An empty page is `no_shadow_bookings`, not acceptance. `page_consistent` / `consistent_internal_evidence` describe only the inspected internal evidence. Each page uses its own consistent database snapshot; a multi-page walk is not one historical audit snapshot. Reports contain only own-organization booking IDs and fixed statuses, never raw receipts, grant configuration, tenant IDs or customer records.

Every result keeps `pilot_ready=false`, `provider_requests_allowed=false` and `can_display_available_slots=false`. Internal grant review is pure and separate from the unchanged outbound gate, which still requires exact deployment opt-in before any credential or provider access. This read-only review does not enable that opt-in. Named-club/provider contractual authority, independent complete inventory/freshness rules and protected hosted UAT remain separate pilot gates.
