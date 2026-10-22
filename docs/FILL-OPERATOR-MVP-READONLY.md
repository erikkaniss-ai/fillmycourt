# Fill operator MVP — read-only vertical slice

## Factual baseline

- Fill branch base: `platform/v0.4-staging` at `eec5f5d03910959324855bf07ca884b9feb70269`.
- Actual Railway staging Core source: `core/hotfix-booking-confirm-staging` at `0134f603445ea7f282ef0cb866d0f3591518cbb9`.
- The deployed Core contract available to this slice is `GET /api/me`, `GET /api/fmc/organizations`, `GET /api/fmc/{org}/today`, and `GET /api/fmc/{org}/calendar`.
- The later Fill-only opportunity, CRM, attribution, reconciliation and dispute routes present on the platform branch are not assumed to exist on the deployed Core and are not called by this UI.

## Delivered slice

### Local hosted / device / OAuth preflight report (21 October 2026; no deploy)

Continuation from Fill `b3b83b9`: separate read-only missing-part lists beside the
package summaries show only exact local MISSING and UNKNOWN component declarations,
with fixed readable labels and IDs; PRESENT is omitted. No list is inferred before
review or after stale/rejected/changed context, and late results cannot restore it.
No missing declaration means no verified GO; blockers stay open. No new reads,
actions, transport, permission or deployment change.

Continuation from Fill `0998f21`, preserving concurrent Draft changes: two
separate read-only local package summaries now sit by the club and Get blockers.
They reuse existing inspected manifest state for exact source/scope/time and
PRESENT/MISSING/UNKNOWN counts; no new read, action or combined GO. All-declared
still requires independent manual review, never authority or readiness. Loading,
invalid/expired or changed context cannot retain old counts; blockers stay open.

Continuation from Fill `1e5846d`: separate local GO-package completeness checks
now inspect bounded sanitized manifests for club protected read-only UAT and one
explicit Get check. Missing/UNKNOWN components stay unresolved; all PRESENT means
only declared completeness requiring independent manual review, never verified
GO or permission. Exact source/domain/check/org and current review windows are
required. No raw approvals, transport, sending, storage, authority verification,
new API or execution. Existing blockers, per-domain permissions and no-deploy
guards remain unchanged. Schema/examples and safety details are in the
[local viewer notes](fill-local-acceptance-viewer.md).

Continuation from Fill `27fe097`: separate owner/admin read-only unsent GO request
templates now sit under the club and Get planning lists. Club requests cover only
protected provenance UAT (not pilot GO); Get requests select per-check missing-GO
flags and exact pinned actions from the current reviewed local report. Required
unknowns stay placeholders, not inferred approval. Last-read SHA values are not
approved or independently attested. No recipient, editor, send/clipboard action,
storage, new request, permission or execution is added. Existing scope/expiry and
late-result clearing remain; club/Get authority is never shared.

Continuation from Fill `0654e84`: club and GetACourt now have separate read-only
next-GO preparation lists. They describe missing evidence, approval/delegation,
exact source/deploy scope, consent/expiry and stop conditions, never execution.
Club UAT/pilot GO remains unverified after successful reads; zero candidate
missing-record flags still needs independent GO review. Neither list grants or
transfers authority, starts requests, collects credentials or changes blockers.

Continuation from Fill `12506dd`: a separately labelled candidate-wide snapshot
now sits beside club UAT blockers (stacked on mobile). It shows reviewed Get
SHA/time, seven check statuses and missing-GO flags without joining club evidence
or authorising anything. No snapshot means no invented counts; even zero missing
flags remains "Verified GO: none". No extra requests/storage or automatic reads.

The Provider evidence tab now includes a local, owner/admin-scoped viewer for
the sanitized report-v1 contract from Get `79977c8`. It shows seven NOT_RUN
checks, missing evidence and exact scoped GO requirements. No file is uploaded,
persisted or automatically fetched; no API, OAuth, provider or execution route
is added. Reports require an explicit exact Get SHA, a fresh bounded JSON and
false execution/authority/release flags. Complete records mean manual GO review
only, never club UAT/pilot clearance. Scope changes discard files and results;
late file reads cannot restore them. See the
[viewer boundary and verification notes](fill-local-acceptance-viewer.md).

### Stored provider evidence viewer (21 October 2026; Draft source only)

The operator's separate **Provider evidence** tab reuses the review contract from
GetACourt PR #5 at `031878c3ea284b0718793e94ed1f42f572994d5f`, without merging its
worker, activating a provider, or changing the frozen Control Tower.

