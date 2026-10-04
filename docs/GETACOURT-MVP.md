# GetACourt — Player Platform MVP v1

## Product split

- **GetACourt** — consumer discovery and booking experience.
- **FillMyCourt** — operator/revenue infrastructure and the future club CRM/loyalty layer.
- Both are designed to share one booking core and provider-adapter layer.
- FillMyCourt marketing automation, loyalty and operator CRM UI are deliberately **out of scope** for this release.

## Primary consumer job

> “I want to play at a specific time. Show me the useful available courts without making me search club by club.”

The first screen therefore starts with **sport + place + time**, not “choose a club.”

## MVP flow

1. Discover available inventory.
2. Compare venue, distance, duration and total price.
3. Select a slot.
4. Create an 8-minute hold.
5. Choose full-court or split-payment mode.
6. Confirm a preview booking.
7. Retrieve it in My Bookings.
8. Cancel it.

## European benchmark — capability baseline

The functional benchmark covered current racket-sport platforms including Playtomic, MATCHi, Court22, Anybuddy, Padel Mates and Doinsport.

Common player expectations that the booking core should eventually support:

- nearby/cross-venue discovery and real-time availability;
- private court booking;
- online and split payments;
- open/public matches and player matching;
- skill/level data;
- activities, classes, coaches and tournaments;
- memberships, credits/passes and member pricing;
- cancellation/refund policy visibility;
- waitlists and notifications;
- digital venue/access codes;
- sharing, chat and calendar flows.

GetACourt v1 intentionally exposes only the shortest useful path: **discover → slot → hold → booking**. The later capabilities belong in the shared domain model, not in a cluttered first release.

## Architecture

### Frontend

Static, mobile-first consumer web application at:

`/getacourt/`

The GetACourt visual identity is intentionally consumer-oriented and separate from the FillMyCourt operator brand. FillMyCourt appears only as a secondary technology endorsement.

### API boundary

- `GET /api/gac/search`
- `POST /api/gac/hold`
- `POST /api/gac/book`
- `GET /api/gac/bookings?email=...`
- `POST /api/gac/cancel`

### Provider adapter

The environment variable:

`GETACOURT_SLOT_PROVIDER_URL`

can point the search service at the existing free-slot finder/aggregator once its API contract is available.

Optional:

`GETACOURT_SLOT_PROVIDER_TOKEN`

The adapter currently expects normalized JSON:

```json
{
  "venues": [
    {
      "id": "venue-id",
      "name": "Venue",
      "area": "Cascais",
      "distanceKm": 2.4,
      "sport": "padel",
      "indoor": true,
      "tags": ["Indoor"],
      "source": "Provider",
      "slots": [
        {
          "id": "provider-slot-id",
          "date": "2026-10-04",
          "time": "19:00",
          "duration": 90,
          "price": 36,
          "currency": "EUR",
          "status": "available",
          "provider": "provider-key"
        }
      ]
    }
  ]
}
```

Without the provider URL the preview uses **clearly fictional** demo inventory. This prevents GetACourt from pretending to show live club availability before a legitimate source is connected.

## Existing FillMyCourt free-slot finder

The existing FillMyCourt player demo confirms the product direction: white-label club surfaces plus a cross-club discovery network.

The actual live finder source code was **not present in the accessible `erikkaniss-ai/fillmycourt` repository**, so GetACourt v1 does not copy or replace unverified collection/scraping logic. Instead it provides a stable provider boundary so the current developer can expose that capability safely.

## Preview booking state

Preview booking state uses Netlify Blobs:

- hold record;
- slot-hold record;
- booking record;
- slot-booking record;
- cancellation.

This is sufficient for UX/product validation but **not payment-grade concurrency** because Blobs are not a transactional reservation database.

Before real money and real court inventory, migrate holds/bookings to transactional Postgres (or equivalent) with:

- unique provider/date/slot constraint;
- transaction/locking semantics;
- idempotency keys;
- provider booking/reconciliation state.

## Payments

The preview does **not charge cards**.

Production should use a PCI-compliant payment service provider such as Stripe or Adyen with tokenized checkout. GetACourt should store payment/provider IDs, never raw card data.

Split payment is represented in the MVP UI and domain boundary, but settlement/guarantee rules are not yet implemented.

## Production hardening before public paid booking

1. Transactional booking database.
2. Provider-specific booking adapters with idempotency.
3. Provider health checks and reconciliation jobs.
4. Magic-link/account authentication instead of email-only lookup.
5. PSP checkout, webhooks, refunds and disputes.
6. Venue-specific cancellation/refund policies.
7. GDPR consent, retention, export and deletion flows.
8. Rate limiting and abuse prevention.
9. Verified venue/catalog data.
10. Open-match entity and split-payment settlement.
11. Access-code handoff for unattended venues where providers support it.
12. Observability for search latency, failed holds, failed provider bookings and reconciliation drift.

## Product expansion after the booking wedge is validated

### Phase 1 — now
- cross-provider search;
- slot comparison;
- hold;
- booking;
- booking management.

### Phase 2
- real PSP payment;
- provider booking writes;
- identity/account;
- cancellation/refunds;
- saved sports/areas;
- favourites and alerts.

### Phase 3
- open matches;
- split settlement;
- player levels/matching;
- coaching/classes;
- passes/memberships;
- venue access codes.

### Separate FillMyCourt phase
- operator CRM;
- loyalty;
- automated revenue recovery;
- campaign execution;
- attribution;
- club-side revenue intelligence.

That separation is intentional: GetACourt should remain a fast consumer product while FillMyCourt owns the operator economics.
