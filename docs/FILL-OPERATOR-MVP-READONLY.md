# Fill operator MVP — read-only vertical slice

## Factual baseline

- Fill branch base: `platform/v0.4-staging` at `eec5f5d03910959324855bf07ca884b9feb70269`.
- Actual Railway staging Core source: `core/hotfix-booking-confirm-staging` at `0134f603445ea7f282ef0cb866d0f3591518cbb9`.
- The deployed Core contract available to this slice is `GET /api/me`, `GET /api/fmc/organizations`, `GET /api/fmc/{org}/today`, and `GET /api/fmc/{org}/calendar`.
- The later Fill-only opportunity, CRM, attribution, reconciliation and dispute routes present on the platform branch are not assumed to exist on the deployed Core and are not called by this UI.

## Delivered slice

### Stored provider evidence viewer (21 October 2026; Draft source only)

The operator's separate **Provider evidence** tab reuses the review contract from
GetACourt PR #5 at `031878c3ea284b0718793e94ed1f42f572994d5f`, without merging its
worker, activating a provider, or changing the frozen Control Tower.

- Operations-only authenticated GET endpoints:
  `/api/fmc/{org}/provider-provenance/connections` returns only supported connection
  IDs/provider names; `/api/fmc/{org}/provider-provenance/{connection_id}` requires
  explicit `max_age_seconds` (1–31,536,000), bounded `limit` (1–50) and an optional
  UUID `after_booking_id`. The private gateway allowlists exactly these reads,
  never the existing configuration-bearing `/providers` endpoint or a write.
- Owner/admin/manager/analyst only, authenticated RLS and REPEATABLE READ / READ ONLY.
  The reader has no privileged fallback. Foreign hidden evidence remains
  unavailable. Responses contain scoped booking IDs and fixed statuses, never
  credentials, grant configuration, receipt hashes, customer records or raw payloads.
- UI has no default freshness SLA, automatic provider refresh, repair, backfill or
  approval action. Each page has an as-of timestamp, explicit age threshold,
  page-specific status/counts and a bounded next-page cursor. All readiness,
  provider-request and available-slot flags must be explicitly false.
- Changing club, connection, threshold, tab or session clears the report;
  late responses/errors/401s cannot restore old evidence or revoke a newer scope.
  Missing/forbidden/unsupported/invalid reports fail closed with no synthetic
  fallback. Opt-in demo mode explains that provider evidence is absent and
  sends no API requests. TieSports is not supported by this Playtomic report.
- Verification: Node viewer/race/gateway contracts, pure receipt regression tests,
  authenticated API/role/tenant/keyset/READ ONLY PostgreSQL16 tests, and real
  Chromium desktop/320px fixture-only evidence-viewer tests run in Platform CI.

These new Operations routes are **source-only, not deployed to Railway**. A private
frontend draft alone cannot make them available: the old Operations runtime
must display an unavailable report, not fall back or fetch a provider. Actual
protected exact-candidate operator/second-organisation/device UAT, approved
freshness policy, provider entitlement and scoped pilot GO remain separate gates.

The operator workspace renders a signed-in organisation's selected-day Core snapshot:

- Today KPIs: utilisation, confirmed/pending-payment revenue, booking count and empty capacity.
- Court-level utilisation, with uncovered active courts visibly labelled `Needs rate coverage` rather than treated as sellable.
- Read-only recovery candidates derived only from `empty_windows`: duration, 60/90-minute configured starts and the highest configured slot quote.
- Day calendar based on Core booking, active-hold and block records.
- Court comparison of Core totals, sellable-rate coverage and configured-slot quotes.

The workspace contains no UI action or request for a price change, message, CRM action, provider call, hold, booking, payment, settlement or reconciliation change. It labels the staging snapshot as fixture-safe test data until a source is explicitly authorised; a configured quote is not a demand forecast or recovered revenue.

## Acceptance gates

1. `node --check platform/public/fill/app.js` passes.
2. `node --test platform/tests/fill_operator_readonly_contract.test.mjs` passes against a fixture shaped as the deployed Core's `today` and `calendar` responses and asserts GET-only network use.
3. `platform/tests/test_fill_operator_e2e.py` opens the static UI in Chromium, fulfills every API call locally from fixture data, exercises Today, Revenue & Capacity and Calendar, asserts a 1440px visual layout without horizontal overflow, and saves a test screenshot only to the test temporary directory.
4. Platform CI installs Chromium, runs the Core-contract test, fresh PostgreSQL migrations and the browser E2E before release acceptance.
5. A private, non-production preview is optional and must be independently verified private before any operator acceptance. No preview is created by this change.

## Not accepted by this slice

No real club/provider inventory, partner rights, operator identity test, CRM consent, Google OAuth, booking confirmation, provider write, payment, public release, production deployment, or revenue-recovery claim is evidenced here.
