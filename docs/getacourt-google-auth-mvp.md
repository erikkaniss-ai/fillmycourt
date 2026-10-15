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
