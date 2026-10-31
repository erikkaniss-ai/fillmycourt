# GetACourt provider-delegated access — official-source research and safe foundation

**Research date:** 20 October 2026 (Europe/Lisbon)
**Scope:** Portugal P0; read-only research and synthetic engineering only.
**Not a provider agreement, security assessment, legal advice, or activation approval.**

## Decision-safe conclusion

This review did not verify a public, player-account delegated OAuth route for GetACourt to connect a player's Playtomic, TieSports/TiePlayer, Racket ID, or Smashpro account and read availability. A player's consent inside GetACourt does not create provider API rights. No provider token, password, cookie, private session, availability request, booking, hold, payment, or external contact is used by this slice.

The immediate technical work is therefore the synthetic `Provider Connection Foundation`, not a visible Connect flow. It records capability states and consent provenance, stays blocked until provider-specific authorisation, and cannot acquire credentials or call a provider.

## Official-source matrix

| Portugal P0 route | Verified public evidence | Player-delegated OAuth / availability read | Commercial and authority implication | Current classification |
| --- | --- | --- | --- | --- |
| Playtomic / Playtomic Connect | [Playtomic API guide](https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide) says the API is read-only for club booking/payment data; eligibility is club plans or chain owners; credentials are client ID/secret and short-lived access token. [Playtomic Connect](https://playtomic.com/connect) requires application, technical assessment, legal agreement and onboarding for certified partners. | No public player-consent OAuth flow or availability endpoint was verified. The cited API guide documents bookings/payments, not live available slots. | Start only with a consenting eligible club/chain or a Connect certification/application; obtain exact permitted endpoints, data fields, limits, DPA and retention terms in writing. Published price/onboarding fee: not found. | **Club/partner read route verified; player account link and availability route unverified.** |
| TieSports / TieManager / TiePlayer | [TieManager features](https://www.tiesports.com/tiemanager/all-features) advertises an Open API and webhooks for custom integrations, as well as booking and player operations. | No public OAuth, scopes, rate limits, availability endpoint, player-delegation flow, or pricing documentation was found. | Ask TieSports for a club-sponsored API contract and a sandbox only after owner approval. Do not infer that “Open API” authorises player linking. | **API surface advertised; exact authority/capabilities unverified.** |
| Racket ID | [Racket ID](https://racket.id/home) describes player booking and club booking/payment operations. | No official developer API, OAuth, availability-read, scope, rate-limit or partner-program documentation was found in this research. | Treat as provider-contract-required. Deep-link/handoff is not assumed until the provider confirms a stable approved route. | **Unverified.** |
| Smashpro | [Smashpro club page](https://smashpro.pt/en/for-clubs/padel-clubs) documents online booking, in-app payment and billing integration. [Pricing](https://smashpro.pt/en/pricing) shows Starter at €56/month annually and Pro at €120/month annually, excluding VAT, plus 2.5% + €0.25 online-payment fee. | No official developer API, OAuth, availability-read, scopes, rate limits or partner agreement was found. | Product pricing is not API pricing and is not authority to connect player accounts. Provider agreement and technical documentation are required. | **Commercial product visible; integration route unverified.** |
| Native/manual club infrastructure | No common provider identity or delegated account exists by default. | Not applicable for player-provider OAuth. Availability can only be represented after a club supplies an authorised source contract, freshness rule and handoff/booking authority. | Start with a club-approved manual/managed source or official booking handoff; never manufacture availability from phone, WhatsApp or social messages. | **Possible club path, but no automatic connector.** |

## Integrator assessment

The official sources confirm two direct, provider-governed paths: Playtomic Connect/club API and TieSports' advertised club API/webhooks. This research did **not** identify a multi-provider intermediary with public, provider-issued proof of authority across the Portugal P0 pack. That is not proof that none exists; it means no intermediary should be treated as approved until it provides, for each provider:

1. a named provider agreement or verifiable certification;
2. written scope for discovery/availability, handoff and every write separately;
3. token/secret ownership, rotation, revocation and incident process;
4. DPA/subprocessor, GDPR data-controller/processor roles and data-location terms;
5. rate limits, freshness SLA, outage behaviour and audit export;
6. Portugal venue coverage, pricing/onboarding terms and a sandbox.

An aggregator may reduce engineering only after this evidence. It cannot turn user consent into a provider entitlement.

## Implemented synthetic foundation

`getacourt/assets/provider-connection-foundation.js` is intentionally transport-free. It contains the Portugal P0 capability registry; models an opaque internal consent proof for `availability.read`; creates only `synthetic_read_only` / `not_authorized` connections; returns a blocking authorisation plan; and records a local synthetic disconnect event. It has no UI entry point, endpoint, persistent storage, OAuth handler, token input, scheduler, fetch, provider write or booking route.

The contract test asserts those limits, including rejection of credential-shaped input and any scope other than availability read. This keeps existing Google sign-in separate: Google authenticates a GetACourt player, while provider delegation would require an independent provider-specific grant.

## Architecture and activation sequence

1. Keep Get identity separate from provider identity. A future server-side provider connection record must use internal opaque references, consent proof/version/time/jurisdiction, provider/account authority, capabilities, freshness, rate-limit state, audit trail and revocation status.
2. For a named provider, collect official documentation and owner approval before adding any redirect, OAuth/PKCE, server token vault, read adapter, source mapping or UI entry point.
3. Add one provider only after the evidence verifies `account_link_supported` or an alternative club/partner read route. Keep `availability.read`, handoff and native booking as independently verified capabilities; default every write to false.
4. Run only against a protected preview after the authorised contract and owner GO. Test disconnected, expired/revoked consent, rate-limit/backoff and stale-data handling before displaying results.
5. Preserve Core as the sole booking authority. Any provider handoff or authoritative confirmation must be source-observed; no click or synthetic fixture implies booking success.

No new Product Decision is proposed for this foundation because it implements the existing capability, consent, source-authority and staged-activation constraints in Decisions #21, #22, #23, #31, #96, #97, #98, #101 and #104. A new Decision ID and owner approval are required before activating a real player-account link or changing booking authority.
