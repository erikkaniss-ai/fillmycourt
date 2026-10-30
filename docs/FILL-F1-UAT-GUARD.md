# F1 fixture guard — GO-A source and tests only

Based on `aa3ec1d8d137a58d7f2da95259d54bc0415a4534`, existing Draft PR #8.
Owner GO-A authorizes development/tests, not deployment, schema application,
secret installation, account creation/activation or hosted UAT. CTO granted the
six-file lease used by this change. The previous aa3ec1d UAT authority is CLOSED.
No new service, cron, workflow, chat, booking writer or provider operation.

## Boundary and guarantees

The guard defaults to OFF. Enabling it anywhere except service `operations`,
environment `staging`, project `yclqnbcrchwieyzkyumx` fails startup. The active
manifest must match `RAILWAY_GIT_COMMIT_SHA` exactly. Normal unmarked users retain
the existing canonical Auth check, organization roles and RLS. Core/Get routes
do not use this guard. On Operations, even with the guard OFF, trusted fixture
markers and the four excluded historical IDs are denied. OFF is not a fixture
access switch.

Fixture classification comes from the canonical Auth `/user` response's
`app_metadata.fill_f1_run` and `app_metadata.fictional=true`, never editable
`user_metadata` or unverified JWT claims. Classification grants no role.
An allowlisted ID without the matching trusted marker is denied. A tagged
identity absent from the manifest/ledger is denied. Existing memberships/RLS
remain necessary. An enrolled user with any membership outside the exact two
fictional organizations is denied before route execution and again at delivery.
Fixtures may issue GET/HEAD only; this is not permission to invoke Core writers.

Each immutable run has a UUID, full candidate SHA, pinned project, exactly the
two fictional organization IDs, and at most three NEW principal IDs labelled
`a`, `b`, `canary`. The start must be fixed **before any of these users are
created**. Auth Admin `created_at` must fall inside that absolute window. The
maximum 30 minutes includes provisioning, canary and operator testing; it does
not restart at activation/login/restart. Operators begin ban attempts by T+20
minutes; canary expiry is at most T+3 minutes, with ban attempts by T+2 minutes.
Every principal has at least 30 seconds between early ban and its hard cutoff.
Each principal ID can enter the private ledger only once, across all runs.

Fixture replies are buffered (maximum 4 MB). At the final response boundary,
before any response headers/body are handed to the server, canonical Auth,
identity, immutable registry, armed/stopped state, isolation, cleanup health and
absolute deadline are checked again. Late data/Auth/registry queries cannot
deliver a stale successful result. Streaming/oversize fixture output is denied.
Already delivered/downloaded data cannot be recalled; network delivery time is
not an atomic transaction with wall time. Health over 45 seconds old, registry
failure/missing schema, absent ownership proof, Auth outage, local clock drift
against monotonic time or database clock disagreement fails closed. Healthy
normal traffic does not depend on the fixture ledger.

**This is an Operations API cutoff, not global Supabase token revocation.**
Direct Supabase REST/other services are not protected by this lease. An already
issued JWT may remain valid elsewhere. A running Operations process performs
supported Auth Admin ban/readback independently of the chat. A whole-service
suspension, database outage or Auth Admin outage can delay the actual account
ban. The guard cannot promise an unconditional account-ban deadline. No shared
RLS/Auth-session rewrite or additional scheduler is included in GO-A.

## Durable cleanup

`fill_private.uat_runs` is a non-exposed private ledger with RLS, no anon/
authenticated/PUBLIC schema/table/function privileges and no public API. It
contains no passwords, access tokens or Admin secrets. Enrollment starts
unarmed with empty receipts and no health stamp. The trigger forbids changing
the spec, deleting a run, resetting armed/stopped/complete state or reusing an ID.
No runtime enrollment, activation or schema-creation endpoint exists.

Operations lifespan sweeps pending rows before traffic, then every ten seconds.
It rereads persisted deadlines, including previous incomplete runs after a
restart/config change. For each NEW principal it verifies the exact Auth Admin
ID, role, trusted run marker, fictional flag and creation time before touching
it. At the early ban time (or immediately for a stopped run), it calls supported
`PUT /auth/v1/admin/users/{id}` with only `ban_duration=876000h`, then GETs the
same user and verifies `banned_until` more than a year ahead. An already verified
long ban only requires GET readback. No unban, delete, SQL Auth write, invitation,
signup, booking or payment call exists in the controller.

Failures retain pending durable rows, failed receipts and no healthy timestamp;
the next ten-second sweep retries. Exceptions/upstream bodies are not emitted
with secrets. All receipts must be true before `cleanup_complete=true` removes
the run from retries. Stop disables access irreversibly for that run. Clock
disagreement requires administrator diagnosis; it never renews a deadline.
The controller relies on trusted DB/runtime clocks and continued Operations
execution. Disabling/rolling back the guard before verified cleanup is forbidden
in the future runtime procedure. Hard process termination cannot run `finally`;
restart recovery comes from the ledger, not the chat or an in-memory timer.

## Files and source migration

