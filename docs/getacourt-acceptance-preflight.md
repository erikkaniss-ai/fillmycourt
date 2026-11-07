# GetACourt remaining acceptance: read-only preflight and exact GO gates

Source continuation: accepted `be691ef98b5c2adb6ff412b39fae1d44305fee08`,
existing Draft PR #5, `get/release-candidate-mvp-qa-04`. No new preview,
Control Tower, branch integration into a published base, or release is requested.
This is a local evidence planner, NOT an execution runner or authorization system.

## Current facts, not inferred readiness

Accepted source/fixture evidence: Platform CI #427 / `39579621535` succeeded
on `be691ef`, including PostgreSQL/browser regression, 32 automated axe audits,
and isolated offline network-loss/cache proof. These do not prove hosted content,
physical devices, real Google OAuth, human assistive technology, or pilot readiness.
No exact-candidate deployment receipt, fresh hosted/device evidence or scoped GO
was supplied to this step. All seven checks remain **BLOCKED / NOT_RUN**.
The worker remains unregistered; install UI observation does not activate it.

`getacourt/qa/current-preflight.json` is deliberately an accepted-source snapshot,
not a moving claim about its own commit. Against a newer HEAD it must fail the
candidate binding too. A reviewer prepares a separate, untracked, nonsecret input
for the exact candidate only after independently checking refs and receipts.
Never rewrite a SHA in a receipt to make old evidence apply to a new candidate.

## Shared GO boundary

Before any future hosted action, the owner or explicitly delegated release
authority must approve its exact check ID/actions in the canonical Decision
Register / CTO checkpoint. A reviewer verifies the authority/delegation and the
original receipt; typing `GO` into JSON cannot grant permission. Record full SHA,
Draft PR5 branch/state, **existing** nonproduction deploy ID and exact origin,
approver/authority/tester/receipt references, UTC approval and expiry, exclusions
and stop conditions. Reconfirm at execution time. New SHA, deploy or origin,
expired/revoked consent/GO, changed protection/configuration, or contradictory
evidence invalidates the review. Do not create a deploy to fill a missing receipt.

Allowed origin forms are strictly `https://deploy-preview-5--getacourt-preview.netlify.app`
or a verified immutable 24-hex deploy ID host on that same preview site. Neither
form alone proves nonproduction, exact content, access protection or isolation.
No production origin, alternate PR/site, credentials, URL query/hash, redirect or
wildcard is accepted. Verify an existing deploy's actual published root; repository
path `/getacourt/` is not evidence of a hosted mount. Current plan covers root `/`
only. A different mount needs explicit source/GO review, not a broader matcher.

Required evidence: exact-head source CI success; hosting/admin receipt binding SHA
to existing deploy; reviewed synthetic-only nonproduction backend with provider,
booking and payment paths disabled. For content/device/OAuth, additionally require
fresh anonymous **401** and verified team access. A 200, redirect, unknown status,
foreign deployment or absent isolation receipt blocks, without retry/auto-fix.
No live availability may be queried to establish isolation.

## Separate check matrix

| Check ID | Additional evidence / exact scope for a future separate GO | Stop / acceptance boundary |
| --- | --- | --- |
| `hosted-perimeter` | Hosting+source+isolation receipts; anonymous preview root GET only, no redirect, no body, no credentials | Only expected 401; no production comparison. A 401 alone is not SHA or authenticated-content proof. |
| `hosted-ui` | Fresh perimeter/team-access receipt; team login and fixture-only read-only UI | Verify deploy identity, empty/synthetic catalog, keyboard/dialog/layout and denied APIs. No booking, watch creation, customer or provider data. |
| `ios-safari` | Physical iOS/Safari versions, tester consent; hosted-ui scope plus physical Safari/install UI observation | No emulator substitution. Record actual install affordance/absence, standalone layout and return navigation. Do not register a worker or promise offline installability. |
| `android-chrome` | Physical Android/Chrome versions, tester consent; analogous separate scope | Chrome CI cannot substitute for physical Android. Record actual install behavior, not a source-only PASS. |
| `device-location` | Named tester/device consent and no coordinate retention; explicit one-time permission GO | Allow/deny/cancel/time-out; no persisted coordinates, real catalog/provider calls or repeated prompts. Device permission is a state change. |
| `google-oauth` | Auth-admin staging project/client aliases, exact root callback, minimal identity scopes, no production auth/config changes; consenting test-account alias | Explicit GO for Google login, test-user/session creation, own refresh and own sign-out. Cancel/denial, code cleanup, refresh/return and same-user isolation. No other user/session revocation or sports-provider access. |
| `human-accessibility` | Consenting tester, physical device, browser and screen-reader versions | Manual keyboard/focus/dialog/announcements/reduced-motion review with fixture-only data. Automated axe is not human AT or WCAG certification. |

