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

Milestone weights are proposed engineering models pending owner review;
they must not be presented as owner-approved overall project completion.

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

The weighted progress fields remain UNKNOWN while owner-reviewed milestone
baselines are false. Do not infer a percentage from GitHub activity. No
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
Automatic Netlify/Railway refresh remains unconfigured. ReBloom/Continuum mappings
are connected in code; live activation requires the dedicated credential and authenticated hosted readback. Those sources remain UNKNOWN until then. No approved milestone baseline is currently configured, so all completion percentages are UNKNOWN.

## Verification

```powershell
node --test control-tower/test/control-tower.test.mjs
node --check control-tower/server.mjs
node --check control-tower/public/app.js
```

The test suite checks weighted-percent semantics, unknown-project rollup exclusion and server-only credential handling using a mocked GitHub response. It makes no external calls.
