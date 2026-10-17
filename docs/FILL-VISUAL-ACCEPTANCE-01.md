# FILL-VISUAL-ACCEPTANCE-01 — hiding auth gate and containing club selector

Date: 2026-10-17. Source-only Fill PR #8; not a hosted deployment.

## Real defect proven by reviewing original CI screenshot artifact
Previous accepted Fill Chromium screenshots `05-synthetic-demo-today-FIXTURE-ONLY.png` and `07-synthetic-demo-calendar-FIXTURE-ONLY.png` had the full `Sign in required` authentication card visibly rendered above the active operator workspace. HTML sets `#authGate.hidden=true` on successful/fixture login, but author CSS `.auth-gate { display:grid }` can override the browser's `hidden` user-agent display rule. The old browser tests only asserted workspace content, so they missed the visibly duplicated auth panel.
The `#orgSelect` control also extended outside the 245px left sidebar (intruded into the main content), because its auto/min-content width followed the long synthetic club name.

## Fix
Set explicit author-level `[hidden] { display:none !important }`; ensure `.workspace-label` and its select use `min-width:0`, `width:100%`, `max-width:100%`, and ellipsis. This does not alter authentication policy or identity verification; the real API still requires a valid Supabase operator Bearer token, and the isolated fixture demo still cannot contact Operations/Core.

## Browser acceptance
Updated authenticated-Core-shaped fixture test and both hosted-local and offline-file fixture walkthroughs assert `#authGate` is actually hidden, `#workspace` is visible and the organization selector stays inside sidebar bounds, on top of existing Today/Revenue/Calendar and no-network checks.

The owner still must connect and deploy the separate protected Fill Netlify site to a CI-accepted SHA and provision an authorized staging operator before claiming real hosted operator acceptance. No public production, Get PR, provider/CRM/payment write, database schema, or club outreach changes.
