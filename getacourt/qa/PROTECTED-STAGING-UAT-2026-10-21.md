# GetACourt — protected staging UAT authorization (21 October 2026)

**Owner scope:** deploy the current GetACourt Draft PR #5 to the existing Netlify `getacourt-preview` site in `deploy-preview` (Team Login protected), and prepare separate synthetic test users in existing Supabase staging. This authorizes neither production deployment nor real external provider requests, data imports, public exposure, booking, payment, DNS or merge.

The acceptance engineer must independently record: current PR HEAD, Netlify deploy ID and exact commit_ref, deploy context=deploy-preview, production unchanged, anonymous GET root HTTP 401, source/CI success and actual hosted navigation. Verify the tested backend is the existing staging Core with booking/payments disabled and inventory unknown. Never infer an availability feed from booking records.

Physical iOS Safari/Android Chrome, Google OAuth/test-account login and device-location permission tests need explicit tester consent and working staging identity/configuration. No UAT check can be marked PASS from CI alone. Do not create real provider connections or enable external OAuth/login flags without separate scoped setup and evidence.

If Netlify cannot deploy this exact candidate or site protection fails, stop and record BLOCKED instead of trying a public context.
