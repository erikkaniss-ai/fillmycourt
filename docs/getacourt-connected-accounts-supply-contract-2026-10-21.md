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


## Phase 1 — isolated fixture-only Connected Accounts UX (22 October 2026)

This Phase 1 **demo-only UX**, not provider activation, lives exclusively at `getacourt/qa/connected-accounts-demo.html`. It is deliberately not linked or loaded by `getacourt/index.html` or `getacourt/assets/app.js`, and is not published into any protected staging/production URL by this source slice.

- The interface draws provider research candidates from `provider-supply-contract.js`: Playtomic, TieSports/TiePlayer, MATCHi, Racket ID and SmashPro. Every provider visibly says **Not verified**, never Connected.
- Two explicit views separate a fictional player-account linking concept from a club-owned supply licence. Switching views resets all in-memory consent demonstration state; neither view can inherit the other's rights.
- Demonstration buttons can mark and withdraw **demo consent only**. They are disabled for club-supply rights; no email, real player ID, passwords, tokens or personal data are collected, no OAuth redirect or booking endpoint exists. Every status retains **NOT connected**.
- The availability result is computed using only an in-memory fictitious plan and the pure neutral `searchAvailableSlots` contract, returning **UNKNOWN / 0 slots / 0 provider requests**, not real club availability or a price quote.
- The page has no form, storage, worker, media, external assets, analytics, integration or network transport. Its CSP sets `connect-src 'none'`, `form-action 'none'`, local `script-src 'self'` and local `style-src 'self'`. CSS is external, not inlined; `noindex` and `no-referrer` are present.
- Native focusable buttons, clear `aria-pressed` single-select states, keyboard skip link, polite status updates, disabled controls and a local consent-withdraw action are present. No provider-owned sign-in or official permission is simulated as completed.

**Verification:** `getacourt/tests/connected-accounts-contract.test.mjs` and `getacourt/tests/connected-accounts-browser.mjs` are mandatory in Platform CI. The integrated, pinned Chromium/axe-core run tests 320/390/768/1440 widths, minimum 44 px provider targets, no horizontal overflow, keyboard interaction, provider transitions, demo consent/revocation and club scope, no invented supply, zero external egress, zero storage and WCAG 2.2 A/AA tag audits. Fixture-only screenshots are uploaded to the existing `getacourt-integrated-fixture-only` CI artifact. Human assistive technology/physical mobile acceptance and real OAuth remain NOT_RUN.

**CSP QA correction:** Initial integrated Chromium at 320 px exposed WCAG target-size errors because `style-src 'self'` correctly refused a previous inline stylesheet. The fix moved all styling to `getacourt/qa/connected-accounts-demo.css` without relaxing CSP and the final integrated browser suite passed 4/4 viewports. Never weaken or disable axe audits to make this demo pass.

To review locally, serve the repository `getacourt/` folder using a loopback static server and open `/qa/connected-accounts-demo.html`. Do not use `file://` as the acceptance reference because of modern script/CSP semantics. This source-only demo is deliberately not registered as a menu item or feature in the consumer application.

**Still gated:** named official player-delegation method, provider-approved availability license for GetACourt, exact club/provider scopes, contract/DPA, token-vault security, expiration/revocation, user consent, real app integration, approvals and hosted physical-device testing. Issue #11 remains OPEN for those stages. No provider account login, external request, vendor contact, credential, production or main merge permitted by this UI.