- Operations-only authenticated GET endpoints:
  `/api/fmc/{org}/provider-provenance/connections` returns only supported connection
  IDs/provider names; `/api/fmc/{org}/provider-provenance/{connection_id}` requires
  explicit `max_age_seconds` (1–31,536,000), bounded `limit` (1–50) and an optional
  UUID `after_booking_id`. The private gateway allowlists exactly these reads,
  never the existing configuration-bearing `/providers` endpoint or a write.
- Owner/admin only, authenticated RLS and REPEATABLE READ / READ ONLY.
  Existing provider-connection RLS does not permit manager/analyst access to
  the internal configuration required by the validator. These roles (as well
  as front_desk/support) remain denied; no policy widening or privileged access
  is introduced by the viewer.
  The reader has no privileged fallback. Foreign hidden evidence remains
  unavailable. Responses contain scoped booking IDs and fixed statuses, never
  credentials, grant configuration, receipt hashes, customer records or raw payloads.
- UI has no default freshness SLA, automatic provider refresh, repair, backfill or
  approval action. Each page has an as-of timestamp, explicit age threshold,
  page-specific status/counts and a bounded next-page cursor. All readiness,
  provider-request and available-slot flags must be explicitly false.
- Changing club, connection, threshold, tab or session clears the report;
  late responses/errors/401s cannot restore old evidence or revoke a newer scope.
  Missing/forbidden/unsupported/invalid reports fail closed with no synthetic
  fallback. Opt-in demo mode explains that provider evidence is absent and
  sends no API requests. TieSports is not supported by this Playtomic report.
- Verification: Node viewer/race/gateway contracts, pure receipt regression tests,
  authenticated API/role/tenant/keyset/READ ONLY PostgreSQL16 tests, and real
  Chromium desktop/320px fixture-only evidence-viewer tests run in Platform CI.

These new Operations routes are **source-only, not deployed to Railway**. A private
frontend draft alone cannot make them available: the old Operations runtime
must display an unavailable report, not fall back or fetch a provider. Actual
protected exact-candidate operator/second-organisation/device UAT, approved
freshness policy, provider entitlement and scoped pilot GO remain separate gates.

The operator workspace renders a signed-in organisation's selected-day Core snapshot:

- Today KPIs: utilisation, confirmed/pending-payment revenue, booking count and empty capacity.
- Court-level utilisation, with uncovered active courts visibly labelled `Needs rate coverage` rather than treated as sellable.
- Read-only recovery candidates derived only from `empty_windows`: duration, 60/90-minute configured starts and the highest configured slot quote.
- Day calendar based on Core booking, active-hold and block records.
- Court comparison of Core totals, sellable-rate coverage and configured-slot quotes.

The workspace contains no UI action or request for a price change, message, CRM action, provider call, hold, booking, payment, settlement or reconciliation change. It labels the staging snapshot as fixture-safe test data until a source is explicitly authorised; a configured quote is not a demand forecast or recovered revenue.

## Acceptance gates

### Selected-club UAT blockers — continued from a9504da; Draft source only

The existing selected-club review summary now contains a read-only **UAT blockers
and unverified gates** list. It derives only from the two validated manual-read
snapshots already held in the current club/session. It sends no request, stores
no approval, and cannot start UAT, repair evidence or change configuration.

- **Observed failures or incomplete reads** lists each failed Operations check
  by fixed label, each provenance problem with its count on the latest page
  only, and remaining pages or an empty reviewed page. Not requested, loading,
  denied, unavailable/incompatible and demo-absent reads stay unresolved; they
  are not presented as verified underlying service failures. A page still
  labelled `needs_review` remains unresolved even if its counted issues are zero.
- **Still unverified — not assessed here** always retains the six preflight
  non-assessments: independent runtime identity, protected host, two-org hosted
  UAT, separate worker state, fixture provisioning and owner UAT GO. Club-wide
  provenance coverage is also explicitly unassessed by this single-page viewer.
  This is not a complete UAT checklist or an assertion that these gates failed
  elsewhere. Neither an internally consistent page nor passing Operations
  clears these gates or supplies UAT/pilot authority.
- Only fixed known check/status labels and bounded page-local counts are used.
  No raw backend errors, receipt payloads, foreign identifiers or booking IDs
  are added. Pagination replaces, never accumulates, previously displayed
  issues. Parameter edits and re-reading clear that component's prior failures;
  club/tab/session changes clear the entire list, including hidden DOM.
  Existing scope/auth/request epochs reject late 200/401/403/network responses.
