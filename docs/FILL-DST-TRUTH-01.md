# FILL-DST-TRUTH-01 — absolute operator calendar across Lisbon clock changes

Scope: isolated FillMyCourt read-only operator UI and synthetic tests, no Core/DB/provider writes.

## Factual problem

Staging Operations GET /api/fmc/{org}/today exposes authoritative day_start and day_end ISO instants plus actual sellable_windows starts_at/ends_at. The previous Fill Calendar converted timestamp events into local wall-clock minutes in [0,1440]. In Lisbon, March 29, 2026 has 23 elapsed hours (DST advance), and October 25, 2026 has 25 elapsed hours (DST fallback). In the repeated autumn hour, a booking spanning 2026-10-25T01:30:00+01:00 to 2026-10-25T01:30:00+00:00 has 60 minutes of occupancy despite identical written local times. The old client mapped start and end to the same local minute and silently removed it. Rates and events cannot be reconciled from wall-clock coordinates alone. Selecting the UTC date could also lag Cascais/Lisbon date during summer time.

## Safe fix

- Date selection uses Intl.DateTimeFormat for Europe/Lisbon, not the UTC date.
- Calendar x-axis uses absolute UTC half-hour slots from Core day_start to day_end, yielding 46, 48, or 50 cells (23/24/25 hours).
- Axis ticks show Europe/Lisbon time and UTC offset on DST-change days, distinguishing both occurrences of 01:00 in autumn.
- Keep existing policy: active confirmed/pending_payment bookings, holds and blocks overlay tariffs; cancelled/failed history does not occupy capacity; all active courts remain visible even without rate coverage; clip cross-day events against actual UTC bounds.
- Match rate-coverage windows using actual Core starts_at/ends_at when provided; retain minute fallback only for synthetic or older fixtures. A tariff-covered unoccupied cell is not guaranteed bookable inventory.
- Fix synthetic fixture UTC offsets at midnight on transition days. Previous synthetic demo used midday UTC offset to render midnight and incorrectly made DST bounds 24 hours.
- No provider write, new API, schema, Netlify site, tokens, customer messages, production merge or GetACourt changes.

## Release evidence

New Chromium test platform/tests/test_fill_calendar_dst_e2e.py exercises both DST dates with strictly local GET-only Core-shaped responses. Assertions: 50 cells on Oct 25, 46 on Mar 29, exactly two booked half-hour cells for a synthetic one-hour booking in both, distinct 01:00 UTC+1 and 01:00 UTC+0 labels in autumn, no nonexistent 01:00 in spring. Node fixture test validates elapsed day lengths and rejects nonexistent synthetic calendar dates. Source is accepted only once a GitHub CI run completes successfully on the exact SHA.

This work is source/fixture-only. Existing protected Netlify fillmycourt-preview still hosts the old manual deploy, not this UI; Supabase staging has no Auth users or organization memberships. True operator acceptance remains issue #9.
