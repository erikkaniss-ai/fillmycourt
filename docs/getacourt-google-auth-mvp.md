# GetACourt MVP — Player Google Sign-In (source/CI only)

Authorized by product owner 15 October 2026: player authorization is mandatory in GetACourt MVP. This does not authorize Playtomic/other provider login, provider API writes or public website publication. No change to existing booking authority.

Flow: player clicks Google (enabled only after project Google provider, Google Cloud consent and Netlify opt-in are set) → Supabase Auth /authorize with S256 PKCE challenge → redirects back to the exact same GetAcourt origin/path with short-lived authorization code → browser promptly removes code from URL → Netlify same-origin /api/gac/auth/google/exchange relays code+single-use verifier to Supabase /token?grant_type=pkce using the PUBLISHABLE key → existing GetAcourt session and profile API continue. Separate provider login remains unimplemented.

Settings required (NOT YET VERIFIED OR ENABLED):
1. Google Cloud Auth Platform Client ID/Secret and consent/branding; callback https://yclqnbcrchwieyzkyumx.supabase.co/auth/v1/callback
2. Supabase staging Authentication > Providers > Google enabled, and exact redirect allowlist https://getacourt.com/ (or separate private Netlify branch preview URL for QA).
3. Netlify site getacourt-preview environment GETACOURT_GOOGLE_SIGNIN_ENABLED=true only AFTER verification. GETACOURT_SUPABASE_URL and GETACOURT_SUPABASE_PUBLISHABLE_KEY must already be set.
4. Test on Safari and Android Chrome (especially Safari PWA isolation): login, callback, refresh, logout, profile, no provider cross-auth, unauthorized request 401, invalid/expired PKCE 401.
5. Obtain owner GO for any change to published getacourt-staging branch or public website. No redirect changes, provider secrets, Google credentials or expenses modified by this source batch.

Security: S256 verifier in sessionStorage with 5-minute expiry/one-time consumption, browser URL code sanitized, tokens never copied to provider, access validated server-side by Supabase. Existing localStorage session strategy is retained and must be separately reviewed for production hardening, XSS/CSP and auth event revocation; auth cookies with HttpOnly can be a later scoped security improvement. Signing out calls Supabase /auth/v1/logout and clears local Get session. Not a guarantee that already-issued access JWTs immediately expire.

## Auth hardening QA-02 — 2026-10-15 (source-only)
A. Referrer-Policy no-referrer meta placed before Get player page styles/scripts, reducing OAuth query-code exposure in follow-up asset requests. This does not remove code from the initial callback HTTP request or its web-server logs.
B. Single-flight refresh across concurrent Get profile/bookings requests; refuses to restore a session that was signed out while refresh was in flight.
C. Get browser OAuth exchange and logout facades reject nonmatching Origin on cross-site requests; missing Origin still accepted by nonbrowser clients and tests.
D. Sign out UI does not claim server revocation succeeded if remote sign out failed.
E. Regression coverage includes real refresh routine in a Node VM harness, origin denial, HTML no-referrer meta and existing PKCE tests.
No public or staging deployment, settings change, Google provider enablement or booking changes.

## Session isolation QA-03 — source-only
Private Get player profile/booking/Play Routine views clear immediately on local sign-out and cross-tab storage sign-out. Returning to PWA from browser back/forward cache re-checks persisted session. Auth responses are guarded by session epoch before rendering any private data; protected API HTTP 401 invalidates only the matching stale client token, not a newer refreshed session. Distinct users sharing a device do not retain previous account views. Tests run in Node VM with no real player data or live provider calls.
Google OAuth still requires Google Cloud OAuth client, enabled Supabase Google provider/redirect allowlist and site env feature flag in an isolated staging release; these are NOT changed by this source-only batch.

## Auth session privacy QA-04 — 2026-10-15 (source/CI only)
Sign-out now clears private player views and local session BEFORE awaiting the Supabase revocation HTTP request, so a slow/unavailable network cannot leave another person's history visible. Async profile saves, profile openings, booking cancellations and Play Routine create/evaluate/toggle calls check an authEpoch after network responses before updating UI; a completed provider-side operation still needs explicit status verification, but may not render to another signed-in player. Regression tests verify source contracts for every scoped action and signout ordering. Existing Supabase Auth / booking authority unchanged; no public deployment.
