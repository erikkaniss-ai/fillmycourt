# FILL-OPERATOR-AUTH-02 — Browser acceptance before draft release

Source-only until an exact successful GitHub Actions CI and draft deployment.

Fix a Playwright strict-locator error on duplicated synthetic court names: scope the assertion to #courtUtilisation instead of the entire DOM.

Private-draft GitHub Actions now executes **real Chromium browser acceptance and auth/gateway Node contracts BEFORE the Netlify upload step**. If the operator sign-in, dashboard, calendar, offline fixture or DST tests fail, the draft publication is never reached. Tests use 100% synthetic mocked local API data, no live user or booking writes. Production/main/GetACourt are unchanged.

The next real acceptance gate remains a supported Supabase staging Auth user and operator organization membership provisioned by the owner. Until then, no real password, email, or session has been used in the protected preview.
