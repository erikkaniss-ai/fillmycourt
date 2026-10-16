# QA-PREVIEW-02 — repeatable non-production visitor-access acceptance

Purpose: ensure future GetACourt PR previews do not become anonymously public while the production getacourt.com remains accessible. Exact existing perimeter: Netlify Team Login for nonproduction only.

New source-only read-only script platform/tests/getacourt_preview_perimeter_smoke.mjs, run from Platform CI on pull requests targeting getacourt-staging. It validates the GitHub PR number (digits only), GETs only two fixed first-party URLs (deploy-preview-N--getacourt-preview.netlify.app and getacourt.com), requires HTTP 401 on anonymous preview and HTTP 200 on public production. It does not follow redirects, provide credentials, read response bodies, access customer data, query Core, provider API, or create any transaction. Bounded retry accounts for asynchronous Netlify preview build; an unprotected HTTP 200 fails immediately.

Subsequent GitHub Actions PASS proves these two HTTP safety invariants at execution time only. It DOES NOT establish real Google OAuth, signed-in team browsing, deployed exact commit after an asynchronous build, map tiles, live club availability or in-Get booking. Owner release gate and auth/provider setup remain independent.

Only existing Get RC branch and existing CI workflow; no new infrastructure, site config, SSO policies, main merge or production branch changes.