- `platform/src/fmc/fill_uat_guard.py`: lease, private SQL adapter, ban-only
  controller, lifespan and buffered delivery check.
- `supabase_v1.py`: optional trusted classification on `Actor`; no role grant.
- `v1_app.py`: narrow Operations auth/delivery/lifespan integration.
- `platform/tests/test_fill_uat_guard.py`: offline fault/route tests and the
  existing CI's PostgreSQL-only ledger contract. No hosted requests.
- `platform/supabase/migrations/20261030202410_fill_uat_guard.sql`: source only.

The migration was generated with official Supabase CLI **v2.122.0**,
`migration new fill_uat_guard --workdir platform`, after `--help`. Official
Windows ZIP SHA256:
`60031fd5bf050fc12a0c6aef68997600d143870f944bf13109c7765dca329af8`.
CLI and its state remain task-local, telemetry/update check disabled; no login,
link, remote migration, global install or repository configuration was needed.
Local Docker daemon was unavailable; real PostgreSQL migration/trigger/privilege
verification is delegated to the existing Platform CI, not claimed as local PASS.

## Exact future GO-B proposal — not granted by this document

GO-B must name the reviewed full NEW candidate SHA and successful CI, not reuse
aa3ec1d's consumed authority. CTO must inspect the final six-file diff and CI
first. Scope of a later explicit GO-B:

1. Existing protected Fill preview `d763b7a1-dccd-4638-8876-ac1670171698`, retaining
   Team Login; existing Railway Operations staging service
   `c0c6e5e2-0040-48e0-a0af-abfb1ec81b61` in staging environment
   `16cadc45-b582-47ad-a071-d7bf4b40f450`, project
   `cbb85d2f-a9ec-4027-ac29-87bd70d31a65`. No other service/deploy target.
2. Apply only the reviewed private-ledger migration to Supabase staging
   `yclqnbcrchwieyzkyumx`; preserve existing data and public policies. Install
   `FILL_UAT_GUARD=on`, private `FILL_UAT_LEASE` JSON and a server-only
   `FILL_UAT_ADMIN_KEY` solely in this Operations service. The manifest keys are
   `run_id`, `candidate_sha`, `project_ref`, `organization_ids`, `starts_at`,
   `expires_at`, `principals`; each principal has `id`, `label`, `ban_at`,
   `expires_at`. Full SHA must match Railway's commit variable. Secret privilege
   is broader than this controller; keep it out of frontend/CI artifacts/logs.
3. Fix the UTC run start first. Through supported Auth Admin create at most
   **three NEW** fictional identities, initially banned, with the exact run UUID
   and `fictional=true` in app_metadata. Verify ID/creation time/ban before
   assigning memberships. Add only fictional fixture memberships in
   `af24d8dd-813f-4919-bd6d-49a6d1169b25` and
   `4484cf28-1947-41dd-9b41-14891ac93752`; no original staging club/customer data.
   Enroll the exact immutable manifest unarmed; compare it with runtime config,
   then arm it once. The current runner's arbitrary run ID/long activation
   window is not a substitute for this bounded procedure; do not run it as-is.
4. While both operator principals remain banned, activate only the NEW canary
   through supported Admin under that GO. Deliberately leave the chat idle and
   prove autonomous ban/readback plus denied login/API by its short cutoff.
   Read back the persisted receipt from outside the browser session. Also prove
   missing/stale registry and late-response denies. If canary fails, stop the
   run; never activate operators. Do not extend the original 30-minute window.
5. Only after canary PASS, activate the two new operators for read-only desktop/
   mobile F1 tests: roles, own-club data, cross-tenant denies, logout, revoke/
   membership removal, expiry and slow-response races. Ban/read back both at the
   early cutoff or immediately on failure; final all-three banned verification
   is mandatory. Residual test memberships/data are preserved unless separately
   authorized for removal. Record exact SHA/CI, hosted PASS/FAIL, UTC deadlines,
   ledger receipts and final Admin readback in Issue #9 / PR #8 without secrets.
6. Keep cleanup running until every receipt is verified. A stalled cleanup is a
   failed run, never acceptance. Only after verified bans may the runtime Admin
   secret/guard configuration be removed and the previous protected build used
   for rollback. Keep ledger evidence; do not delete users or old data.

The four historical IDs remain excluded from enrollment and **every** cleanup
allowlist: `b82a8774-839f-4b73-8c4d-5c76c10dd957`,
`45ef3b07-f811-4e27-b41b-64fe5970d675`,
`4ff65a8d-3d3b-4fd7-a032-a81fd8f51fce`,
`c29ba3be-d7ae-4dff-b662-88d1b0504024`. Never reactivate them.

Excluded from GO-A and proposed GO-B: production/public deploy/merge, Core/Get
writer changes, bookings/holds/payments, actual customers/provider writes,
outreach, paid connections and additional infrastructure/automation. Hosted UAT
and internal MVP acceptance remain NOT DONE until actual guarded evidence exists.

References: [supported Admin ban/update](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid),
[Auth API contract](https://github.com/supabase/auth/blob/master/openapi.yaml),
[CLI release](https://github.com/supabase/cli/releases/tag/v2.122.0).
