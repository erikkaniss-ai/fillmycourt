# GetACourt Connected Accounts — authorization and native-first launch

22 October 2026 · Issue #11 · source-only technical and partnership readiness brief

## Decision

Do not make the Portuguese launch dependent on undocumented universal player OAuth or a scraped Playtomic slot feed. Prioritize **club-authorized native FillMyCourt/Core inventory**, with a single booking writer and named club permission. Separately seek licensed provider availability and handoff rights through approved integrations. This follows owner Decisions #21, #22, #31, #54, #97–#101 and #104; it does not amend them or grant pilot GO.

## Verified facts versus missing authorizations

| Candidate | Public evidence | Rights NOT established |
| --- | --- | --- |
| Playtomic Club API | Named club/chain OAuth client credentials, read-only bookings/payments, roughly one call per minute, short-lived bearer and no sandbox | Player-delegated Get OAuth, complete unoccupied-court inventory, price/redistribution license or booking writes |
| Playtomic Connect | Certified partner application, security/technical qualification, legal contract and partner distribution inside Playtomic Manager | Automatic right to operate a competing consumer availability marketplace |
| TieSports/TieManager | Advertises club integrations, open API and webhooks | Exact Get-specific player scopes, available-slot API or resale/redisplay license |
| MATCHi | API catalogue lists GET facilities/offers/resources and some user/match operations; also an order POST | Permission to use APIs or redistribute bookable times/prices; mere documented GET endpoints do not establish a grant |
| Racket ID and SmashPro | Portugal-market candidates | Official approved Get API scopes or licensing terms |
| Native Core | Product already models courts, capacity, rates, holds, blocks and authoritative native booking writer | Club agreement, correct rates and availability, tenant test identities, cutover authorization and pilot GO |

Primary references: https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide ; https://helpmanager.playtomic.com/hc/en-gb/articles/47390286355089-Third-party-integrations-and-Playtomic-Connect ; https://playtomic.com/connect ; https://www.tiesports.com/tiemanager/all-features ; https://docs.matchi.com/ .

**Never infer free slots by subtracting read-only booking events from an assumed schedule.** Court closures, private blocks, gaps, cancellations, tariff coverage, completeness, freshness and source rights remain unknown.

## Permission lanes

1. `club_native`: named club authorizes FillMyCourt Core as the **sole native booking writer** and separately grants Get listing/distribution rights. Get reads native availability only after signed club authority, verified all-court coverage, prices, open/blocked intervals, timezone, freshness, tenant isolation and explicit owner staging/pilot GO. This lane requires no foreign provider OAuth token.
2. `external_club_supply`: named club plus platform provider must approve actual `availability.read` (not merely `bookings.read`), venue/court and user-price coverage, licensed Get data redistribution, acceptable refresh/rate limits, DPA, vault, revocation and booking handoff. External provider remains authoritative for its own bookings. One external club credential does not authorize other venues.
3. `external_player_account`: an official player-delegated OAuth route, exact user consent, allowed scopes and per-user pricing/handoff rights. Get sign-in is NOT provider sign-in. User consent does not grant club-wide supply; a club contract does not authorize a player's profile.

Municipality/federation/hotel distribution must never create another booking writer. Suggested Watch and home-market notifications require their own consent. Source and tenant provenance must be retained, as in Decisions #31, #54, #99, #101 and #104.

## Token broker / VaultPort security design — NOT implemented live

Proposed server-only boundaries: `ProviderAuthorizationService` verifies original provider and club agreements, delegated authority and consent; `ProviderTokenBroker` evaluates exact tenant/actor/purpose/scopes, expiry, revocation epoch and rate budget for every request; `VaultPort` stores/retrieves an opaque secret handle for the worker only; provider-specific read-only adapters call approved routes and return provenance/freshness-labeled observations. The native Core adapter needs no foreign OAuth vault.

