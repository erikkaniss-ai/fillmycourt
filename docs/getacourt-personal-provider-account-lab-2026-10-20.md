# GetACourt × Player Account Test Lab — 20 October 2026

## Owner instruction and boundary

Owner authorised future manual testing with **his own personal accounts** in **Playtomic** and **TiePlayer/TieSports**. The owner can sign into the provider's official app or consent on an official provider authorization screen when an actual supported integration is documented.

This is NOT permission to store provider passwords/cookies, reuse a private session, scrape undocumented APIs, impersonate the provider client, trigger a booking/payment or transfer other players' data. Approval of a real account connection still requires documented provider-issued delegation, requested scopes, consent/revocation and separate GO for the live integration.

## Verified official access paths

- [Playtomic club Third Party API](https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide): club/chain Client ID + Secret read-only bookings and payments, not player-delegated OAuth. No independently verified full availability feed. Usual rate limit one request/minute; club plans/chain eligibility and no separate sandbox.
- [Playtomic Connect](https://playtomic.com/connect): certified partners apply, undergo technical/legal onboarding and receive official, scoped club access. Owner's player login is not an alternative to certification.
- [TieManager Open API/Webhooks](https://www.tiesports.com/tiemanager/all-features): official club custom integration capability advertised. [TieManager plans](https://www.tiesports.com/pt/tiemanager) advertise API on Master; no public proof of player-delegated OAuth, player account tokens/scopes or availability feed.
- [TiePlayer official app](https://www.tiesports.com/tieplayer): can be used manually by the account owner for observing the user-facing flow; no private network inspection, account session replay or third-party API calls before separate official rights are confirmed.

## Delivered nonproduction foundation

Source: `getacourt/assets/provider-account-test-lab.js`.

- two named provider entries; both `player_delegated_oauth: unverified`;
- internal opaque participant/consent/test references and UTC consent time, without names, login IDs, email, phone or secrets;
- human owner sign-in is represented as a **separate independent action in the official app**, never as an authorized GetACourt API read;
- readiness gates remain blocked until official player delegation is verified;
- explicit internal consent withdrawal; this is **not** an external provider token revocation;
- all output denies OAuth launch, session inspection, private account data retrieval and live availability.

Unit contracts: `platform/tests/getacourt_provider_account_lab.test.mjs`, registered in fast/full Platform CI. Tests use synthetic values only; no user login, external request, API credential or provider session is handled. The existing Provider Connection Foundation remains separate and read-only.

## Next implementation when official provider grant exists

1. Get the provider's public developer documentation and an authorization-code+PKCE capability (or documented alternative) with an explicitly registered callback, exact scopes, provider identity, expiry/revocation and test environment. If there is no supported player grant, remain blocked and pursue a club/Connect route instead.
2. Server-only state/PKCE/CSRF/callback validation, nonce and one-use replay protection; never process account passwords or raw session cookies. No tokens/client credentials shipped to frontend.
3. Server token-vault service with explicit identity/provenance, encryption, rotation, disconnect and audit; no persistence/remote connectivity until authorized production-like pilot.
4. Separate capabilities and provenance for `account_link`, `availability.read`, `club_bookings.read`, handoff and writes. No available-slot inference from club booking data.
5. Protected preview test with owner performing personal login *on official provider screen*, opt-in to exact read scopes and confirm disconnect. Zero payments/booking writes. Review actual permission scopes and logs before GO.

## External approval still needed

For Playtomic: official player-grant documentation/approved partner path; for TieSports: documented player delegation API or a club-authorised alternative. Both require specific commercial/legal rights; own-player consent alone is insufficient. Existing Decisions #1–#104 remain unchanged.
