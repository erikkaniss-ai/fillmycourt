# GetACourt — protected staging UAT authorization (21 October 2026)

**Owner scope:** deploy the current GetACourt Draft PR #5 to the existing Netlify `getacourt-preview` site in `deploy-preview` (Team Login protected), and prepare separate synthetic test users in existing Supabase staging. This authorizes neither production deployment nor real external provider requests, data imports, public exposure, booking, payment, DNS or merge.

The acceptance engineer must independently record: current PR HEAD, Netlify deploy ID and exact commit_ref, deploy context=deploy-preview, production unchanged, anonymous GET root HTTP 401, source/CI success and actual hosted navigation. Verify the tested backend is the existing staging Core with booking/payments disabled and inventory unknown. Never infer an availability feed from booking records.

Physical iOS Safari/Android Chrome, Google OAuth/test-account login and device-location permission tests need explicit tester consent and working staging identity/configuration. No UAT check can be marked PASS from CI alone. Do not create real provider connections or enable external OAuth/login flags without separate scoped setup and evidence.

If Netlify cannot deploy this exact candidate or site protection fails, stop and record BLOCKED instead of trying a public context.

Release-note guard: this PR remains Draft and may only be built using the existing Netlify Deploy Preview context with Team Login. Live booking/provider grants stay disabled. A manual Netlify deploy to the production context is not authorized.

## 29 October 2026 — bounded protected standalone personal search acceptance

Owner requested completion of **GetACourt standalone court search**, with player-session read-only offers and official booking-provider handoff. This is approval for **one exact-head, protected, zero-Functions STATIC GetACourt search UAT** on the existing Netlify preview site and existing `get-pr5-reader-uat` alias, subject to exact-head full CI, source-ownership, Team Login anonymous HTTP 401 and post-upload verification. It is NOT authority for a production or public release, provider API/feed, customer/account data upload, full player auth delegation, booking/payment/hold or a new paid resource. Decision #105 remains binding.

The package must contain only `find.html` and its six reviewed local assets from `getacourt/qa/private-reader-preview.mjs`; extension v0.2.5 must target the precise protected `find.html` receiver. The prior direct-feed `find.html` has been replaced; legacy club/GET API code remains preserved but not deployed in this isolated package. The automatic staged upload is exclusively guarded by a matching one-time `GET_STAGING_UAT_APPROVED_SHA` marker in the PR body on this commit, with the unchanged `[skip netlify]` restriction. No public site, DNS or FillMyCourt services are touched.

CI/browser fixture success is NOT live availability proof: final owner-session Chrome/Edge extension search and non-booking handoff remain separate acceptance. Revert or remove the staged source/approval if its exact SHA/protection check fails. No external emails/provider contacts or customer records.
