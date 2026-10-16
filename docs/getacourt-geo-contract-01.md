# GAC-MVP-GEO-01 — Actual near-me radius on existing Core API

Date: 2026-10-16 (source/CI only). Decisions #1-#104 and Get discovery UX unchanged.

## Defect
Get Netlify search forwards lat/lon/radius_km to Core /api/availability. Previously the Core endpoint ignored all three optional query parameters, and the search `location=Current location` was wrongly treated as a city filter. GPS searches could be empty, the 5/10/25/50 km expansion was synthetic, and Core omitted geo coordinates/distance from slot responses. Prior browser QA used local synthetic venue coordinates, so it did not prove real Core behavior.

## Minimal bounded fix
- Add optional lat/lon/radius_km to the EXISTING read-only Core GET /api/availability, maintaining backwards compatible location-text behavior.
- Validate all-or-none GPS coordinates with finite real ranges and positive radius <=50 km; return 422 instead of an unbounded fallback.
- Venue coordinates are ALREADY in `venues.address` JSONB under lat/lon (verified staging fixture); no schema or migration is required. Invalid/missing venue GPS is excluded from GPS results without casting it in SQL.
- GPS search does not apply the old free-text `location=Current location` filter. It calculates Haversine kilometers and strictly filters at each requested radius; adds venue_lat/venue_lon and distance_km to source-derived native slots.
- Existing native-only SQL filters (inventory_mode='native' and native_write_enabled) and all hold/confirm/booking authorities remain exactly as before. No non-native provider data, provider API rights, new country, CRM, PII persistence, SMS, payments or external calls.
- Existing 60/90-minute Get search, distance sorting and map can now consume the same canonical coordinates. No duplicate writer.

## Test and rollout
New PostgreSQL16 migrations-from-zero DB-backed API test seeds three synthetic source venues: near, far and missing GPS. Verifies radius 5 km returns only near, 50 km returns near+far, `Current location` text is ignored only when GPS is explicit, missing/invalid coords are fail-closed, typed Lisbon legacy search and published coordinate fields still work. All fixtures are LOCAL CI DB, not Supabase staging or public sites.

IMPORTANT: source acceptance on Get RC does NOT deploy the Core route to Railway. Actual integration will remain blocked until an authorized coordinated staging Core deploy with release gate, then a non-public E2E. At scale, SQL/PostGIS geo indexes may be required; do not silently add migrations or unbounded provider ingestion. Public getacourt.com and provider connections remain untouched.