- Never place API keys, client secrets, refresh tokens, authorization codes, session cookies or bearer tokens in public JS, URLs, browser storage, analytics, GitHub, logs, PR comments, or public/RLS-exposed database tables.
- Separate club-level static keys from per-player refresh tokens. Prefer audited managed KMS/envelope encryption for delegated tokens; consider Supabase Vault only after a targeted security review and strictly server-side access. Vault encrypts at rest, but its `vault.decrypted_secrets` SQL view exposes plaintext to SQL roles with privileges: do not grant `anon` or `authenticated` decryption access.
- Never treat Supabase browser-editable `user_metadata` as rights, never expose a service role key. Require independent provider-original evidence/contract review and verified server-side grants; no client-manifest booleans can mint a permission.
- Rotate on refresh with version/epoch fencing; block stale asynchronous responses after revoke or owner switch. If a provider has no revocation endpoint, report **local revocation only**. Invalidate cached tokens, prevent races, audit read attempts without credential contents, and bound retries/rate per vendor.
- Minimize GDPR/PII, define retention/deletion and opt-out, validate user-specific price visibility, consent to redistribution, DPA and EU residency where relevant. Keep cross-tenant references inaccessible.

Vault references: https://supabase.com/docs/guides/database/vault ; pgsodium deprecation guidance https://supabase.com/docs/guides/database/extensions/pgsodium . Supabase Vault is not automatically a per-user consent manager.

## Source-only preflight, fail-closed

`getacourt/qa/connected-accounts-activation-gate.mjs` contains lane-specific lists of required source documents and strict ownership / UTC review window / SHA / opaque reference validation. It only evaluates **declared presence**. Even a complete fictional set of references returns `DECLARED_READY_FOR_ORIGINAL_EVIDENCE_REVIEW` with authority_verified=false, execution_enabled=false, may_fetch_provider=false, may_access_token_vault=false, may_publish_slots=false, may_confirm_booking=false. Declared references cannot be independently verified from a browser input. A subsequent authenticated server-side original-document verifier, partner contract and explicit owner GO must precede a live adapter. `planVaultAdapter` is an inert design record, not a secret-storage implementation.

Mandatory CI tests: one-by-one missing evidence for each lane, native path without unrelated provider keys, Playtomic bookings-only insufficient, cross-org / player-vs-club rejection, PII/secret/extra-field injections, stale/future/ambiguous Lisbon DST windows, forged complete manifests, vault disabled and zero external transport. Do not drop existing PostgreSQL16/Chromium/accessibility suites.

## Partner/club diligence questions (PREPARED, NOT SENT)

For provider: (1) Does a partner-approved Get player OAuth flow exist, with exact allowed scopes, redirect and revocation? (2) Is full per-court availability, closures and prices available and current? (3) May Get present/cache it in a consumer marketplace, including membership prices, under what duration? (4) What are per-club grants, SLA/rate limits, security assessment, token lifecycle, DPA, EU residency and fees? (5) Can bookings be handed off to an official URL, and is authoritative conversion confirmation allowed? (6) How does a club opt out or suspend?

For named native club: signed Fill/Get distribution and sole writer authority, complete venue/court/rate/block schedules, emergency pause and cancellations, no false confirmed slots, source freshness, GDPR, two-org test identities, club pilot limits and commercial economics. Under the Olsen Steiner opportunity protection policy, secure contractual protection before named introduction.

**No provider outreach/application, OAuth, real account, booking/hold/payment, token storage, production or public deployment was performed.**

## Closeout and execution gates

Phase A (this bounded task): code + negative CI + source docs and partner questions, all completed when exact-head CI passes. Phase B: after club owner GO, native/Core hosted two-org availability acceptance (not yet done). Phase C: independent Playtomic Connect/TieSports/MATCHi written data rights (not yet granted). Phase D: verified secure server vault and OAuth/delegation with separate activation GO and physical device UAT. Issue #11 remains OPEN for actual provider integrations even if Phase A is accepted.