`requiredGoActions` and `requiredEvidence` in the report are the exact machine
lists for each row. Extra/missing/duplicate actions are rejected. A read-only UI
GO cannot authorize OAuth or device location. A complete GO record never enables
execution: a human still verifies current authority, access, consent and safety.
Install-UI scope does not include worker activation or clearing existing caches.

Real OAuth is **not read-only**: Supabase sign-in creates a user/session and may
issue refresh/access tokens. It is NOT_RUN under the current request, even though
the planner can inspect nonsecret configuration/consent receipts. No account
deletion, config repair, OAuth client creation or secret handling is included.
See [Supabase sessions](https://supabase.com/docs/guides/auth/sessions) and
[Google sign-in setup](https://supabase.com/docs/guides/auth/social-login/auth-google).
Device versions must be explicit, not "mobile passed"; the reviewed
[12 October TLS notice](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)
also makes unsupported-device compatibility a future check, not an inferred PASS.

## Input contract and safe local use

Top-level fields: `schemaVersion:1`, `candidate`, `deployment`, `evidence`,
`goRecords`. `candidate` contains full `sha`, `pr:5`, existing `branch`,
`state:"open"`, `draft:true`, `merged:false`. A missing deployment stays `null`.

A deployment receipt contains `sha`, `origin`, `deployId`, `nonProduction:true`,
`observedAt`, `expiresAt`, `receiptRef`, `reviewerRef`. Every evidence item has
`kind`, the same SHA/origin/deploy binding, observation/expiry, receipt/reviewer
refs and the kind-specific strict `facts` fields defined in
`getacourt/qa/acceptance-preflight.mjs`. Source CI is a reviewed receipt, not a
network lookup. Every GO record has `checkId`, that same binding, `decision:"GO"`,
`approvedAt`, `expiresAt`, `receiptRef`, `approverRef`, `authorityRef`, `testerRef`
and exactly the check's `actions`. Tester-specific evidence must match its GO.

Use UTC `YYYY-MM-DDTHH:mm:ssZ`. Evidence/deployment maximum window is 24 hours;
GO maximum window is 8 hours. These are conservative planner limits, not a new
permission policy. A shorter approval limit wins; never extend an owner's GO.
Duplicates, unknown fields/kinds, stale/future/foreign records, failed facts or
unknowns block. The planner does not verify signatures, contact approvers, fetch
receipts, authenticate a deploy, execute tests or persist approval state.

From repository root (snapshot deliberately exits 2 = BLOCKED):

```sh
node getacourt/qa/preflight-cli.mjs --input getacourt/qa/current-preflight.json --sha be691ef98b5c2adb6ff412b39fae1d44305fee08 --now 2026-10-21T12:00:00Z
node --test getacourt/tests/acceptance-preflight.test.mjs
```

For a real review use independently verified current full SHA and current UTC,
not the sample time. Exit 0 means records are ready for MANUAL GO REVIEW only;
2 means blocked; 1 means malformed input. Every report keeps `execution:NOT_RUN`,
`executionEnabled:false`, `authorityVerified:false`, `releaseReady:false` and
worker activation unauthorized. Never interpret shell success as a GO or UAT PASS.

Do not put passwords, emails, tokens, OAuth codes, cookie values, complete auth
URLs, precise location or personal customer data in inputs, screenshots or Git.
Use opaque references to access-controlled originals. CLI reads one local JSON
file (64 KiB limit), writes stdout only, has generic parse errors, no `.env` or
credential lookup and no network. Report output does not echo input values.
Unit-test GO/evidence fixtures are explicitly fictional and are not current GO.

## CI and exclusions

Platform CI mandates the planner negative/positive contracts and retains full
PostgreSQL/browser/accessibility/offline regression. QA-PREVIEW-02's historical
live script is retired with an explicit refusal/exit 2; its automatic preview
and production requests are removed, not replaced with a fake hosted PASS.
New hosted tooling, if approved later, needs separate scoped implementation.
CI also exports `getacourt-acceptance-preflight-NOT-RUN`, stamped with the exact
PR head SHA (not GitHub's temporary merge SHA) and actual UTC. It requires the
snapshot to return exit 2 and all seven checks BLOCKED / NOT_RUN. The snapshot's
accepted base SHA is intentionally not rewritten to match a newer candidate.
This artifact reports missing evidence, not live evidence or executed acceptance.
PR title and commits keep `[skip netlify]`, never `[skip ci]`.

No deploy/upload/config/env change, production request/merge, real provider call,
provider credentials, booking/hold/payment, CRM/customer data, outreach or paid
resource. No changes to Fill PR #8, shared Core, active auth/UI modules, worker
registration, cache lifecycle or frozen Control Tower. Provider-specific rights,
pilot club consent and operator/pilot GO stay separate and cannot be inherited
from Google login, a Netlify team login, source CI or this preflight.
