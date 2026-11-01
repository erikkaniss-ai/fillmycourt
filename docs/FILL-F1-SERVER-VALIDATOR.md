# Server validator preparation — disabled, source review only

This code prepares an alternative read-only validation mode inside the existing
Operations process. It is not a deployment, account allocation, enabled task,
hosted result, or continuation of a consumed attempt. Existing evidence/history
remains unchanged. Core remains the sole booking writer.

`FILL_UAT_SERVER_VALIDATOR` defaults to `off`. Off mode reads no validator
binding, constructs no user clients, SQL pools or task, and changes no guard.
Core/all modes never install the Operations lifecycle hook. No new service,
resource, public endpoint, database object, migration or automation is added.

## Components and limits

The existing bootstrap remains the only provisioning/activation path using
supported Auth Admin; the existing guard independently bans and records
settlement. The validator cannot create users, activate them, write a Root
verdict, release an intent, retry a consumed operation or renew deadlines.
Bootstrap admission is held until the validator checks the privately configured
binding/history against the existing canonical intent. Operator activation is
also held until the server validates the independent private proof grant.

User login uses only a modern publishable key. User JWTs remain in memory and
are cleared on close; refresh tokens are unused. Auth requests are pinned to
the existing Auth origin. Runtime Operations requests use the existing official
HTTPS origin, independently matched to trusted hosting public-domain metadata
and the privately configured expected origin. No redirects, environment proxy,
arbitrary host/path/port or localhost fallback is allowed. This covers the real
routing/middleware path and removes only MCP from the critical loop. ASGI and
MockTransport are explicit unit-test injections only. No new listener is added.
The [Railway variable reference](https://docs.railway.com/variables/reference)
documents the public-domain, deployment-ID and source-SHA metadata used here.
Only the existing read-route
checklist is available: identity/organizations, own Today/Calendar, cross-org
denials and provider-provenance metadata permissions. No booking, hold,
payment, membership, provider or customer writes exist in this task.

See [Supabase API key documentation](https://supabase.com/docs/guides/api/api-keys)
for the separation between publishable application keys, user sessions and
privileged server credentials. No privileged key is accepted by user clients.

Each control/check read is bounded at two seconds. Whole command read timing
remains six seconds, DB freshness ten seconds and guard health forty-five
seconds. Original action/admission, canary positive/ban/denial, independent
Root/operator and total-run deadlines are retained. No critical per-command
MCP acknowledgement is needed. There is no claim yet that live Auth/SQL/app
latency meets these bounds.

A dedicated bounded read thread and separate stop thread avoid exhausting the
guard's executor. They are threads inside the existing process, not services or
OS child processes. Timeouts do not mean cancellation. Late jobs remain owned,
cannot reopen admission or restore a closed client/session, and are reported
as pending until actually settled. Instance-only guard denial stays latched
after validator failure/finish, independently of later healthy guard sweeps.
Invalid opt-in configuration also quarantines fictional access/bootstrap while
the valid independent guard keeps running; it does not prevent guard startup.

Shutdown durably stops/reconciles the existing intent and observes guard
cleanup. Partial allocations are labelled separately; an unknown create,
pending activation, late job or unverified ban is never reported as a complete
three-operator success. Task, client and owned-job closure are explicit; there
is no claimed PID/EOF/helper execution. The accepted legacy helper bytes are
unchanged and are not invoked by this mode.

## Private proof and independent Root acceptance

The only proof sink is the existing private Operations log. It emits a
credential-free `PRIVATE_FINAL_CANARY` envelope once, containing the canonical
proof and its SHA-256. Operational identities, bindings and timing are private;
they must not be copied into public repository fixtures/comments/artifacts.
New tests use dummy identifiers, synthetic clocks and mocked transports only.

Root copies FINAL proof JSON to its existing private canonical document,
verifies exact private readback and the canonical digest, then writes one
existing eight-key journal verdict. The reference is the privately configured
document base URL plus `#` and the proof digest; it fits the unchanged
reference character/length restriction. No Docs credentials are added to the
service. The task never fetches Docs or publishes/accepts its own grant.

The digest binds run, authority, spec, Operations source, preview source,
deployment, original times, expiry and unchanged canary proof. The two source
SHAs may differ honestly: this new Operations candidate does not imply a new
protected-preview deployment. A public GitHub URL, altered proof/source,
future/late verdict, foreign identity/role or unsettled nonce fails closed.
Root remains the independent acceptor; a source/CI pass is not hosted F1.

## Concrete proposed future infrastructure scope — values omitted

No action in this section is currently executed or authorized by this source
preparation. It is the reviewable scope for a separate exact future staging GO.

1. Keep the existing protected preview and all historical blocked identities.
   Select the exact reviewed Operations source SHA and separately verify the
   preview manifest SHA. Require a fresh independent owner authority, distinct
   new run and at most three new fictional identities. Closed authority/history
   cannot be reused, including unused account quota.
2. Use only the existing Operations service and its existing guard/bootstrap
   credentials in place; never read/export the privileged key. A single
   controlled candidate deployment may enable the server mode only under that
   separate scope. No account/Admin work occurs without an independent matching
   canonical intent and release. Keep guard/bootstrap enabled for cleanup.
3. Privately configure `FILL_UAT_SERVER_BINDING` with `operations_sha`,
   `preview_sha`, `deployment_id: "runtime"`, fresh `run_id`/`authorization_id`,
   the independently verified seventeen `historical_ids`, the two fixture
   `organizations`, private `receipt_document`, and `admission_expires_at`.
   `operations_origin` must equal the official HTTPS origin from that same
   Operations service's trusted `RAILWAY_PUBLIC_DOMAIN` metadata; other origins
   leave admission closed before any create. Publishable-key syntax, proof
   reference and source/scope binding are validated before admission as well.
   Configure the existing bootstrap input for the same fresh authority/source.
   Actual values/passwords/keys/Doc IDs are omitted from this public plan.
4. `runtime` resolves the provider's deployment ID at startup. After settling,
   Root independently binds that actual deployment in the existing private
   intent. This avoids an unknowable pre-deployment UUID and does not self-issue
   GO. The private admission expiry must remain within the bounded pre-start
   window; there is no automatic renewal. Runtime, plan and owner-written
   intent must all agree before bootstrap is admitted.
5. Observe private proof/readback, one Root journal grant, settled operators,
   exact route outcomes, original expiry and independently verified cleanup.
   Validate real task/client/job closure; do not label it legacy-helper UAT.
   Browser/mobile/logout/revoke/race acceptance remains a separate checklist.

Rollback starts with a durable stop/reconciliation and independent ban
readback for all known allocations; unknown outcomes stay closed. Preserve
guard/ledger/data and let independent cleanup finish. Disable the validator
only after that stop is established. Do not restart into legacy bootstrap
with an active grant to bypass the server gate. A code rollback must separately
review compatibility of the candidate-bound bootstrap/guard configuration;
do not blindly restore a different SHA with incompatible private inputs or
disable cleanup. No database rollback/delete is proposed.