- The existing Node suite (both CI jobs) checks all ten Operations failures,
  nine receipt problem statuses, empty/incomplete/paginated reports, denied and
  incompatible reads, parameter invalidation and retained unverified gates.
  The mandatory two-org real-API/RLS Chromium rehearsal also verifies scoped
  blockers, manager denial, logout erasure and desktop/320px fixture screenshots.

No backend, gateway, role, RLS, schema, provider adapter or CI/deployment guard
is changed. Source/fixture checks are not hosted UAT or pilot GO. Keep the
unconditional no-deploy freeze and `[skip netlify]` markers in place.

### Selected-club review summary — continued from be37341; Draft source only

The existing **Provider evidence** tab now starts with a read-only summary for
the selected club. It presents the existing manual Operations preflight and
latest reviewed provenance page side by side. It makes no requests of its own,
does not persist results, and has no combined readiness score or GO action.

- Each component has its own state: not requested, loading, denied, unavailable,
  absent in demo, or a validated result. A connection list alone is not a
  provenance review. Re-reading clears the old component result immediately.
- Preflight includes its snapshot, explicit expected Operations SHA,
  self-reported runtime SHA, blocked-check count and six unassessed gates.
  A pass is still not UAT approval or independently attested runtime identity.
- Provenance includes its separate snapshot, selected Playtomic connection,
  explicit maximum receipt age, page-local reviewed/consistent/needs-review
  counts, first/continuation-page label and whether more pages remain. Counts
  are never accumulated across pages or connections. Even an empty or
  internally consistent final page is not a complete club report or pilot GO.
- Editing one component's parameters clears only its result. Club/tab/session
  changes clear both summaries, including hidden DOM; current 401 clears the
  session. Scope/epoch checks reject late 200/401/403/network responses before
  updating a newer club. Only previously validated fixed fields are summarised;
  no raw error, private receipt payload or booking ID is added to the summary.
- The existing Node suite runs in both CI jobs. The mandatory two-org Chromium
  rehearsal now asserts the summary against the real local Operations API and
  authenticated RLS, including denied manager reads, late old-club replies,
  logout erasure and desktop/320px fixture-only screenshots.

These are independent last-read snapshots, **not live state or a combined
assessment**. Permanent wording retains UAT/pilot not approved and no authority
for provider requests, slots, bookings, payments or deployment. Backend routes,
roles, RLS, schema and the no-deploy freeze remain unchanged. Hosted UAT and
pilot GO still require separate documented authority.

### Operations preflight viewer — continued from 97bf92a; Draft source only

The existing **Provider evidence** tab now also contains an **Operations preflight**
panel. The operator explicitly enters the full lowercase 40-character SHA of the
authorised Operations candidate and presses **Check Operations preflight**. There
is no default revision, automatic preflight, saved SHA, provisioning or approval
action. The UI revision is not assumed to identify the separate Operations runtime.
Hosted use still requires the separate entry GO below; this source change does
not grant authority to run a live check.

- Only the existing scoped GET is called. Owner/admin authorisation remains in
  the backend for each organisation; no role, RLS, schema or gateway change.
- Snapshot time, explicit expected SHA, self-reported runtime SHA (or **Not
  reported**), all ten fixed checks and all six unassessed gates are displayed.
  **Operations checks passed** is explicitly not UAT or pilot approval. An HTTP
  200 with any blocked check stays blocked. Build metadata is not independent
  runtime identity and an API flag does not attest a separate worker.
- The v1 shape, fixed check/gate sets, six explicitly false authority flags,
  revision-match consistency and aggregate status must all validate before any
  result is rendered. Unknown/incomplete/contradictory responses fail closed.
  Raw backend messages and unrecognised fields are never rendered. Auth 401
  clears the session; 403 shows denied access; 404/422/503, network/JSON errors
  or an incompatible contract remain unavailable, not ready.
- Changing club, tab or session clears both the result and expected SHA. Editing
  SHA clears the result. Independent receipt/preflight request epochs reject late
  200/401/403/errors before they can restore data or revoke a newer scope.
  Demo mode explicitly contains no preflight and sends no API request.
- Both CI jobs run the new Node contract suite. The mandatory protected-UAT phase
  also runs Chromium against the actual local Operations API and PostgreSQL16
  RLS for two synthetic organisations: pass, blocked revision, manager denial,
  independent receipt review, late 200/401/403, 320px layout and logout erasure.
  Its loopback-only fixture guard and unchanged-record checks remain in force.

