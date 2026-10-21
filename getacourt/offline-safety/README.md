# GetACourt Offline Safety — Independent Candidate

This is a **standalone, source-only, unactivated** service-worker prototype developed in a separate Draft PR while GetACourt and accessibility Work streams remain active. It is not registered in the shipping GetACourt application, is not a deployed installable PWA, and has not modified the existing app, manifest, provider or booking code.

## Implemented and verifiable

- `sw.js` makes **only same-origin GET navigations inside its own limited scope** eligible for a network-first static offline notice. Credentials/auth/API, availability, booking, payment, profile, tokens, provider and sensitive query-key paths are explicitly excluded, including encoded pathname escapes.
- `offline.html` is a stand-alone static notice. It has **no JS, forms, current slots, prices, booking confirmation, customer information or checkout**.
- During install the worker caches **only** `offline.html` after verifying an HTML response, with `credentials:"omit"` and `cache:"no-store"`. It **never caches a network response** or a service API route. On navigation network failure, it returns the public cached notice, never a stale result.
- The cache name is isolated to `gac-offline-shell-`; activation deletes only older caches belonging to the same prefix.
- Five Node contracts guard origin/scope/method/mode and fail-closed sensitive paths, cache isolation, notice content, and no accidental registration in the main app.
- Offline Chromium proof uses an in-memory local fixture and a fake private booking response, verifies only one static cache entry and that sensitive offline routes fail, with no real third-party network traffic.

## Important boundaries

Do **not** register this worker on the main `/getacourt/` route or widen its scope until the GetACourt CTO has reviewed the active PWA implementation, Netlify hosting/base paths, current PR #5, consent/auth implications, cache purge/versioning, physical device UX and negative user-data tests. This standalone candidate deliberately operates only under `/getacourt/offline-safety/` and provides no full installability evidence. It is a privacy-preserving offline fallback **contract module**, not a release or integration approval.

No live provider API, token, payment, booking, CRM, customer data, public deployment, billing or account changes are necessary for this candidate.
