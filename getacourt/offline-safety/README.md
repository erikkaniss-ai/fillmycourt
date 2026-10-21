# GetACourt Offline Safety — Independent Candidate

This is a **standalone, source-only, unactivated** service-worker prototype developed in a separate Draft PR while GetACourt and accessibility Work streams remain active. It is not registered in the shipping GetACourt application, is not a deployed installable PWA, and has not modified the existing app, manifest, provider or booking code.

## Implemented and verifiable

- `sw.js` makes **only same-origin GET navigations inside its own limited scope** eligible for a network-first static offline notice. Credentials/auth/API, availability, booking, payment, profile, tokens, provider and sensitive query-key paths are explicitly excluded, including encoded pathname escapes.
- `offline.html` is a stand-alone static notice. It has **no JS, forms, current slots, prices, booking confirmation, customer information or checkout**.
- During install the worker caches **only** `offline.html` after verifying an HTML response, with `credentials:"omit"` and `cache:"no-store"`. It **never caches a network response** or a service API route. On navigation network failure, it returns the public cached notice, never a stale result.
- The cache name is isolated to `gac-offline-shell-`; activation deletes only older caches belonging to the same prefix.
- Seven Node contracts guard origin/scope/method/mode, exact and prefixed sensitive paths/query keys, percent-encoded route escapes, the single static cache-write operation, isolated cache namespace, notice content, and no accidental registration in the main app.
- Offline Chromium proof uses a loopback-only fixture and a fake private booking response. It forces actual origin socket failures, verifies the public static offline fallback, ensures API/auth/booking routes fail closed, confirms cache contents again **after** all denied navigations (not a fallback to the earlier snapshot), and verifies that only obsolete Offline Safety caches are evicted while unrelated application caches survive activation. No real third-party traffic occurs.

## Important boundaries

Do **not** register this worker on the main `/getacourt/` route or widen its scope until the GetACourt CTO has reviewed the active PWA implementation, Netlify hosting/base paths, current PR #5, consent/auth implications, cache purge/versioning, physical device UX and negative user-data tests. This standalone candidate deliberately operates only under `/getacourt/offline-safety/` and provides no full installability evidence. It is a privacy-preserving offline fallback **contract module**, not a release or integration approval.

No live provider API, token, payment, booking, CRM, customer data, public deployment, billing or account changes are necessary for this candidate.


## Verified acceptance — 21 October 2026

- Red test-first runs reproduced unsafe interception of prefixed sensitive routes such as `booking-history`, `auth-callback`, and token-like query fields.
- Source correction rejects these route variants and still permits explicitly nonsensitive navigation.
- At exact source SHA `9f1ded9440600342b52e35660cfd978bb971293b`, [PR CI #39576468163](https://github.com/erikkaniss-ai/fillmycourt/actions/runs/39576468163) and [push CI #39576461614](https://github.com/erikkaniss-ai/fillmycourt/actions/runs/39576461614) both succeeded. The PR CI job reported 7/7 Node contracts PASS, Chromium offline fallback PASS, zero external requests, zero cached private/availability/booking responses.
- This does **not** certify a deployed PWA, production offline behavior, real third-party access, or full browser/platform compatibility. Keep the candidate unregistered and in Draft PR.
