# FILL-PRIVATE-PREVIEW-02 — verified staging operations route and release contract

Source-only checkpoint: 16 October 2026. This document is not a deployed-site acceptance report.

## Real staging verification
GET /api/health on fmc-core-api-staging.up.railway.app returns service=core; fmc-operations-api-staging.up.railway.app returns service=operations.
Anonymous GET /api/fmc/organizations returns 404 on Core and 401 on Operations. Anonymous GET /api/me returns 401 on both. Hence the Fill operator UI must connect to Operations, never Core for its organization/today/calendar data. A green Core-shaped fixture CI alone did not establish this.

## Independent private site perimeter
An existing, unrelated-to-production Netlify project fillmycourt-preview (site d763b7a1-dccd-4638-8876-ac1670171698) now has site-wide Netlify Team Login (whichProjectsRequireSSOTeamLogin=all), confirmed with Netlify readback. Anonymous HTTPS GET https://fillmycourt-preview.netlify.app/ returned 401; independent public https://fillmycourt.com/ continued responding anonymously. Existing preview deployment 6aaddfcefc3faf16a799bed2 is an OLD manual/API deploy, not operator MVP. NO Fill PR #8 runtime deploy is claimed.

## New source-only deployment adapter
platform/netlify.toml is exclusively a Netlify site base-directory=platform configuration; it publishes platform/public and loads platform/netlify/functions, includes restrictive CSP, noindex/no-store and redirects root to /fill/. It does NOT modify repository-root netlify.toml for public fillmycourt.com.
platform/netlify/functions/fill-operator-readonly.mts is a fixed-host Operations gateway exposing only GET /api/me, GET /api/fmc/organizations, GET /api/fmc/:org/today?date=YYYY-MM-DD, GET /api/fmc/:org/calendar?start=ISO&end=ISO. It rejects writes, other paths, malformed UUID/query, missing Bearer, cross-origin browser Origin headers, redirects, oversize/non-JSON responses, and any Operations host mismatch. Bearer JWT is forwarded ONLY to the actual Railway Operations API and verified there; no service-role token, provider API or server-side privileged account; no cross-origin CORS or caching. No booking, CRM, pricing, payment or reconciliation writes are reachable via this gateway.
Backend address uses site-scoped Functions env FILL_OPERATIONS_API_BASE with exact value https://fmc-operations-api-staging.up.railway.app. Attempted configuration via Netlify tool returned 'Environment variable upserted' but immediate getAllEnvVars readback was empty; therefore the variable is NOT VERIFIED/PUBLISHED, and no claim of working hosted gateway is made.

## Browser QA artifacts
Existing local-only Chromium fixture acceptance now saves four explicitly synthetic screenshots (Today, Revenue & Capacity, Calendar desktop and Calendar 390px). GitHub Platform CI uploads them as Actions artifact fill-operator-mvp-fixture-only, kept seven days. This is inspectable design evidence, not evidence of a live venue, hosted operator session or production booking authority.

## Completion checklist (owner-gated, not done)
1. Connect EXISTING protected site fillmycourt-preview to branch fill/operator-mvp-readonly with Netlify base directory platform; verify actual Git-linked preview SHA/Functions and no production changes. Netlify installed connector has no deploy or Git-linking action, so this cannot be marked complete through it.
2. Verify Netlify Functions-scoped FILL_OPERATIONS_API_BASE exists by native Netlify readback; if connector upsert remains nonpersistent, use site dashboard securely. Rebuild the protected site after the variable is visible.
3. Under Netlify Team Login, GET /fill/ and verify the frontend and same-origin /api/me respond 401 without a Supabase operator JWT; verify valid stage operator-only account read-only /api/me, org, Today, Calendar, with one authorized org UUID. Do not paste bearer into chat or URLs as a fixture of real-user success.
4. Accept desktop/mobile UI, timezone rules and no write endpoints on hosted protected preview; keep known fixture inventory clearly labeled. No consumer provider rights, book/hold/payment, CRM send, production deployment or partner outreach.

No new infrastructure, paid service or production branch change is authorized in this checkpoint.
