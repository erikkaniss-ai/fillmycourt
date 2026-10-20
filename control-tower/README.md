# Development Control Tower

Read-only, mobile-first portfolio dashboard for owner review. It is deliberately separate from customer-facing GetACourt and FillMyCourt surfaces.

## What it shows

- portfolio and project cards for FillMyCourt, GetACourt, Shared Platform, ReBloom and Continuum;
- weighted engineering-acceptance progress, calculated only from defined milestone criteria — never commit count, PR count or CI count;
- NOW / NEXT / BLOCKED, named owner-GO requirements, staged environment evidence and a short change history;
- an automatically refreshed GitHub PR, exact SHA and CI status per configured repository;
- status labels that distinguish actual verified, synthetic verified, manual and unverified evidence.

The static `config/projects.json` is the human-owned decision layer. A green GitHub run refreshes its evidence card only; it cannot change a milestone percentage. That requires an editor to update the milestone's acceptance state and evidence reference after review.

## Local preview

## Online access

Stable address: https://control-tower--fillmycourt-preview.netlify.app/

Sign in with the existing Netlify team account. This is an isolated branch
deployment on the existing private `fillmycourt-preview` site. The operator
preview at the primary site address is preserved. No laptop process is needed.

GitHub Actions `Control Tower private online deployment` checks and publishes
changes pushed to `cto/development-control-tower`. It reuses the existing
`FILL_NETLIFY_AUTH_TOKEN` deployment secret in CI only. The hosted function
uses public GitHub GETs without any credential, caches results for 15 minutes,
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

## Live source freshness

The browser receives a same-origin `/api/snapshot` response. The server reads `GITHUB_TOKEN` only from its own environment when supplied; it is never serialised into the response, static files or logs. Public repositories work without a token, subject to GitHub's anonymous rate limit.

To add a project, copy a project entry in `config/projects.json`, define weighted milestone acceptance criteria, add an optional GitHub `repository` and `pullRequest`, and leave `baseline` false until the owner reviews those criteria. A project with no reviewed baseline is shown as **No verified baseline**, not as 0%.

## Netlify, Railway and Google Drive

This slice records the current Netlify/Railway state as dated human-reviewed evidence, because no safe server-side deployment credential or private dashboard host has been approved for this new surface. Google Drive remains the human decision source: update the project configuration only after the canonical Decision Register, Technical Specification, CTO Checkpoint and Work Inbox have been reviewed.

The owner authorised online hosting on an existing resource on 20 October 2026.
The private Fill preview site and its existing Team Login were selected.
Automatic Netlify/Railway refresh and ReBloom/Continuum source mappings remain
unconfigured. Those cards retain dated manual evidence or unverified state.

## Verification

```powershell
node --test control-tower/test/control-tower.test.mjs
node --check control-tower/server.mjs
node --check control-tower/public/app.js
```

The test suite checks weighted-percent semantics, unknown-project rollup exclusion and server-only credential handling using a mocked GitHub response. It makes no external calls.