These are source/fictional-CI checks, **not hosted UAT, provider rights, deployment
or pilot GO**. Keep the existing unconditional no-deploy job guard and
`[skip netlify]` markers frozen. No new preview or Operations deployment is part
of this step.

### Operations read-only preflight — continued from 00b43d1; NO DEPLOY

The authenticated Operations-only GET
`/api/fmc/{org}/provider-provenance/preflight?expected_operations_sha=<full-lowercase-40-character-SHA>`
checks local runtime prerequisites for the later protected UAT. Owner/admin
membership is required separately in each requested organisation; no cross-tenant
or role elevation is introduced. The private Operations gateway allowlists exactly
this GET/query shape, retaining site binding, bearer forwarding, response limits,
no-store and rejected redirects. The manual viewer above reuses this contract;
there is no automatic preflight request.

The preflight checks:

- Operations service in a known non-production test/staging environment.
- Exact expected SHA against `RAILWAY_GIT_COMMIT_SHA`. Missing, malformed or
  mismatched metadata is blocked; this self-reported environment value is not
  independent deployment identity or a signed build attestation. Do not set a
  fabricated runtime SHA merely to obtain a pass.
- Actual authenticated, non-superuser/non-BYPASSRLS DB context, matching actor,
  row_security ON and REPEATABLE READ / READ ONLY transaction.
- Required tables are real RLS-enabled tables with SELECT privileges; bounded
  LIMIT 0 probes resolve the reader's required columns without retrieving
  provider config, receipts, customer or booking values.
- Required provenance GET route registration and this API process's outbound
  provider-read flag absent/OFF. Ambiguous or enabled values remain blocked.
  This does not attest a separately running worker's flags or jobs.

The fixed, redacted response uses
`provider-provenance-operations-preflight/v1`. HTTP 200 carries either
`operations_checks_passed` or `blocked`; callers must inspect the status/checks,
not treat 200 as UAT readiness. Missing/invalid SHA is 422; authentication or role
denials remain 401/403; an old runtime/Core may return 404; DB/schema failures
return a generic 503 without DSN/details or trusted fallback. Every result keeps
`hosted_uat_ready`, `uat_accepted`, `pilot_ready`, `provider_requests_allowed`,
`can_display_available_slots` and `deploy_allowed` false.

Protected host, independent runtime identity, worker state, two-org hosted/device
UAT, approved fixture provisioning and owner UAT GO remain explicitly unassessed.
Run the preflight separately for A and B only after the existing hosted entry GO.
It does not validate receipts, fetch a provider, grant authority, repair schema,
write audit/domain data, provision accounts or deploy anything.

**No-deploy freeze for this source-only step:** the existing private-draft job now
requires a single exact-SHA owner staging GO before credentials or upload. The old
d500bb8 approval cannot authorise subsequent source; stale/missing GO must fail
closed at the first gate, with deployment steps skipped. PR #8 title and commits
carry `[skip netlify]` to suppress Git-driven publishing as well; this is not
`[skip ci]`. CI and fictional UAT continue. Green tests must not reactivate the
job or remove these markers. A later deployment needs separate explicit exact-SHA GO.
This read-only UI step changes neither gate nor workflow. No new preview, Operations deployment, production
publication or Netlify/Railway/Supabase configuration change is authorised here.

### Protected provenance UAT preparation — continued from 72f7c2f

**Prepared:** reproducible two-organisation rehearsal in the existing Draft PR.
**Not performed:** hosted operator acceptance, real pilot or provider integration.
**Not authorised:** backend deployment, hosted fixture/account provisioning,
provider reads/credentials, bookings, payments, production or a pilot GO.

The separate required Platform CI step runs
`platform/tests/test_fill_provenance_uat.py` after the full existing regression
suite. It uses the actual Operations routes, Supabase Auth verifier with an
in-memory HTTP transport, authenticated PostgreSQL16 RLS, and Chromium. Browser
GETs are forwarded into the local API, not fulfilled from prewritten report
responses. All non-loopback browser traffic is rejected. No provider adapter is
imported. Fixture setup requires `FILL_PROVENANCE_UAT_FIXTURES=ci-local-only` and
a direct loopback PostgreSQL `fmc_test` database, refuses query-string host
overrides, and never prints a rejected DSN. It is not a staging seeder or a
hosted UAT runner. The CI container owns/discards its fictional database.

The matrix is intentionally asymmetric, so an owner of one club is not
mistaken for a global owner:

