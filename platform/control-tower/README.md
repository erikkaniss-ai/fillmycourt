# Development Control Tower — source-only preview

One read-only, mobile-first engineering portfolio view for **GetACourt**, **FillMyCourt**, **ReBloom**, and **Continuum**, with a path to future products. Kept in the existing Draft branch; **not a deployed or production feature**.

## Scope implemented

- The /api/status endpoint reads allowlisted GitHub pull requests and latest PR-triggered Actions runs on each SHA. Observations show their source-specific checked_at; failed/missing/private reads stay **unverified** rather than green or red.
- Product cards show source SHA, PR/CI evidence links, NOW/NEXT/OWNER GO and manual-checkpoint provenance.
- CI is green only when all per-product mandatory workflows succeeded for the current PR/source HEAD. This rejects an unrelated green preview workflow masking failed Platform CI. GetACourt requires Platform CI; FillMyCourt requires Platform CI and the private draft preview workflow; ReBloom requires canonical Linux validation; Continuum has no reviewed required workflow baseline yet, therefore remains CI UNVERIFIED.
- pull_request workflows may have a synthetic merge SHA. The matcher accepts it only when the GitHub run also reports the same PR number and exact source HEAD in its PR association. Missing association or skipped/neutral results fail closed to UNVERIFIED. When Actions fails, the PR HEAD can remain verified independently, but CI stays UNVERIFIED.

- A progress percentage is **null/unbaselined** until milestone acceptance criteria, weights and acceptance evidence are approved. Commit count, green CI and elapsed time do not indicate completion. Portfolio percentage stays null until a reviewed cross-product baseline exists.
- Netlify, Railway, Supabase, Google Docs decision feed and hosted browser QA are **not integrated** and must not be implied by GitHub success.
- The local read server has a fixed allowlist; token environment variable is server-side only; no client-side credentials, writes, scheduling, production control or provider access.

## Local read-only use

Requires Node 22+ and a GitHub token with read-only repository and actions permissions for the four repositories. Run the server with CONTROL_TOWER_GITHUB_READ_TOKEN set in your local process environment, followed by:

    node platform/control-tower/server.mjs

Open http://127.0.0.1:4178 on the same computer. Do not place the token into source, docs, issue trackers, logs or browser devtools. Without a token, the UI displays unverified rather than pretending to have live data. Refresh: 60 seconds browser side and 60 seconds server cache. Tests:

    node --test platform/control-tower/test/control_tower.test.mjs

## Deployment gate — NOT AUTHORIZED

The server is **loopback-only**. Do not bind to 0.0.0.0, expose through a public reverse proxy, or deploy on the public GetACourt/FillMyCourt sites. A private hosted version requires a separately approved host (e.g. isolated Netlify site with verified Team Login), authenticated server-side API handler, repository read scopes and an anonymous-access negative test. No new paid service, DNS/production change or token provisioning is approved by this source slice. A successful source CI is not hosted UAT.

Milestone acceptance must be owner-approved and backed by evidence. The static NOW/NEXT/GO labels in model.mjs represent a checkpoint as of **20 October 2026** and are not live updates. Add future projects through a reviewed config change to the project allowlist. A separate adapter can later ingest authorised deployment evidence and reviewed Google Drive decisions.
