# GetACourt — consumer booking platform v0.1

GetACourt is the player-facing discovery and booking product powered by FillMyCourt.

## Product boundary

This project owns the player journey:

`Discover → Venue → Availability → Hold → Checkout → Booking → My bookings`

The FillMyCourt operator CRM, loyalty automation and revenue-recovery UI are deliberately out of scope for this repo phase. The data/event model is designed so those layers can consume booking events later.

## Current implementation

- Responsive consumer web/PWA shell.
- Location, sport, date, time and duration search.
- Results ranked as venue + bookable slots.
- 10-minute booking hold.
- Booking confirmation and lookup API.
- Cancellation API foundation.
- Netlify Blobs persistence for pilot/demo state.
- Browser fallback demo engine so the UI still works when deployed as a static preview without functions.
- Clear `DEMO` labels on non-live inventory.

## Provider architecture

The booking UI is provider-agnostic. Live inventory should be plugged into the availability service through authorised adapters, e.g.:

- FillMyCourt native booking core
- Playtomic club-authorised API/data
- Rocket ID authorised integration
- existing external free-slot finder service

Do not make production availability depend on bypassing provider access controls. If a provider is read-only, GetACourt may show the slot and hand off to the provider's official booking flow.

## Next booking-core modules

1. Transactional database for production concurrency and immutable booking ledger.
2. Stripe/Adyen payment intent + split-payment ledger.
3. Player authentication and portable player profile.
4. Venue policies, pricing rules and cancellation/refund engine.
5. Open matches / join-a-player slot.
6. Waitlist and released-slot notifications.
7. Coaches, lessons, activities and packages.
8. Access-control code adapters.
9. Provider reconciliation / webhook ingestion.
10. Operator-side inventory/rules UI in FillMyCourt.

## Local development

```bash
npm install
npm run dev
```

Netlify Dev serves static files and `/api/*` functions. Non-production Blobs use deploy-scoped storage; production uses a strongly consistent global store.

## Deployment

Use this directory as the Netlify project base directory. The consumer domain should be `getacourt.com`. During staging it may also be served from the FillMyCourt repository without changing the existing FillMyCourt homepage.
