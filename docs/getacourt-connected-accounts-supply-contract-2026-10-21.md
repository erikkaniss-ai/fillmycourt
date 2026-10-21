# GetACourt — Connected Accounts vs Provider Supply, Phase 0 contract

21 October 2026 · Issue #11 · independent source-only Draft PR #5 · NO LIVE ACCESS

## Authoritative product distinction

1. **GetACourt user identity** belongs to our own Supabase session. It is **not** proof that a third-party sports platform has delegated account access.
2. **ExternalAccountConnection** represents a *future* player-approved link with purpose, scoped consent, provider-origin authority, expiry/revocation, data retention and a vault reference managed exclusively server-side. The current pure synthetic contract has NO connected status, external ID, OAuth, vault value or accepted scope.
3. **ProviderSupplyConnection** represents the *different* club-sponsored permission chain: organization, named club, provider contract, separate availability feed entitlement, venue/court coverage, price/benefit visibility, data redistribution rights, freshness and rate/retention policy. Club bookings.read is not availability.read. No player consent creates a club data licence.
4. **Native Core** remains the only native booking writer; provider-origin transactions require explicit separately authorized handoff/delegation. Discovery channels, providers, federations and municipalities cannot create a parallel booking authority.

## Current provider capabilities (research ≠ operating grant)

| Provider | Publicly described surface | Does it grant Get player login or usable availability? |
|---|---|---|
| Playtomic | Official club/chain OAuth client credentials, read-only bookings/payments, usually one API call/minute, no separate sandbox | **No verified player delegation, available-slot feed, or booking writes.** |
| TieSports / TieManager | Public descriptions of club-management API and webhooks | **No verified Get-specific player OAuth, scopes or licensed feed.** |
| MATCHi | Published API catalogue lists facilities, offers, resources and match-related endpoints | **Endpoint documentation is not contractual availability redistribution or approved Get credentials.** |
| Racket ID / Smashpro | Potential Portugal partners for commercial discovery | **Rights remain unverified.** |

Official research: https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide ; https://www.tiesports.com/tiemanager/all-features ; https://docs.matchi.com/ . No credentials, traffic or partnership application were used.

## Neutral future `searchAvailableSlots` interface (not yet implemented live)

`getacourt/assets/provider-supply-contract.js` is a **pure, ephemeral fixture-only model**, not a backend provider adapter. Two distinct branded constructors, `planExternalAccount` and `planProviderSupply`, cannot be interchanged or forged as plain objects. They accept ONLY opaque local references/UTC timestamps. Even after internal research/consent, `provider_authorized=false`, `token_vault_ref=null`, `verified_inventory_scope=false` and `status` not connected/rights unverified.

`searchAvailableSlots(plan, window)` currently returns **only** `unknown`, `slots=[]`, `can_display_available_slots=false`, `provider_requests=0`, `entitlement=unverified`, `data_freshness=unverified`, no price, deeplink, actual timezone or authoritative provider result. It refuses an unissued/forged plan, cross-player/club/org scope, any injected slots, capability flags, provider URLs or token-like fields. UTC window is explicit and limited to 14 days; Lisbon 25 Oct 2026 duplicated local 01:30 must remain two distinct UTC instants rather than a string-local key.

The future **per-slot** schema is explicitly reserved, never populated by this contract: `source`, `club`, `court`, `starts_at`, `timezone`, `price`, `booking_mode`, `last_verified_at`, `data_freshness`, `deeplink`, `entitlement`. Source authority, coverage/completeness, access scope, validity and user-specific prices will have to be proven independently before a real provider adapter is permitted to instantiate any of it.

## Lifecycle / UAT gates

`not_connected` → provider-specific authorization requested → `connected` only with a real signed provider-verified grant and user permission; `expired` / `revoked` / `unavailable` must fail closed, clear private session state and block access. No password collection in GetACourt. Club connections must be authorized separately from player links. No real source polling, booking, payment, OAuth or consumer feature activation is authorized under this design.

Next implementation slice requires approved official provider OAuth/redirect documentation, written availability/redistribution licence, specific test accounts, rate limits + freshness, consent/revocation and an owner activation GO. Until then, no real search results should be displayed as confirmed available.

## CI / isolation

Mandatory Platform CI runs `platform/tests/getacourt_provider_supply_contract.test.mjs` in both fast and full regression jobs. Tests verify actor/organization isolation, unsupported keys/credential rejection, forged plans, no real HTTP/storage, no unlicensed supply, no booking actions, exact UTC/DST preservation and invalid window denial. Protected Get draft remains `[skip netlify]`, no Netlify deployment. Existing production/main, Railway and Supabase configurations untouched.
