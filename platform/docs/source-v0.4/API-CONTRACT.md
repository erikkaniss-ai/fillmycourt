# Shared platform API and provider contract v0.4

This is the contract implemented in `fmc/app.py`, not an external provider's undocumented API.
All mutation requests use HTTPS in production, host-only session cookies, an exact configured
Origin and `X-GAC-Request: 1`. IDs in paths never authorize access: authenticated venue
membership and required role are checked. Unknown inputs are rejected. No caller-supplied
price can replace the server quote. JSON errors include `error` and `message`.

## Identity / player

| Method | Path | Use |
|---|---|---|
| GET | /api/config | Public capability flags; never secrets |
| GET | /api/auth/google/start | Start real code/PKCE OAuth |
| GET | /api/auth/google/callback | Server code/token verification |
| GET | /api/auth/apple/start | Start real Apple sign-in |
| POST | /api/auth/apple/callback | Validated form_post callback |
| GET | /api/me | Current verified account or null |
| PUT | /api/me/profile | Persist profile and versioned terms acceptance |
| POST | /api/auth/logout | Revoke session |
| GET | /api/availability | sport, date, time, end_time, duration, location, radius, indoor, lat, lon, sort |
| GET | /api/quote | court_id, date, time, duration → price/policy from authoritative inventory |
| POST | /api/holds | court_id/date/time/duration; Idempotency-Key required |
| POST | /api/bookings/{id}/confirm | participants/accept_policy/payment=venue; Idempotency-Key required |
| GET | /api/bookings | Current player's records, after/limit |
| POST | /api/bookings/{id}/cancel | Policy-checked owner cancellation |
| GET | /api/bookings/{id}/calendar.ics | Authenticated owner's calendar record |

A hold is not a paid booking. An HTTP timeout is not confirmation. Retrieve/retry using the same
operation idempotency key according to the endpoint semantics; never synthesize a second success
client-side. Only local GetACourt favorites use browser storage; booking records do not.

`POST /api/holds` example:

```json
{"court_id":"AUTHORIZED_COURT_ID","date":"2026-11-02","time":"18:00","duration":90}
```

The example ID is an explicit placeholder. This request must not be issued to a real court without
the player's authorization. The amount, cancellation policy and availability are computed server-side.

## Club workspace

All following paths, except initial club creation/list, are under `/api/fmc/{venue}`.

| Method | Suffix | Required role / purpose |
|---|---|---|
| GET / POST | /api/fmc/clubs | List own memberships / create private unverified club |
| GET | /gates | Cutover prerequisites |
| GET | /calendar?date=YYYY-MM-DD | Canonical bookings and blocks |
| POST | /courts | Owner/manager; create disabled external court |
| PUT | /courts/{id} | Owner/manager; prospective price and rule changes |
| POST | /reservations | Owner/manager/staff; shared-engine reservation for a local contact |
| POST | /reservations/{id}/cancel | Owner/manager; reviewed native cancellation |
| POST / DELETE | /blocks ; /blocks/{id} | Maintenance block and unblock |
| POST | /mappings | Exact provider external court → local court |
| GET | /contacts?q=...&after=...&limit=50 | Tenant-qualified indexed directory |
| POST / GET | /imports | Stage bounded customer CSV / inspect batches |
| POST | /imports/{id}/commit | Atomic import after validation |
| POST | /imports/{id}/rollback | Owner; only unchanged, unused imported rows |
| POST | /snapshots/{provider} | Ingest immutable normalized source evidence |
| GET | /snapshots | Source list and provenance |
| POST | /snapshots/{id}/baseline | Owner/manager; seed shadow mirror, not public sales |
| POST / GET | /reconciliation | Queue run for snapshot / list runs |
| GET | /issues | after/limit/run filtered differences |
| POST | /issues/{id}/review | Acknowledge, assign, propose exception, second-person approval |
| POST | /reconciliation/issues/{id}/source-sync | Propose/approve exact shadow-source repair |
| GET | /reconciliation/{run}/export.csv | Role-checked, spreadsheet-formula-escaped report |
| POST | /money-events | Owner/accountant; immutable evidence observation |
| GET | /settlement?batch=... | Per-currency evidence comparison |
| GET | /payment-reports ; /payment-reports/{id} | Minimized provider reports; no invented booking mapping |
| PUT | /integrations/playtomic | Owner; trusted venue-bound credential reference |
| GET | /integrations | Source state |
| POST | /integrations/playtomic/sync | Queue bookings / players / payments sync |
| GET / POST | /jobs ; /jobs/{id}/retry | Inspect work / replay dead-letter with role check |
| POST | /courts/{id}/activate | Owner; verified single-authority cutover evidence |
| POST | /courts/{id}/pause | Owner/manager; pause new sales without erasing bookings |
| GET | /audit | Immutable event history with bounded pages |

