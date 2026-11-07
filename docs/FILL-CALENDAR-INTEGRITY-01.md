# FILL-CALENDAR-INTEGRITY-01 — operator occupancy and rate coverage truth

Scope: isolated Fill branch only, existing read-only Operations GET responses, no new backend endpoint/schema/write API.

## Bug verified against actually deployed Core source
The `GET /api/fmc/{org}/today` Core `sellable_windows` SQL groups 30-minute buckets with matching active court rates. It is a tariff-coverage interval and DOES NOT mean unoccupied sellable capacity. Rate-less active courts can still have historical/active booking records returned by `GET /api/fmc/{org}/calendar`. The earlier Fill UI discarded all courts without rate coverage and drew a booking/hold/block ONLY after a matching rate-covered window. It also drew every Core calendar.booking row as active, including `cancelled` statuses. Both behaviors misrepresent true calendar state and availability.

## Safe source fix
`platform/public/fill/app.js` now always renders every active court returned by Today, not just rate-covered courts. It constructs day-interval event overlays for valid confirmed/pending_payment bookings, active holds, and blocks. Cancelled/failed booking history is never active calendar occupancy. Events take precedence over rate-coverage/background and are clipped to the current Core day bounds, so booking on unpriced court and across midnight appears as an occupied interval rather than disappearing. The grid extent includes active events outside priced hours; unpriced/outside rate intervals remain visually closed and explicitly labeled `No rate`. Background with rates but no active events reads `Rate-covered / unoccupied`, NOT `Guaranteed available` or bookable. Capacity KPI computation still originates from Core; no client-side price writes or native booking authority introduced.

## Test changes
Updated synthetic fixture includes one confirmed booking on rate-less Court C at 07:00–08:30 and one cancelled booking on priced Court A at 14:00–14:30 (must not be counted as active). Updated real Chromium fixture tests for existing Core-shaped API, explicit in-browser synthetic mode, and single-file offline HTML require an occupied cell on unpriced Court C, and exactly six occupied half-hour cells on Court A from its 09:30–12:30 confirmed reservation. Existing GET-only gateway and no-network tests remain. Visual synthetic evidence can be inspected under the `fill-operator-mvp-fixture-only` GitHub Actions artifact at successful SHA.

## Boundaries
Neither real Fill preview nor any Railway service has been deployed/promoted by this code change. A passing CI is not a real account or club. No client contacts, main merge, GetACourt changes, payments, pricing writes or provider integrations. A proper protected preview and authorized test operator identity remain blocked on owner/admin Git/Netlify/Supabase configuration (see Issue #9).
