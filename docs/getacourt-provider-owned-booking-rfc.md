# GetACourt — Provider-owned booking architecture (RFC)

**CTO working architecture, 15 October 2026.** User instruction: prioritize booking through clubs' EXISTING systems, especially Playtomic, with GetACourt as cross-provider discovery/player acquisition. This clarifies the transaction authority split and must not silently modify Immutable Product Decisions #1–#96 or authorize public deployment.

## Non-negotiable technical facts

* A PWA executes in the actual player's browser, but direct JavaScript requests to competing domains are governed by same-origin/CORS, session and anti-bot protections. `fetch(mode:"no-cors")` returns opaque responses and cannot read available courts. Browser storage and provider credentials are not shared simply because a user has installed GetACourt.
* Provider top-level navigation, initiated by the real user, is distinct from server bot automation. The player interacts on the provider's own first-party origin under the provider's auth/payment/policy. Opening its official booking page is viable without impersonating an automated client.
* Playtomic's **Third Party API** is documented read-only for club bookings/payment data, not an open player-facing slot-search-and-create API (https://helpmanager.playtomic.com/hc/en-gb/articles/38836515997073-Playtomic-API-Complete-Guide).
* Playtomic documents club-controlled white-label booking at `https://playtomic.io/wl/{tenant_id}`, with required website origin configured by the club (https://helpmanager.playtomic.com/hc/en-gb/articles/29889024973841-How-to-Embed-Your-Club-s-Playtomic-Booking-Page-Correctly). Do **not** assume embedding works from GetACourt's domain; partner/club authorization and browser test are mandatory.
* Playtomic publicly warned on 2 Oct 2026 that unapproved third-party automations can stop working (https://helpmanager.playtomic.com/hc/en-gb/articles/47390286355089-Third-party-integrations-and-Playtomic-Connect). Do not base an MVP on bypassing protective controls via IP/user-agent/fingerprint spoofing or automated interaction with blocked endpoints. Apply to https://playtomic.com/connect for official access.

## Correct booking ownership model

**Discovery aggregation belongs to GetACourt**, but **booking authority remains with whichever provider manages that particular club/court**:

1. `directory_only`: verified real venue and coordinates, no claims about times/price, no booking CTA unless a verified official booking URL is available.
2. `provider_handoff`: GetACourt shows verified club listing and invokes explicitly **user-initiated** HTTPS navigation to the provider's confirmed booking page/app. Authentication, payment, booking creation, cancellation and final receipt belong to provider, not GetACourt.
3. `provider_hosted_checkout`: provider-approved and browser-tested white-label/iframe or partner-hosted checkout. Provider remains sole booking writer; detect and handle blocked embeds/third-party cookie limitations, fall back to top-level navigation. Do not read embedded DOM or provider session from GetAcourt JavaScript.
4. `authorized_provider_api_booking`: only with written API/write authorization, documented idempotency, authenticated player identity, availability freshness and final provider confirmation. Not available via current Playtomic club Third Party API.
5. `core_native`: only for clubs that explicitly adopt our own Native Booking Core. Core is exclusive booking writer for these bookings, not a competing writer for Playtomic-managed courts.

**One authority per booking**; no second confirmation inside GetAcourt when provider checkout owns it. Redirect click and opening checkout are NOT a confirmed booking and NOT earned revenue.

## Search and availability source separation

GetAcourt club catalog: venue_id, name, location, coordinates, sports, provider IDs, source/license and verification timestamp. Availability layer: court/slot, authoritative source, observed_at, source booking capability and provider freshness contract, verified price & cancellation-policy link. Nick's candidate search connector can enrich catalog; it does NOT acquire unavailable provider slots or prove any booking merely by imitating a browser.

No slots may be shown as “available” from guessed open hours, scraped occupancy, 1/minute read-only club bookings snapshots, or stale uncontrolled provider outputs. If live provider availability is not available, return a **club card only** and verified official “Continue on provider” CTA.

## Mobile PWA flow

GetAcourt → real verified club search / distance → club with source badges → (if authorized live slots exist) select slot; otherwise club-level action → **Continue booking in Playtomic/other booking platform** → provider first-party flow (user's own session/login) → provider confirmation.

Do not silently launch dozens of partner pages or scrape them from PWA. User consent and provider policy apply. GetAcourt can store click-through source, but may assert booking success only via permitted provider callback/reconciliation.

## Implementation milestones

**A — launch-safe:** normalize verified real club catalog and confirmed provider booking pages (not generic homepage), distance sorting; provider-owned top-level handoff; hide inoperable GetAcourt payment, phantom booking CTA, test inventory.

**B — partnership:** pilot official provider-hosted checkout via consenting club and confirmed website/domain support; legal/technical authorization, mobile Safari/Chrome tests.

**C — direct integrations:** qualify Playtomic Connect and other provider-specific partner APIs, provider event/confirmation contract; allow native write only on explicitly approved providers.

**D — Nick:** obtain his source/endpoint/network trace, permitted data origins, observed behavior, coverage, freshness, terms and fallback; evaluate as optional discovery provider without unauthorized anti-bot circumvention.

**Gate:** user approval is required to publish getacourt.com or enable any live booking, payment, provider write, or new paid services. Do not amend immutable Product Decisions #1–#96 without a distinct decision update.
