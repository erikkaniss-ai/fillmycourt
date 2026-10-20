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

Activation of a protected hosted Control Tower requires a separate owner decision for: the exact existing protected Netlify site or another private host; server-side credentials/scopes for any Netlify/Railway refresh; the ReBloom/Continuum repository mapping; and the preferred private-access boundary. It must remain read-only and must not transmit tokens to the client.

## Verification

```powershell
node --test control-tower/test/control-tower.test.mjs
node --check control-tower/server.mjs
node --check control-tower/public/app.js
```

The test suite checks weighted-percent semantics, unknown-project rollup exclusion and server-only credential handling using a mocked GitHub response. It makes no external calls.