| Synthetic principal | Organisation A | Organisation B | Expected provenance access A / B |
| --- | --- | --- | --- |
| owner_a / owner_b | owner / none | none / owner | 200 / 403; 403 / 200 |
| admin_a / admin_b | admin / none | none / admin | 200 / 403; 403 / 200 |
| dual_admin | admin | admin | 200 / 200, each response scoped separately |
| mixed | owner | manager | 200 / 403 |
| manager, analyst, front_desk, support | same named role | same named role | 403 / 403 |
| outsider | none | none | 403 / 403 |
| no session / invalid or expired session fixture | no authenticated actor | no authenticated actor | 401 / 401 |

For both list and report routes, checks include exact own connection/booking
sets, no foreign IDs or private grant/receipt fields, mismatched org/connection
403 even for dual_admin, foreign-cursor non-disclosure, bounded disjoint
pagination, and all readiness flags false. Each club has fabricated consistent,
missing-reference, stale and foreign-hidden-receipt bookings. User-editable
role/organisation claims do not override membership. Downgrade/removal is
rechecked from the DB even with a cached identity; this does not claim immediate
token invalidation or bypass the existing short Auth identity-cache lifetime.
GETs and rejected write-method probes preserve a scoped database digest.

Chromium verifies A-to-B report/picker/threshold cleanup, successful B rendering,
late A success and actual A permission-denial suppression, logout cleanup,
and a subsequent lower-role 403 with no previous principal's evidence in hidden
DOM. Mobile screenshots are named `fill-provenance-two-org-*-FIXTURE-ONLY.png`.
Injected CI-only bearer labels are not real login, Team Login or hosted Auth
proof. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
for the distinction between identity and row authorization.

#### Hosted UAT entry gate — NOT RUN

All following items need evidence before a hosted run; missing evidence is
**BLOCKED**, not an inferred pass:

1. Recorded owner/CTO UAT-only GO for the exact frontend SHA, exact Operations
   backend SHA, isolated protected draft URL, tester, synthetic tenant IDs,
   test roles, retention and explicitly approved freshness threshold. CI or a
   frontend draft upload does not authorise backend deployment or a pilot.
2. Independently verify anonymous HTTP 401 on that exact draft. Keep Netlify
   Team Login for the whole site; complete the separate app operator login.
   Do not disable protection or use `?demo=1`, a fabricated token, service-role
   credentials or direct privileged SQL as hosted proof.
3. Independently authorised backend promotion/provisioning must already be
   complete: the new report routes must exist on the reviewed Operations
   candidate. Until then, an unavailable report is the expected safe outcome.
   Do not deploy or create hosted users, memberships or receipts under this
   source-only assignment. An authorised admin must prepare two synthetic
   organisations and scoped test accounts through a separately approved process.
4. Confirm provider outbound reads remain OFF, no real provider credentials or
   active provider jobs are in this UAT scope, no real inventory/customer data,
   and no booking/payment/CRM writes. Receipt consistency is not provider
   entitlement, live availability or a permission to fetch fresh evidence.

#### Hosted UAT procedure after the separate entry GO

1. In isolated browser profiles, use A-only and B-only owner/admin test accounts.
   Each selector lists only its own club. Own connection and report reads return
   200; well-formed GET probes of the other approved synthetic tenant and
   wrong-scope connection return 403 with no booking IDs or configuration.
2. Use dual_admin: A and B are individually readable, but neither response may
   contain the other's IDs, receipts or cursor results. Inspect missing, stale
   and hidden foreign evidence; none can authorise the pilot. Review all pages
   as separate snapshots, never a single historical audit.
3. Repeat with mixed/low-role and outsider principals from the approved matrix.
   Both list and report must deny unauthorized roles, including an owner of A
   with only manager access in B. Repeat after separately authorised membership
   downgrade/removal; do not alter hosted memberships merely to run this plan.
4. Test expired/invalid operator sessions and logout. Confirm no prior report,
   connection option, booking ID or stale error remains in visible or hidden DOM.
   Session-invalidating behaviour must be observed on the actual candidate;
   a local mocked Auth rejection is not a hosted revocation guarantee.
5. On desktop and an actual target mobile device, switch A/B during a slow
   report and leave/re-enter the tab. The former scope must never reappear.
   Network failure, 403, unsupported route and unavailable backend must leave
   the report unresolved, without fallback or retry to a provider. HTTP 401 at
   the site perimeter alone does not prove any of these authenticated behaviours.

#### Acceptance record and stop conditions

