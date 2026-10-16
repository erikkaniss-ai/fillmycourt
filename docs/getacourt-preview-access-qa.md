# GAC-MVP-PREVIEW-01 — Non-production GetACourt preview acceptance

Date: 2026-10-16. Existing project getacourt-preview, public production domain getacourt.com. No public release, main merge, new paid project or live booking.

## Protected preview perimeter
- Netlify getacourt-preview Team Login enabled ONLY for non-production. Verified with a readback of projectAccessControls: requiresSSOTeamLogin=true, whichProjectsRequireSSOTeamLogin=non_production, requiresPassword=false.
- Draft PR #5 source get/release-candidate-mvp-qa-04, base getacourt-staging (NOT main): https://github.com/erikkaniss-ai/fillmycourt/pull/5 .
- Netlify automatically built PR #5 to https://deploy-preview-5--getacourt-preview.netlify.app, context=deploy-preview, source commit 228c93b772f4b3b5ce6e8481c5d27a2f9108319c; first deploy 6ad1e118df489de6594f57fd READY.
- Unauthenticated HTTPS fetch of the exact PR preview returned HTTP 401, while https://getacourt.com responded normally. The getacourt-staging branch alias is for published production and is not an access-control test for a real Deploy Preview.

## Preview environment bindings (checked without exposing values)
- Production-only env variables previously meant preview had no Core/Supabase config.
- Updated existing variables GETACOURT_CORE_API_BASE, GETACOURT_SUPABASE_URL, GETACOURT_SUPABASE_PUBLISHABLE_KEY with additional deploy-preview context values. Verified separately that all original production values were byte-for-byte unchanged and both contexts now exist.
- Core preview base is the existing read-only tested Railway staging URL. Supabase URL and publishable key are the same staging project values already used for Get. No service-role key or provider credentials moved.
- GETACOURT_GOOGLE_SIGNIN_ENABLED and email sign-in are not enabled. GETACOURT_APPROVED_VENUE_IDS absent: catalog fail-closed by default; known Cascais fixture cannot leak. Staging Core GAC_BOOKING_ENABLED remains OFF.
- A NEW protected PR preview deploy is required after environment edits because Netlify snapshots Functions variables at deploy time.

## Required acceptance before real accounts
1. Verify new PR deploy SHA, context deploy-preview, functions included, READY.
2. Verify anonymous GET / returns 401 and public getacourt.com still works; SSO authorized user may inspect only after Netlify Team Login.
3. Once preview env is active, verify /api/gac/platform-config under authenticated team session: Core staging connected, bookingEnabled=false, onlinePayments=false, Google/email sign-in flags false unless independently configured.
4. Never imply a successful OAuth sign-in: configure Google Cloud/Supabase redirect and provider under separate permitted setup, then do iPhone Safari and Android Chrome real-account login/profile/logout and Near Me grant/deny checks.
5. Real club catalog is a separate consent/provider right gate; no real booking, provider writes, payments, CRM sends or production activation through preview.

## No implicit release
This draft PR MUST NOT merge automatically. Current public getacourt-staging must remain on its existing SHA until explicit owner release GO.