Profile fields: display_name, city, sports, skill_level, locale, marketing_opt_in,
accept_terms, terms_version. Club creation fields: organisation, name, city, lat, lon,
timezone, indoor. Creation is not proof the user owns a venue. Activation requires trusted
administrative verification plus snapshot/cutover controls.

Customer CSV schema and examples are validated by `Operations.stage_contacts`; use the
workspace's documented headers: external_id,name,email,phone,consent,consent_proof. Do not guess a provider CSV layout. Granted marketing consent requires
source proof. Imported contacts are scoped to a club and do not create authenticated players.

## Normalized source snapshot

`Snapshot` input contains window_start, window_end, observed_at (timezone-aware ISO timestamps),
complete, source_ref, and up to 5,000 normalized records. Required/optional record fields and
allowed statuses are enforced by `Reconciliation.ingest`; refer to tests for exact examples.
Use a complete snapshot only after every provider page is successfully retrieved. Partial
snapshots cannot establish that a missing record was cancelled. Unmapped courts block baseline.

Important normalized fields: external_id, court_external_id, starts_at, ends_at, status,
total_minor, currency, paid_minor, refunded_minor. Unknown monetary values remain unknown;
never convert unavailable payment data to zero or infer it from CONFIRMED status.

Source repairs use issue version and a review note. The proposer and approver must differ.
Only the latest complete fresh source with an actual matching record can repair an external
shadow booking. Historical run outcomes remain historical; a new run proves a match.

## Financial evidence

Observation kinds are capture, refund, fee, payout_expected and bank_credit. Each observation
has venue, source, external_id, amount_minor, currency, evidence_ref and an optional booking_id
or settlement batch. Repeated source+external_id is idempotent only if the payload agrees.
Positive amounts plus explicit kinds avoid ambiguous sign conventions in the internal ledger.
Provider feed signs are preserved separately until explicitly mapped.

No live bank account, payment processor or automatic book-to-payment identifier is assumed.
Playtomic Payments documents paid/refunded records and payout references but not a guaranteed
booking_id. Raw/minimized feed ingestion is implemented; exact linking/posting requires
account-specific evidence or a documented mapping. Similar name/amount/time is not sufficient.

## External finder: separate future adapter

Do not move `app.fillmycourt.com` or duplicate its scraping. Its developer should expose an
**authorized internal read contract**; this is proposed, not a live endpoint that was discovered:

Input: sport, latitude, longitude, radius_km, date/timezone, earliest_start, latest_end,
duration_minutes, optional filters and request_id.

Output: request_id, completeness, provider status list, observed_at/expires_at and offers.
Each offer must include stable provider/venue/court/offer IDs, exact UTC interval, local timezone,
currency, integer total price including clearly described fees, source freshness, booking_mode
(`handoff` or `native_authorized`), approved booking URL when applicable, authorization reference
and optional capability flags.

Do not merge different providers' court IDs merely by matching venue names. Do not relabel
unknown freshness as live. A handoff source cannot create a GetACourt hold. Validate redirect
hosts against approved provider hosts; never expose an unrestricted URL-fetch proxy.

An authorized write adapter requires quote/revalidate, provider hold/expiry, create with a stable
idempotency key, authoritative lookup and cancellation/refund contract. Timeouts become pending
reconciliation. Webhooks require provider signature/replay verification. This release contains
**no such live external write adapter**; it owns native FmC inventory only.

## Service boundary

Player API, operator API, sync worker and event projector deploy from the same versioned image.
They share the canonical schema. API calls do not synchronously call workers or provider APIs
while holding inventory locks. Version provider schemas, preserve evidence and use checkpointed,
bounded sync jobs. Initial bootstrap migrations are explicit operator steps, never automatic
schema destruction on API start.