Record exact frontend/backend SHA, CI run, protected draft identity, date/tester,
redacted principal aliases/roles, explicit age threshold, per-case expected and
observed status, desktop/mobile results, and PASS/FAIL/BLOCKED/NOT_RUN.
Screenshots must be synthetic and redacted. Never attach passwords, bearer or
refresh tokens, unredacted HAR/storage dumps, provider grants or customer data.
Any tenant leak, elevated-role bypass, unsafe flag, unprotected host or provider
request is FAIL: stop the run, retain redacted evidence and report it; do not
repair policies, deploy, grant rights or rerun a real provider automatically.

Source/CI rehearsal acceptance and hosted UAT acceptance are separate records.
Current hosted result: **NOT_RUN**. Current pilot GO: **NOT_GRANTED**.
Only explicit later authority can change these statuses.

1. `node --check platform/public/fill/app.js` passes.
2. `node --test platform/tests/fill_operator_readonly_contract.test.mjs` passes against a fixture shaped as the deployed Core's `today` and `calendar` responses and asserts GET-only network use.
3. `platform/tests/test_fill_operator_e2e.py` opens the static UI in Chromium, fulfills every API call locally from fixture data, exercises Today, Revenue & Capacity and Calendar, asserts a 1440px visual layout without horizontal overflow, and saves a test screenshot only to the test temporary directory.
4. Platform CI installs Chromium, runs the Core-contract test, fresh PostgreSQL migrations and the browser E2E before release acceptance.
5. A private, non-production preview is optional and must be independently verified private before any operator acceptance. No preview is created by this change.

## Not accepted by this slice

No real club/provider inventory, partner rights, operator identity test, CRM consent, Google OAuth, booking confirmation, provider write, payment, public release, production deployment, or revenue-recovery claim is evidenced here.

### Local GO package missing-part preparation — continued from 072c1f3

Each existing club/Get package summary and missing-part list now has an adjacent
read-only preparation region. Only current, explicitly inspected MISSING/UNKNOWN
rows yield fixed component-specific guidance for independent review of already
authorised non-secret records. UNKNOWN is not verified absence, PRESENT is not
verified evidence/approval, and no notes form an assigned or ordered work queue.
No collection, sending, new API/file read, execution or GO control is introduced.

Club organisation/Operations/UAT and Get SHA/single-check evidence and permissions
stay distinct; pilot, provider, deploy and OAuth/location state-change GO remain
separate. Existing guard/reset/expiry paths remove old notes with the local result.
Tests cover all Get catalogs, exact states, isolation, denied/stale/late results,
no new network/storage, desktop/320px fictional Chromium screenshots. Source/CI
checks do not change hosted UAT NOT_RUN or pilot GO NOT_GRANTED. Full behaviour
and limitations: `docs/fill-local-acceptance-viewer.md`.

### Preparation snapshots — continued from 21f53fd

Club and Get preparation regions each have a separate read-only snapshot: exact
organisation/Operations SHA or Get SHA/single check, number of existing local notes,
distinct MISSING/UNKNOWN counts and fixed review themes. No PRESENT steps, joined
authority, progress/readiness score or inference that UNKNOWN is proven absence.
No notes is not approval: original-evidence/authority review remains required,
verified GO none, execution NOT_RUN, blockers open. Existing guarded local result
and reset/expiry paths are reused without new reads, state, storage, collection,
controls, sending or execution. Source/CI tests include all seven Get catalogs,
scope/late-result/denied/stale clearing, exact totals and fictional desktop/320px
Chromium snapshots. Hosted/device/OAuth acceptance remains NOT_RUN; pilot GO
NOT_GRANTED. Existing deployment gate and Control Tower are not changed.

### Preparation snapshots beside blockers — continued from b5a1ef0

The same two read-only preparation snapshots are moved directly after club UAT
blockers and the independent Get preflight/missing-GO snapshot, before each detailed
package. One labelled H4 region per domain, no duplicate summaries or renderer.
Static warnings retain local scope and no sending/approval/execution. Application
JavaScript and all counts, guards, underlying notes and blockers are unchanged.
Node checks unique semantic placement and independent local results; CI Chromium
asserts direct siblings, actual desktop/320px geometry, no overflow or controls,
and preserves all existing denial/expiry/late-result and fixture-only safety checks.
No new reads, state, transport, GO, deploy or provider access. Hosted/device/OAuth
acceptance remains NOT_RUN and pilot GO NOT_GRANTED; Control Tower untouched.
