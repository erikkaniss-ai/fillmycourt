# Development Control Tower

Read-only, mobile-first portfolio dashboard for owner review. It is deliberately separate from customer-facing GetACourt and FillMyCourt surfaces.

## What it shows

- portfolio and project cards for FillMyCourt, GetACourt, Shared Platform, ReBloom and Continuum;
- weighted engineering-acceptance progress, calculated only from defined milestone criteria — never commit count, PR count or CI count;
- NOW / NEXT / BLOCKED, named owner-GO requirements, staged environment evidence and a short change history;
- an automatically refreshed GitHub PR, exact SHA and CI status per configured repository;
- status labels that distinguish actual verified, synthetic verified, manual and unverified evidence.

The static `config/projects.json` is the human-owned decision layer. A green GitHub run refreshes its evidence card only; it cannot change a milestone percentage. That requires an editor to update the milestone's acceptance state and evidence reference after review.

## Online access

Stable address: https://control-tower--fillmycourt-preview.netlify.app/

Sign in with the existing Netlify team account. This is an isolated branch
deployment on the existing private `fillmycourt-preview` site. The operator
preview at the primary site address is preserved. No laptop process is needed.

GitHub Actions `Control Tower private online deployment` checks and publishes
changes pushed to `cto/development-control-tower`. It reuses the existing
`FILL_NETLIFY_AUTH_TOKEN` deployment secret in CI only. The hosted function
uses public GitHub GETs without a credential and a separate restricted server-only
credential for the two private repositories, caches results for 15 minutes,
and the browser checks for an updated snapshot every five minutes. Returned
timestamps show the actual snapshot time. A rate limit/error is unverified.

The owner-approved PCT-2026-10-20-v1 baseline is packaged as server-only data.
The public repository contains only an empty placeholder. Private acceptance
receipts and workflow selectors are stored in the isolated deployment workflow's
`CONTROL_TOWER_APPROVED_MODEL` secret, never in static assets or public CI logs.
The packaging step validates the fixed 100-point project weights and four equally
weighted product scorecards, binds the bundle to the deployed source SHA, and
fails closed if data is missing or invalid.

The API reports confirmed, UNKNOWN and known-unfinished weights separately.
UNKNOWN always remains in the denominator; the overall percentage is withheld
while any weight is unverified. Shared infrastructure and the dashboard enabler
are visible but excluded from the product rollup. All-or-nothing milestone
receipts require a reviewer, timestamp, every acceptance condition and current
exact-source required CI. Source changes invalidate those receipts. Synthetic
tests never establish hosted/live readiness. Baseline approval is not release GO.

Continuum's required CI is assessed using reviewed exact-source workflow paths,
job names and every required step, not a green workflow name alone. Dependency
freeze, full regression, strict TypeScript, schema-generation no-op, native build,
tracked/untracked cleanliness and risk-lane tests are the approved policy.
Missing, skipped, cancelled, truncated or unaudited evidence remains UNKNOWN.
This dashboard policy does not modify repository branch protection or workflows
in any monitored private repository.

## Local preview

Run with a current Node.js runtime:

```powershell
node control-tower/server.mjs
```

Then open `http://127.0.0.1:4173`. The server binds to loopback only, sends no-store/CSP headers and accepts only `GET` requests. It has no write endpoint.

## Closure of the first Control Tower delivery

The protected dashboard is the **single canonical operational preview**. An earlier
experimental module under GetACourt Draft PR #5 is not the hosted source and must
not be merged or published as a competing dashboard.

The dashboard provides live source-backed current GitHub PR/CI, exact SHA,
release boundaries, NOW/NEXT/GO, responsive UI, and a recent activity list with
linkable PR update and CI run timestamps. These activity events are reconstructed
from durable GitHub records; no new data store or paid resource is required.
They are **not** longitudinal historical acceptance percentages or proof of
completed milestones. The dated manual acceptance history in config remains
separate. Persistent snapshots/time-series and automatic Netlify/Railway/Drive
evidence are deliberately excluded from this minimal-cost release until
authorised source contracts, persistence budget and review criteria exist.

Without the approved private model, weighted progress fields remain UNKNOWN.
With it, only verified acceptance earns confirmed weight. Do not infer a percentage from GitHub activity. No
production launch, provider authorization or payment readiness is implied.

## Live source freshness

The browser receives a same-origin `/api/snapshot` response. Private repository reads require `CONTROL_TOWER_GITHUB_READ_TOKEN` in the Netlify Functions environment; no personal CLI token or deployment credential is reused. Public repository requests receive no credential. Missing access and API errors produce UNKNOWN, not stale green evidence.

For the private connection, select only `rebloom-world` and `continuum-internal-preservation` under GitHub fine-grained token settings, with Pull requests, Actions and Commit statuses set to Read-only (metadata read is implicit). Set a short expiry and rotate before expiry. Store the value only in Netlify Functions scope for this non-production branch context. Never paste it in chat, put it in source, publish assets or logs. User approval is recorded; token issuance still requires owner GitHub login. Do not claim activation until the authenticated hosted API has been read back successfully.

Private cards automatically discover open PRs (at most 100 returned) and show the five most recently updated PRs. All latest workflows returned for each exact head are displayed, not just one green run. The API returns a coverage warning, so this bounded feed is not mistaken for every PR or project completion. GitHub blocker labels are shown when present; absence of a label does not prove absence of blockers. Manual decision gates and dated environment snapshots remain explicitly separate from live GitHub evidence. No Google Drive sync is claimed.

To add a project, copy a project entry in `config/projects.json`, define weighted milestone acceptance criteria, add an optional GitHub `repository` and `pullRequest`, and leave `baseline` false until the owner reviews those criteria. A project with no reviewed baseline is shown as **No verified baseline**, not as 0%.

## Netlify, Railway and Google Drive

This slice records the current Netlify/Railway state as dated human-reviewed evidence, because no safe server-side deployment credential or private dashboard host has been approved for this new surface. Google Drive remains the human decision source: update the project configuration only after the canonical Decision Register, Technical Specification, CTO Checkpoint and Work Inbox have been reviewed.

The owner authorised online hosting on an existing resource on 20 October 2026.
The private Fill preview site and its existing Team Login were selected.
Automatic Netlify/Railway refresh remains unconfigured. ReBloom/Continuum reads
use the separately approved restricted server credential. Every returned source
has its own freshness and coverage; unavailable evidence remains UNKNOWN.

## Verification

```powershell
node --test control-tower/test/control-tower.test.mjs
node --check control-tower/server.mjs
node --check control-tower/public/app.js
```

The test suite checks approved fixed-denominator accounting, six-card integration,
source/SHA/CI receipt invalidation, workflow job/step policy, server-only credential
handling and the legacy unapproved fallback using mocked GitHub responses.
It makes no external calls. Browser acceptance checks both fallback and approved
synthetic models at 320, 390 and 1440 pixels; no private data enters those fixtures.
