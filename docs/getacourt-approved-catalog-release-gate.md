# GAC-MVP-RELEASE-GATE-01 — approved venue catalog

Date: 2026-10-16. Existing Get RC only; no deployment, infrastructure, transaction API or provider adapter changes.

## Verified P0 defect
Actual Railway staging Core returns a synthetic GetACourt Cascais Test Venue with native-looking availability. Before this gate, Get Netlify search facade rendered ALL native slot results as user-visible clubs, even test fixtures. This violates the accepted launch gate: do not represent synthetic courts as real inventory or expose unapproved clubs.

## Source-only fix
GETACOURT_APPROVED_VENUE_IDS is a server-only, deployment-scoped, comma-separated allowlist of specifically authorized Core venue IDs. Missing/blank => EMPTY. When empty, Get returns an empty normalized catalog, cache-control no-store, and makes ZERO Core requests. When configured, only matching venue IDs pass through normalization; other venues remain hidden. The previously observed Cascais synthetic staging venue is hard-excluded by exact known UUID / fixture name / fixture address label, even if its ID appears in the allowlist.

This is a presentation/catalog publication release gate, NOT provider/API access, club permission or transaction authorization. Core remains the one booking writer. Google Auth, session model, provider rights, DB schema and holds/confirmations are unchanged. Do not present this feature as proof of a working real-club marketplace.

## Operational activation (NOT executed)
1. Obtain written club distribution permission and verify legal/API rights, Core venue UUID, slot provenance/freshness, real-booking authority, rates, cancellation terms, contact and support.
2. Only after approval, configure exact venue UUIDs in GETACOURT_APPROVED_VENUE_IDS with Netlify Functions scope on an appropriately protected preview. No wildcard and never allowlist the synthetic Cascais venue. Netlify env is frozen per deploy.
3. Keep bookings/payments/CRM off until independent owner-controlled in-Get transaction approval, single writer and E2E evidence.
4. Do NOT protect the whole existing public getacourt.com site. Current Netlify legacy plan lacks a verified entitlement for preview-only visitor protection. No publicly accessible candidate preview should carry real OAuth or club data.

## Acceptance tests
New Node Netlify facade tests: (a) no allowlist -> no clubs and zero Core fetches; (b) staging fixture excluded despite its ID/name/address label being included; (c) one approved venue cannot expose a neighboring unapproved venue. Existing real Chromium and PostgreSQL16 suites remain required. Production getacourt.com and staging Railway are unchanged.

Next: genuinely access-controlled preview, real Safari/Chrome Google OAuth+GPS on devices, authorized first club supply, then independently approved single-authority booking.
