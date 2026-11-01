# Fill F1 offline readout and synthetic transport

Batch: `FILL-F1-READOUT-02-20261101`, existing PR #8 / Issue #9.

This slice versions an offline parser and a bounded caller readout. It does not
invoke the hosted validator, Auth, Operations, providers, or any booking writer.
No account, credential, user/run configuration, hosting setting, approval marker,
or original UAT deadline is created or changed. `PUBLIC_GO=false`.

The previous hosted run remains **FAIL / cleanup accepted**, all thirteen old
fictional identities remain blocked, and its three-account authority is consumed.
Synthetic results below are not F1 hosted acceptance or proof of the cause of its
missing post-ban output.

## Reviewed parser port

`platform/scripts/fill_uat_safe_events.mjs` is a faithful ESM port of the reviewed
local standalone parser, SHA256
`27989f44646f0d807bc23b07fa929134bae01ba7440d1905c105a3d493577526`.
Its eighteen accepted fixture groups are ported to
`platform/tests/fill_uat_safe_events.test.mjs`. The local baseline files and frozen
validator SHA256
`6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548`
are not modified, imported or invoked by the new code.

The wire contract is ASCII JSONL, LF or CRLF, exactly these six ordered keys:
`label`, `route`, `status`, `request_id`, `verified`, `denied`.
The parser enforces ordered, unique caller-supplied phase slots and the existing
control/Auth/GET semantics. Unverified failures remain failures. Duplicate,
reordered, nested, escaped or additional fields fail closed. Only SGR formatting
(`ESC[` + numeric/semicolon parameters + `m`) is permitted. Cursor movement,
erasure, private/intermediate CSI, OSC, unsupported controls and unknown echo
fail closed; it never searches arbitrary text for a nested valid object.

The cumulative phase ingress limit is 64 KiB, including consumed records and
formatting. At most 32 events and 128 bytes per SGR sequence are allowed.
`feed()` returns a count only. Safe events are staged privately until `finish()`
atomically returns frozen objects. Failure, finish and explicit `clear()` drop
phase references. This is logical reference clearing, not physical heap erasure.
Errors contain fixed codes, never raw chunks, echo, response bodies or causes.

## Caller readout boundary

`readSafeEventPhase()` in `platform/scripts/fill_uat_transport.mjs` accepts:

- an ordered static `expected` plan;
- `read({signal, timeoutMs})`, returning tool-shaped `output`, optional
  `exit_code` and `eof` metadata;
- `stop({reason})`, returning true only after transport/process closure is
  actually observed;
- one absolute **monotonic** `deadline` and optional bounded read/stop limits.

The readout consumes all chunks through one phase accumulator. Complete data
requires explicit zero exit, complete expected records, and confirmed teardown.
Event count, silence, a live session ID, or a zero exit without records is not
proof. Nonzero exit, EOF without exit, malformed/partial frames, unsafe terminal
output, overflow, timeouts and order/duplicate errors return no staged events.
Valid but unverified outcomes produce `UNVERIFIED_EVENTS`, `complete=true` and
`ok=false`; they are never promoted to success. `ok` describes only the readout
of a trusted synthetic producer, not authenticated hosted acceptance.

A phase is capped at 30 seconds, 1,024 reads by default (maximum 4,096), and
2 seconds of stop confirmation. A blocked read is raced against the remaining
absolute budget and receives an abort signal on phase end. A read adapter must
honor abort; an ignored abort cannot grant successful teardown. The wrapper
clears parser state and returns `stopConfirmed=false` if closure is not proven.
Only fixed-code errors, safe events and counts leave the wrapper.

These clocks are independent from the **original database T0** of any future
guarded UAT. The wrapper never manufactures or renews DB T0, an account lease,
or operator authority. Any future reviewed caller must bound its phase by the
remaining original lease as well. This code is deliberately not a direct adapter
for the current long-lived interactive helper: it requires process exit.

## Synthetic local producer and PIPE tests

The only launchable producer is this script itself, with
`--synthetic-producer`. It accepts one literal
`SYNTHETIC_SENTINEL:<allowlisted-scenario>` line, not config/password/token/run
objects, paths, URLs or arbitrary executable arguments. It emits only fixed
synthetic protocol fixtures. Its independent lifetime watchdog is 20 seconds.

`createSyntheticPipe()` uses Node's documented child-process pipes, `shell:false`
and `windowsHide:true`. It does not forward the parent environment; Windows gets
only the noncredential `SystemRoot` needed by the OS. Stderr is drained without
retaining its text. Queued stdout is bounded; failure/stop discards pending data
and kills only the fixed synthetic child. Closure is confirmed from its `close`
event. There are no HTTP/socket imports, live helper paths, credential reads,
terminal mode changes, UI/clipboard/CDP adapters, retries or new secret channels.

Four positive scenarios cover no echo, fragmented reads, CRLF and SGR. Ten
negative scenarios cover arbitrary synthetic echo, malformed/oversized output,
partial EOF, zero exit without proof, nonzero exit, stalled output, duplicates,
wrong order and impossible status. Every scenario must match its expected
outcome and have observed teardown; the aggregate command does not call expected
rejections a real UAT success.

Run locally, without credentials or network:

```text
node --test platform/tests/fill_uat_safe_events.test.mjs platform/tests/fill_uat_transport_contract.test.mjs
node platform/scripts/fill_uat_transport.mjs --synthetic-pipe-check
```

The tests also cover blocked reads, absolute-deadline nonrenewal, reversed or
invalid clocks, bounded empty-read loops, late/failed teardown, opaque read errors,
stderr and nested synthetic-sensitive input without result/error leakage.

The unchanged accepted parser's 125 split-boundary reproducer demonstrates a
caller-readout weakness, not the historical hosted run's actual transport cause.

## Native execution-tool evidence and compatibility gate

The Node PIPE fixtures above and the execution tool's PIPE/TTY are distinct
transports. Native tool observations must not be inferred from fixture success.
The bounded native probe uses only the literal synthetic sentinel, the same
source parser, actual `exec_command` / `write_stdin` results, no raw-output logging
or persistence, and explicit observed process closure. Raw synthetic bytes are
held only in the probe's phase-local RAM and classified before disposal.

Final-script native receipt, 2026-11-01 02:24:58 UTC (Lisbon), Windows / Node
v24.22.1:

| Surface | Observed result | Teardown |
| --- | --- | --- |
| Node child-process PIPE | All 14 fixed scenarios matched their positive or rejected outcomes in the contract suite | All 14 child close events observed |
| Execution tool direct PIPE, producer start with no stdin command | One ready record parsed; tool exit 1, incomplete expected phase | Process closure observed |
| Execution tool TTY, one literal sentinel command | Synthetic echo and non-SGR CSI observed; parser rejected `UNSUPPORTED_ANSI`; tool exit 0 | Natural closure observed, no forced stop |

The direct PIPE receipt does not establish why the tool returned exit 1 or a
persistent stdin capability. The TTY receipt is an expected compatibility
rejection, not a successful readout. Raw tool output was never printed or saved;
only counts/booleans, fixed codes and closure metadata were retained. These are
new synthetic observations, not a replay or explanation of the previous run.

The probe binds these script SHA256 values (documentation/tests may subsequently
be committed without changing either script):

- Parser: `f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a`.
- Transport/producer: `5f9d17745e17fa5fee4c38a8e631525a93784eceaf184607151b2c4dc464a844`.

Reproduce the tool-specific distinction only with the fixed producer command
above: direct PIPE without a command versus TTY followed by exactly
`SYNTHETIC_SENTINEL:fragmented` plus newline. Feed every returned output chunk to
one instance of the source parser, never extract nested JSON or print raw chunks,
and require an observed exit. The producer watchdog bounds either probe; if the
tool session remains open, terminate only this synthetic producer and report that
termination instead of claiming natural closure. Tool-specific observations do
not automatically reproduce on another OS, Node version or execution tool.

**Live compatibility remains NOT ESTABLISHED.** Unknown echo and terminal editing
must continue to reject. Do not strip arbitrary terminal text, seek JSON inside
echo, inject known secrets into a parser, or widen the grammar to make a PTY pass.

Concrete next no-echo design for separate review: a documented persistent pipe
transport with inherited input echo absent, independent stdout/stderr, ordered
phase boundaries and an observed close/cancel receipt, using the same parser.
Before any credential use it needs synthetic evidence on the actual execution
surface, including multi-phase input and teardown. Node child-process PIPE
success alone does not establish such an execution-tool capability. No bridge,
launcher, secret handoff or live adaptation is implemented by this proposal.

## CI and publication boundary

The two new test files are invoked explicitly in `Platform CI` fast-contracts
(Node 22) and contract (runner-provided Node; no version claim). Both checkouts
select `github.event.pull_request.head.sha || github.sha`, rather than the
default PR merge-ref. A contract test covers both checkout settings. No trigger,
permission, environment, secret, setup action or deployment step is changed.

The initial source candidate `fdecb12e2652cc149e54011f908dc249da60e843` had a
green Platform CI run 41265281660, but its default checkouts tested the PR merge
commit (2504f04...), not that exact head. That result is historical merge-ref
evidence only. The checkout correction requires a new final candidate and one
full CI run whose decoded checkout logs match the actual final head in both jobs.

Before any source push, verify unchanged exact-SHA deployment pins, Netlify
repository/CD state, `[skip netlify]` title, and the existing private preview
approval gate. A new source SHA is not staging approval. Preserve the old marker;
an expected private-preview gate rejection is not a reason to authorize deploy.
No production/main/public/provider/customer/booking/hold/payment action belongs
to this batch.

## Persistent synthetic session — SESSION-03, 1 November 2026

Batch `FILL-F1-SESSION-03-20261101` starts from accepted source
`16d55b77a8e4bc2f4ba9376ec3b0b7d0d2e3832d`, in the same PR #8 / Issue #9.
The parser, one-shot transport, frozen helper and prior receipts above remain
unchanged. This is a **new synthetic protocol**, not the helper's protocol and
not a credential channel or hosted F1 acceptance.

The new `fill_uat_session_transport.mjs` launches only the adjacent fixed
`fill_uat_synthetic_session.mjs` with one of sixteen finite synthetic scenarios.
It accepts no executable, path, URL, environment, user/run configuration or
arbitrary command override. The factory accepts only bounded integer timing
options. It uses documented Node `child_process.spawn` pipes, `shell:false`,
`windowsHide:true`, and no parent environment except noncredential Windows
`SystemRoot` when an ordinary Node global process exists. Otherwise the factory
uses only the CTO-approved fixed executable name `node` and empty environment;
the inert producer import guards its CLI entry against an absent global process.
There is no process import, derived executable path or caller command override.
Stderr is drained without retaining text and immediately aborts
the session. PID is exposed only as synthetic process-identity evidence.

One child serves the fixed sequence `configure`, `positive`, `negative`,
`operator_simulation`, `close`. Each stdin write is exactly
`SYNTHETIC_SENTINEL:<allowlisted-phase>` plus LF. No password, token, authority,
account or runtime fields are accepted. The simulations contain only constant
fictional events; their statuses are not HTTP observations.

The producer emits one ASCII hello frame with a random 32-hex **synthetic
correlation ID**, then explicit begin/end frames for each monotonically numbered
phase. The exact frame grammar is:

```text
FMC_SYNTHETIC/1 <32-lowercase-hex> 0 hello begin
FMC_SYNTHETIC/1 <same-id> <1..5> <fixed-phase-name> begin
<canonical six-key safe-event JSONL records>
FMC_SYNTHETIC/1 <same-id> <same-sequence> <same-phase-name> end
```

Frames themselves have no ANSI/extra fields. They are handled by the separate
synthetic framing contract; only record lines enter the unchanged
`SafeEventReadout`. Unknown text/echo, nested JSON, unsupported controls, bad
frames/correlation, replayed or reordered phases/events and trailing bytes fail
closed. It never searches arbitrary text for JSON or strips terminal editing.
LF and CRLF plus record SGR formatting survive arbitrary chunk boundaries.

`SyntheticSessionReadout.phase(name)` releases immutable safe records only
after the complete expected records **and** matching explicit phase end. Event
count or quiet is insufficient. This is synthetic phase completion, not process
closure or authentication. The same process remains open for subsequent phases.
`close` additionally needs an explicit zero exit with EOF and separately observed
process closure. The frozen terminal `closed` event has `verified=false`, so its
valid close receipt intentionally has `complete=true`, `ok=false`,
`code=UNVERIFIED_EVENTS`; stop/closure metadata establishes teardown only.
Unverified outcomes in any earlier phase remain failures and terminate the
session. No self-reported event grants hosted acceptance.

The constructor fixes one absolute monotonic session deadline: default 16 s,
maximum 18 s, never renewed across phases or tool calls. Each phase is bounded
by the lesser of remaining lifetime and its default 3 s / maximum 5 s budget.
The parent has an independent real-time idle watchdog; the producer has its own
20 s lifetime watchdog. Reads/writes are bounded, each read loop is capped at
1,024 iterations, and stop confirmation is at most 2 s (default 1 s).
Total session ingress including consumed records, frames and formatting is
capped at 64 KiB; the native queued output also has a 64 KiB cap. Input is
capped at 128 characters and permits one exact command at a time.

On fatal error, abort or expiry, staged parser/text/queued output references are
cleared, pending native reads are aborted, future phases are fenced and only the
owned synthetic child is stopped. A false/late/failed stop is explicitly
`TEARDOWN_UNCONFIRMED`, never success. Logical clearing does not promise physical
heap zeroization. Caller adapters must honor abort and return true from stop
only after observing closure. An unsolicited later OS chunk/exit while idle
aborts the session; it cannot retroactively rewrite an already returned valid
phase receipt, and that receipt never asserts session/authenticated closure.

### Tests and actual-tool compatibility boundary

The new suite has 33 tests. A normal native child completes all five phases with
the same PID/correlation ID and no echoed input accepted. Fifteen fixed fault
scenarios cover echo, stderr, wrong correlation/phase, duplicate records, early
EOF, nonzero exit, missing end, overflow, replay, unverified outcome, forbidden
CSI, trailing output, zero exit without end and stall. Every native scenario
requires observed closure; a separate idle watchdog test closes a caller-idle
child. Offline adapter tests cover every split of framed JSON/CRLF/SGR, monotonic
deadline nonrenewal, clock failure, read/write hangs, empty-read limits, phase
isolation, atomic rejection, concurrent commands and unconfirmed teardown.

Run without credentials or network:

```text
node --test platform/tests/fill_uat_session_transport_contract.test.mjs
```

The new suite runs explicitly in both existing Platform CI jobs, preserving the
exact-head checkout settings. Local affected suites plus frozen parser/one-shot
and deployment/CI gate regressions initially passed **78/78**, with no skips.
After the CTO-approved portability correction, the affected suite passed 33/33,
including a new inert-import test with global process absent. The other 46
regressions remain unchanged; the final full CI tests all required gates once.

Actual persistent-tool probe on 1 November 2026:

1. Documented `mcp__node_repl__js` persistent state, repository file access and
   dynamic imports of `node:fs/promises`, `node:url` and `node:child_process`
   succeeded. Documentation explicitly says `node:process` import is unavailable;
   the absence of a global `process` was observed in the next step.
2. The initial candidate `35818bc628f48c36afa79a68f2c44f5377165358` failed
   its first session probe while dynamically importing the source module:
   **`process is not defined`** at its producer's main-entry guard. Import did
   not complete; `createSyntheticSession()` was never called, no child was
   launched and no phase command was sent. This is the tool's observed error,
   not an automatic approval rejection or proof that a spawn was attempted.
3. That initial probe was stopped and reported. CTO reviewed the source and
   identified an ordinary portability bug before the advertised spawn API was
   reached, not a capability denial. CTO expressly authorized only the guarded
   CLI entry and fixed `node` / empty-environment fallback described above, plus
   one revised synthetic probe after tests/hash binding. No process import,
   guessed executable path, hidden API, terminal/security change, installation
   or permission workaround was used. The documented REPL reset cleared the
   initial failed-import cache before the revised import.
4. **One revised child successfully spanned two separate persistent Node REPL
   tool calls**, 2026-11-01 02:49:13.064–02:49:18.472 UTC (5,409 ms).
   The same PID `632` and synthetic correlation ID
   `f11776bc92a863932f7860261a14f28d` appeared throughout; the original absolute
   deadline stayed unchanged. Call 1 completed configure (2 records) and positive
   (3) while the child remained open. Call 2 completed negative (2), operator
   simulation (4) and close (1). The first four phases were complete/OK. Close
   was complete/UNVERIFIED_EVENTS, not OK, because the frozen terminal event is
   intentionally false; explicit zero exit/EOF and observed process closure plus
   stop confirmation established teardown. Only safe metadata was printed, never
   raw chunks or producer input echo. The strict full-stream parser accepted
   records/boundaries without unknown input echo.

The successful revised probe is bound to these unchanged source SHA256 values:

- Session transport: `b109240103236948afb57e43be2707bd0010b1f126337b178c65fbce4c9e54b0`.
- Fixed producer: `bc1da8a5afb2aeda3ecd9bb5b48fa63a364790424cba6c3510a09eee842ada40`.
- Frozen parser: `f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a`.

This establishes only the **synthetic multi-phase no-echo channel contract on
this persistent tool surface**. Ordinary Node child PIPE tests, earlier direct
execution-tool PIPE and TTY observations remain distinct. No result establishes
compatibility with the frozen hosted helper, safe secret transfer, authenticated
closure, hosted F1 acceptance or pilot readiness. A separate reviewed live
adapter/authority would still be needed; none is implemented or requested here.
The historical run cause stays UNKNOWN and its authority stays consumed, with
all thirteen prior identities blocked. No Auth/staging/helper/account/credential
operation or new UAT/quota request belongs to SESSION-03. `PUBLIC_GO=false`.

## Plain-wire helper compatibility model — ADAPTER-04, 1 November 2026

Batch `FILL-F1-ADAPTER-04-20261101` starts at accepted
`6d64e7d620c7da52f0e677106c5a9546812f0be4`, same PR #8 / Issue #9. All
accepted parser/one-shot/session files are frozen. The local Python helper was
read and its SHA256 independently checked as
`6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548`;
it was **not imported, invoked, changed, staged or copied into CI**. CI has no
dependency on the untracked local file. Source inspection is not a hosted run.

### Compatibility matrix against the frozen source

| Invariant in reviewed 6ca source | New model / remaining limit |
| --- | --- |
| Startup emits one `ready` before configuration/client/HTTP; one configure input within 300 s | Explicit `ready` read precedes exactly one configuration. Mock lifetime is deliberately shorter, at most 20 s. |
| Configure keys exactly `op, approved_helper_sha256, plan`; plan keys `candidate_sha, run_id, authorization_id, t0, date, calendar_start, calendar_end, publishable_key, principals` | Same DTO field shape; ONLY fixed public sentinel / zero-fixture values. Mock hash, candidate, key, passwords and evidence are intentionally invalid for live configuration. |
| Principals exactly canary/a/b with id/password; distinct identities/passwords; specific excluded/used IDs | Fixed distinct zero UUIDs and public per-label sentinel strings. No account, real key/password or current run can enter this factory. Frozen static exclusions do not prove current DB state or the consumed run's authority. |
| Each successful configuration/command emits ONE ordered six-key JSONL record: label, route, status, request_id, verified, denied | Frozen strict parser handles all records unchanged; there are NO `FMC_SYNTHETIC/1` frames in this model. A complete record is response completeness only. |
| `login` / `denied_login`: exactly op,label; response label with route login / denied_login | Exact finite command DTOs. Positive expects verified200/not-denied; banned-login observation expects verified+denied400/401/403. Mock constant statuses are not real Auth results or cause evidence. |
| `get` / `denied_get`: exactly op,label,route; route among me, organizations, own_today, foreign_today, own_calendar, foreign_calendar, provider_connections | Finite labels/routes only. Own positive expects200; foreign and B provenance expect403; post-ban GET expects401/403. GET401/403 cannot establish membership removal, immediate revocation, expiry or a race. |
| One-shot `(label,operation)` slot consumed BEFORE HTTP, including ambiguous failures | Model consumes each named slot before write, no retry; all fatal failures fence the process. |
| `get` and `denied_get` return the SAME label/route tuple | Parent rejects overlapping expected status/denied sets as AMBIGUOUS_RESPONSE_SLOT before write, e.g. foreign403 then denied-foreign401/403. Disjoint positive-me200 versus denied-me401/403 remains only serialized parent inference. |
| No child command nonce, sequence, run/hash echo, acknowledgement fence or phase-end field; request_id is sanitized upstream HTTP metadata and may be empty | Parent-only ordinal/one-inflight ordering is explicit, never child-authenticated correlation. PID and source hash bind the owned mock process, not individual responses or a live helper. |
| Canary positive before T0+120; operators need gate and login before600; operator positive GET before1200; denied observations at120/1200 | Fixture age models these thresholds only. No real 30-minute authority or T0 is created. |
| Gate exact op/run_id/candidate_sha/decision/lease_digest/evidence_ref, one gate, age180..599; caller supplies independent receipt | Fixed synthetic gate only, parent model requires age180..599. The frozen helper validates field formats, not an independent current CTO verdict/guard lease; model gate never authorizes operators. |
| Original DB T0+1800 absolute deadline, wall/monotonic agreement within2 s; no renewal from configure | Immutable fixture T0 plus monotonic model age / expiry test; distinct immutable18 s parent cap. Model has no DB clock, current lease, wall-clock attestation or authority. |
| `closed` / `deadline` controls are verified=false; deadline watchdog emits then exits90 | Separate strict-parser candidates recognize terminal controls and abort. Mock deadline also sets exit90. Neither terminal event is proof of process close. |
| Configured EOF exits silently after clearing sessions; no close command or success event | Adapter close sends stdin EOF, requires separate zero-exit+EOF metadata and observed closure. Result is PROCESS_CLOSED_UNAUTHENTICATED, never authenticated acceptance. |

The frozen helper's candidate constant remains `ed0eeea…`; this source-only
adapter candidate does not replace it or inherit old deployment/UAT permission.

### New source boundary and failure semantics

`fill_uat_helper_contract.mjs` is a pure adapter/model: no filesystem, process
launcher, URL, HTTP, Auth or real target. `request(name)` accepts only finite
static names and writes a fixed DTO, not caller data. The fixture DTOs preserve
field shapes but deliberately use candidate/hash zeros, zero UUIDs, short public
`SYNTHETIC_SENTINEL:<label>` passwords, a sentinel key and sentinel evidence.
They cannot pass the real helper's hash/key/password/evidence validation.
Unknown keys, modified fixtures, URLs, key/JWT-shaped substitutes and arbitrary
commands are rejected by the fixed mock's canonical DTO allowlist. A safe
record's denial is additionally checked against the specific expected operation;
a valid401 safe denial cannot satisfy a positive own-club200 expectation.

The adapter serializes requests and increments a parent-only ordinal. Three
bounded unchanged-parser instances evaluate the expected record and the two
fatal terminal controls; no arbitrary text is searched or stripped. Records are
released atomically only after the complete expected response, with
`code=RESPONSE_COMPLETE_UNFENCED`, `boundaryVerified=false`,
`childCorrelation=false`, `authenticatedClosure=false`, `liveReady=false`.
There is no phase completion flag. Empty reads, quiet or count alone establish
neither a boundary nor process closure. An identical malicious/delayed response
arriving inside the next matching expectation cannot be distinguished by this
wire: the one-response-per-serialized-command convention remains an assumption,
not an authentication mechanism. A returned complete response cannot be
retroactively revoked by a later OS chunk; later unsolicited output fences the
session immediately and prevents further requests.

`fill_uat_synthetic_helper.mjs` launches only itself with a finite scenario using
documented pipes, fixed execPath or CTO-approved literal `node`, shell=false,
windowsHide=true, and empty environment except noncredential SystemRoot under
ordinary Windows Node. No caller executable/path/environment or live mode exists.
Its only input is the canonical finite DTO; a 4,096-character cap is stricter
than the real helper's16KiB configuration limit. The mock has no network client,
token, session credential or live helper import. It models login state as a set
of fictional labels only. It never invokes a real account/guard/operator gate.

One parent deadline is fixed at construction (default16 s/max18 s); response
budget default3 s/max5 s and stop confirmation default1 s/max2 s cannot renew it.
The parent idle timer is independent of a blocked caller; the mock's independent
watchdog is20 s. Session ingress and queued output each cap at64KiB, including
consumed bytes; loops cap at1,024 reads. `advanceFixtureAge()` permits only finite
forward model ages60/130/190/1200/1800 and never writes a helper command, modifies
fixture T0, extends the parent deadline or grants real authority. Original model
age1800 fails closed; wall-clock/DB/lease evidence remains absent.

Unexpected/late/duplicate/schema/echo/CSI/EOF/nonzero/deadline/overflow/stderr,
unknown operation, expired windows, concurrent request and ambiguous response
slots terminate and clear pending parser/tuple/login state. Stop must observe
closure; unconfirmed teardown returns no events. Errors contain fixed codes,
not input, upstream exception or raw chunks. Clearing is logical reference
clearing, not guaranteed physical heap erasure.

`readiness()` has no live-use switch and always returns
LIVE_EXECUTION_NOT_AUTHORIZED / liveReady=false / authorityConsumed=true /
newAccountQuota=0 / helperCompatibilityAccepted=false. Fixture success or a
model operator-gate response cannot alter this. Prior hosted run remains CLOSED
FAIL / cleanup accepted; all thirteen identities remain blocked.

This refusal follows the synthetic-only scope, consumed authority and absence of
current independent runtime evidence. No owner/Decision requirement mandates a
cryptographic nonce or phase fence for local stdio. Their absence is an observed
assumption for review, not proof that the frozen helper is intrinsically
unsupported or a new mandatory redesign requirement. Likewise its static ID
lists alone say nothing about what the separate current guard actually allows.

### Validation and actual persistent-tool evidence

The new37-test suite covers the plain startup/configuration/op schemas, source
readiness refusal, one configuration, unauthorized/premature operators, consumed
slots, overlapping response signatures, positive/denial semantics, original-age
expiry, nonrenewing/reversed clocks, every split of SGR/CRLF and terminal records,
late/extra/echo/nested/unsupported bytes, partial/zero/nonzero EOF, read/write
hangs, ingress/loop limits, idle watchdogs and failed teardown. Eighteen finite
native mock scenarios include no echo, fragmented/CRLF/SGR and fourteen fault
cases; all owned children require observed closure. Modified public-negative
DTOs are rejected by the actual mock, not only the parent API. No real credential
or untracked helper is needed. Both existing CI jobs explicitly run this suite
with unchanged exact-head checkout settings.

```text
node --test platform/tests/fill_uat_helper_contract.test.mjs
```

One actual mock spanned TWO separate persistent `mcp__node_repl__js` calls,
2026-11-01 03:04:04.004–03:04:07.206 UTC,3,202 ms. PID24360 and the original
deadline stayed constant. Call1 read ready/configure/canary login/own_today/
foreign_today (five records, ordinals1..5), leaving the process open. Call2
explicitly advanced only MODEL fixture age130 then190 and read canary denied
GET/login, model gate, A login/calendar and B login/today (seven records,
ordinals6..12). Every response remained UNFENCED with childCorrelation=false and
liveReady=false. Separate stdinEOF close returned PROCESS_CLOSED_UNAUTHENTICATED
with observed zero exit/EOF and stopConfirmed/processClosedObserved=true.
Only safe metadata was printed, never raw chunks or input echo.

Successful probe source SHA256 (no subsequent changes to these scripts):

- Pure contract: `ad79c4b8d3f9194f2f8cbad4f55838ccfef5421cb2e5b354a00d7032f1f7b8e5`.
- Fixed mock: `fa5041bf8d1df856b4734672f66c8f25dcbf3b89ed91799597cd307dfe39e540`.
- Frozen parser: `f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a`.

This is ordinary plain-wire MOCK transport evidence. SESSION-03's invented
synthetic fences, older direct execution-tool PIPE/TTY observations, and the
uninvoked frozen helper remain separate evidence classes.

### CTO-reviewable future activation plan — NOT execution authority

1. Review whether serialized unfenced response assurance suffices. If stronger
   child/run/command correlation is required, separately lease/review a helper
   change and its exact new hash; do not silently modify6ca or invent wire fields.
2. Review a real adapter/secret-input design separately. Current static invalid
   fixtures are deliberately unusable for live credentials. This batch approves
   no secret channel, key transfer, real helper invocation or account creation.
3. Before any future activation, independently verify the sole guard, current
   immutable canary verdict, exact candidate/helper/service pins, original DB T0,
   nonrenewing lease, current blocked identities and known/unknown create counts.
   The frozen static replay lists or supplied evidence strings cannot substitute.
4. Only separate applicable owner authority may define a new bounded fictional
   account budget and exact runtime/secret-logging scope. Existing authority is
   consumed; this document does not request or renew it. Canary PASS must be
   independently confirmed before operators, with bounded cleanup/readback even
   if chat/input dies. No hypothetical plan is an activation receipt.
5. Run the approved canary/UAT only after those independent gates, preserve the
   original absolute deadline, abort on missing proof, and report actual cleanup
   separately from F1 functionality. Production/public/provider/customer actions
   remain excluded. No future outcome is claimed here. `PUBLIC_GO=false`.

## Real-helper collector preparation — COLLECTOR-05, 1 November 2026

Batch `FILL-F1-COLLECTOR-05-20261101` starts at accepted
`915bf0655e839e442f785cf239e0b7e543ed674f`, same PR #8 / Issue #9. All prior
parser, transport, mock/model and helper files remain frozen. Only two new pure
modules, their two test files, this document and two test invocations in each
existing CI job are leased. Frozen helper SHA256 was checked read-only as
`6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548`.
It was never imported/launched; no launcher, real secret transport, Auth/network
client, CLI, credential discovery, staging write or account operation is added.

### Collector contract, configuration and secret lifetime

`fill_uat_helper_collector.mjs` exports `HelperCollector`, constructed with an
object containing `config`, `binding`, `authority`, an injected `transport`,
injected numeric-millisecond `wall` / `monotonic` functions, and optional bounded
response/stop limits. Its methods are `ready()`, `configure()`, `command(dto)`,
`authorizeOperators(evidence,{trustedInput:true})`, `close()`, `abort()` and
`clearSecrets()`. It is not a process launcher or a tool adapter.

Unlike ADAPTER-04's intentionally invalid fixture factory, this collector checks
and serializes the **actual supported configuration shape** for the frozen6ca
helper: exact configure/plan/principal fields, approved helper hash, ed0 candidate,
run/authorization/originalT0/identity binding, valid UTC calendar range, a
publishable-key format, and three distinct40..128-character printable passwords.
Service/preview/Supabase identities and source pins must match the reviewed
binding. Historical13 identities and frozen excluded identities cannot be reused;
known consumed run/authority IDs reject. Static lists are defense in depth,
never current owner/guard verification. Tests use exclusively public strings
marked SYNTHETIC_SENTINEL; no real key/password/configuration is read or supplied.

The input boundary is a trusted **plain object DTO**, not raw JSON text. Deep
descriptor copying rejects accessors, toJSON, custom prototypes, symbols, unknown
fields, excessive depth/nodes/strings, and unsafe field values before transport
use. It never executes an input serializer; its own JSON.stringify escapes
password quotes/backslashes. A raw JSON string, including duplicate keys, is
rejected. If an upstream caller already parsed duplicate JSON keys away, this
module cannot recover that lost information: a future caller must construct the
typed DTO directly or validate raw JSON duplicates before parsing. JS proxies
cannot be authenticated; the caller must supply trusted plain data, not hostile
proxy objects. These modules are not an RPC/authentication boundary.

Configuration lives only in private state and is cleared at the configure write,
on abort/error, or explicit clear. No public configuration/serialization getter
exists. Receipts, snapshots and fixed-code errors contain no publishable key,
password, raw input, upstream body/exception or session token. Only the injected
write callback receives the serialized configuration; future approval must cover
that exact channel's retention/logging. The callback must not log/cache it and
must honor abort. Logical reference clearing cannot erase caller-owned objects,
transport buffers, JS heap copies or tool logs; no physical zeroization is
claimed. The collector never stores/exports/refreshes an access/refresh token.

`binding` is exact run_id/authorization_id/candidate_sha/helper_sha256/pins/t0/
identities/historical_ids. Pins include Operations/Core service IDs and SHAs,
preview site ID/SHA and Supabase project ref. `authority` separately binds the
same context, owner_go_verified, consumed=false, max_new_accounts=3, issued_at,
expires_at and public_go=false. These are **trusted caller attestations**, not
proof authenticated by pure JavaScript. Constructor validation is contract
readiness, never a new owner GO. Current real authority remains consumed.

### Fixed lifetime, actual wire, observations and independent gate

The one effective expiry is the earlier of originalDBT0+1800 s and the verified
authority expiry. Configure, commands, continuation and gate cannot renew it.
Startup/configure additionally have a300 s input bound; responses cap at5 s,
stop confirmation at2 s, each read loop at1,024 reads, total ingress at64KiB and
commands at64. Wall and monotonic elapsed time must agree within2 s; reversal,
nonfinite clocks, original expiry or slow positive-window crossings abort.
Original T0 text is retained exactly for correlation, including fractional UTC
seconds. JS numeric clocks are millisecond based; canonical runtime/DB timing
must still be independently verified by the future executor/guard.

Only exact login/denied_login/get/denied_get ops, three labels and the frozen
seven routes exist. The parent consumes a slot **before** write/read ambiguity,
permits one inflight request and never retries/replays after failure. It applies
the helper's canary120 s, operator-login600 s and positive-GET1200 s windows,
post-ban120/1200 s thresholds, login prerequisites and specific positive/denial
semantics. It rechecks windows after potentially slow responses.

The unchanged strict parser handles expected safe records and fatal closed/
deadline controls. There are no invented frames/nonces. Records are atomically
released as RESPONSE_COMPLETE_UNFENCED with parent binding/ordinal and safe
observations (label, configured user_id, route, status, verified, denied, at).
The mapped user_id itself is parent context, not a newly authenticated child
claim; the owned helper's verified semantics and independent provenance remain
prerequisites. Delayed matching records cannot be cryptographically identified
by this wire. The accepted owned serialized-stdio convention is explicit, with
no new mandatory nonce/fence requirement. Unexpected/late/duplicate/echo/schema/
terminal/EOF/nonzero/overflow/stderr outcomes abort and clear pending state.

`authorizeOperators()` requires the separate reducer's current independent gate
decision AND exact equality of its five canary observations to THIS collector's
retained safe receipts: login/own_today/foreign_today, retained-token GET denial
and verified fresh-login denial. Canonical guard ban/readback and budget proof
must be independent, as must current CTO verdict/lease/digest/reference. A helper
operator_gate success alone cannot establish any of these. Only after validation
does the collector encode the actual operator_gate schema. It rechecks lease
expiry after response; operator logins also require a still-current lease.

Configured EOF follows the real helper's silent clean-exit contract. Zero exit+
EOF plus observed stop closure yields PROCESS_CLOSED_UNAUTHENTICATED, separately
from response completeness/functionality. Abort and original-expiry timers keep
cleanup intent in collector state even if a caller stops awaiting. This is not
durable process-death storage, a guard, an account ban or cleanup verification.
The existing independent Operations guard remains the sole cleanup controller.
No pure code can stop an injected callback that ignores abort or certify its
claimed close event; a future trusted adapter must observe the real close.

### Independent evidence reduction and eventual cleanup

`fill_uat_evidence_verdict.mjs` exports `reduceEvidence(binding,evidence,{at,
trustedInput})`. Without explicit trustedInput=true it returns UNKNOWN and no
operator eligibility. Even with it, `grantsOwnerGo=false` always. A caller can
forge a DTO: provenance/owner permission/current runtime truth must be verified
externally. Fixtures are not runtime receipts. The reduction's scope is the
guarded F1 read-route/lifecycle checklist below, not complete browser/mobile,
logout/revoke/membership removal/expiry/race or onboarding/MVP acceptance.

The evidence object has separately scoped binding/authority/budget/canary/
independent/operators/cleanup sections. Canary proof needs login200, own200,
foreign403, independent canonical ban+readback before original180 s, retained
GET401/403 and fresh-login400/401/403 with independently verified user_banned
semantics. HTTP400 alone is not an Auth ban proof. Known-created IDs must be
exactly the three authorized identities, unknown creates0, current active and
pending activation counts0 and unresolved nonces0. Gate requires current
independent CTO pass and lease in180..599 s. Wrong IDs/pins/run/authority/T0,
missing/late/unverified observations or pending counts yield UNKNOWN/FAIL and
operator NOT ELIGIBLE.

The user_banned attestation may come from a verified denied_login event tied to
the reviewed6ca helper semantics/hash; it does not require another Auth request,
raw response retention or an extra retry.

Functionality additionally needs BOTH A/B login, me/organizations, own Today and
Calendar200, foreign Today and Calendar403, and provenance A200/B403, with exact
identities and ordered windows. Cleanup is separate: independent guard readback,
all known three banned, all historical13 preserved banned, unknown creates0,
current active/pending activation counts0 and unresolved nonces0. These are
current-state counts, not erasure of historical activation audit totals.

Missing/failed canary, absent budget, consumed/rejected authority or a mismatched
outer envelope do not hide an independently scoped valid cleanup readback when
the expected binding itself is valid. Eventual cleanup AFTER original expiry
can still be cleanup=PASS, but cleanupLate/deadlineBreached=true and overall
f1=FAIL. Cleanup must continue after expiry: it never renews authority or makes
operators eligible. A late review of an on-time cleanup is not itself a breach.
Unknown functionality remains UNKNOWN even with cleanup PASS; functionality PASS
does not conceal missing/failed cleanup. No historical failure is reclassified.

### Validation and reviewable execution plan

All testing here uses injected **synthetic in-memory transports** only. No real
helper, native mock child, service, account or secret-input tool call is run.
The35 new tests (18collector,17reducer) and12 existing deploy/CI gate contracts
passed locally47/47 with no skips. Coverage includes real-compatible shape and
quote escaping, mutation isolation, duplicate-text/accessor/toJSON rejection,
secret/error nonreflection (including forged typed exceptions), consumed IDs,
pins, original/configuration/response deadlines, skew/reversal, gate lease and
receipt correlation, all split SGR/CRLF/terminal records, serialization/one-shot
ambiguity, positive-vs-denial semantics, callback hangs, idle abort, unconfirmed
close and separate late cleanup. Full exact-head CI runs both new files in both
existing jobs. The earlier actual PIPE/TTY/multi-tool mock receipts remain
distinct; this batch claims no new native/live execution evidence.

```text
node --test platform/tests/fill_uat_helper_collector.test.mjs
node --test platform/tests/fill_uat_evidence_verdict.test.mjs
```

Before any real execution, CTO must review the final collector/reducer source
and a specific private transport wrapper with observed process ownership/close
and bounded raw-buffer retention. Owner authority must separately cover the
exact candidate/helper/environment, new fictional identity budget, channel and
possible secret/tool-log retention; current consumed scope is not renewed here.
Verify actual protected preview/Operations/Core/Supabase pins, all historical13
blocked, current independent guard/cleanup health, zero unknown creates/nonces,
and capture immutable original DBT0/expiry and current revocation conditions.
Use supported Auth Admin only under such authority. Canary positive/ban/Auth
proof and independent current CTO verdict/lease precede any operator activation.
Missing proof/revocation/ambiguity triggers collector abort plus independent
guard cleanup/readback; cleanup continues past expiry if necessary and timing
failure remains recorded. A future wrapper must respond to revocation explicitly;
the pure collector cannot poll or authenticate external revocation state.

The concrete remaining gate is independently reviewed runtime/secret handling
and applicable new owner authority with actual guard evidence, NOT another
invented protocol redesign. This batch makes no activation/quota/GO request and
changes no hosted approval marker. Production/public/paid/provider/customer/
booking/hold/payment/outreach remain excluded. `PUBLIC_GO=false`.

## Owned process transport preparation — RUNTIME-PREP-06, 1 November 2026

Batch `FILL-F1-RUNTIME-PREP-06-20261101` starts at accepted
`e576d75c6387615199a8171413ac338f6d6a1f4e`, same PR #8 / Issue #9. Only the new
process transport, fixed public child, their test file, this document and one
new test invocation in each CI job are leased. Collector/reducer/parser/models
and frozen Python helper are unchanged. There is no import-time subprocess or
CLI in the transport module. No REAL helper invocation, network/Auth/account
operation, actual credential input, deploy, restart or config write occurred.

### Fixed targets and future-only real launch

`fill_uat_process_transport.mjs` exports `launchReviewedLiveCollector()` for
**future separately reviewed use**, not current activation. Its only arguments
are config, binding and a required external `checkCurrentPermit` function. A
boolean permit/default GO, arbitrary executable/helper path/argv/environment/
shell, or fallback interpreter is not accepted. The wrapper uses real wall and
monotonic clocks and the unchanged `HelperCollector` for actual configuration
validation and serialization. It returns only collector + safe processEvidence;
the underlying child/raw pipe handles are not returned by either factory.

The exact existing Python/helper locations were derived read-only from local
file inventory and the existing pyvenv.cfg; neither interpreter nor helper was
executed. Paths are fixed to this existing executor checkout, with no guessing,
installation or relocation search. Before any possible real spawn, the factory
checks an external permit, verifies fixed files, then checks the permit again.
It requires Windows, ordinary files/no file symlink, matching real paths and:

Fixed-file hashing streams64KiB chunks, caps each input at32MiB and closes the
stream on success/error; it does not buffer an arbitrary changed file in RAM.

| Fixed file | SHA256 from read-only inventory / accepted source |
| --- | --- |
| `.work/f1-readonly-validator.py` | `6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548` |
| `.work/f1-auth-admin-venv/Scripts/python.exe` | `9f29b8965d6bf169315bbc20946f33b23c9dacb4587c3cccaf1f536b844b2dc2` |
| `.work/f1-auth-admin-venv/pyvenv.cfg` | `fb495c656cb2605b9acdaa9e32df46ba855ea4470a0568a25ec962dcb79d1a31` |
| Existing base Python executable | `f8b45d63047da9d9adf09892e4cc4317b859e86a93a478cc9616bc69d3b176e5` |
| Accepted collector | `4751a40941ddb9379e6d7efc96f6b8e207fc3aa7d45d9e1965c623cb891cad04` |
| Accepted reducer | `a63c49bba0a97304820dec05cd5a00ae197065b084e573e7bf938857c4e223da` |
| Accepted strict parser | `f4dd8fef0f3088eceb4043b0ddbaa48e08fd2508c6200aea7c41fe5f0281cb5a` |

pyvenv.cfg identifies Python3.12.14 at
`C:/Users/Thinkpad X1 Gen7/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`.
The future fixed invocation is the existing venv interpreter with
`-I -B <fixed-helper> --hosted-owner-approved`, shell=false/windowsHide=true,
stdio pipes, fixed helper working directory and empty environment except
noncredential Windows SystemRoot. These Python flags/dependency/runtime
compatibility have NOT been exercised here. The permit also must bind the
reviewed transport module's SHA256, independently supplied by the checker.

These snapshots do not authenticate the whole venv/dependency tree, attest the
machine or eliminate filesystem TOCTOU between verification and execution. They
assume the trusted existing executor/filesystem and protected immutable files.
This is a practical review boundary, not a new requirement to reinstall, invent
cryptography or redesign the accepted stdio protocol. CI never invokes the live
factory with a valid permit or depends on local untracked Python resources.

### Trusted current checkpoint and latency — PREPARED, not operational

The external checker is a **trusted caller dependency**. Source strings,
structured DTO fields or booleans cannot authenticate it. Its record must bind
exact run/authorization/candidate/helper/service pins/T0/identities/history and
applicable owner authority, original expiry, current revocation epoch, guard
health, zero unknown creates/nonces and the exact narrow protected-staging/
frozen-helper/stdin-credential scopes. Known consumed IDs reject. No function
here mints a permit, refreshes owner authority or queries a provider/secret API.

The checker is consulted before hashes, immediately before launch, before every
stdin write and while idle. Epoch rollback, revocation, stale/missing facts,
timeout or original expiry stop the owned process. The real deadline is fixed
at the earliest originalDBT0+1800 / authority / initial permit expiry; new cached
records cannot extend it. There is no default activation, hidden switch or CLI.

The current engineering assumptions are10 s maximum checkpoint age,2 s maximum
checker callback and1 s idle polling. They are NOT owner/Decision requirements
or a measured production SLA. Ten seconds allows several-second canonical
readbacks more room than the rejected1 s assumption; the approximate worst idle
stale-detection+stop bound is10+1+2+2=15 s, always capped by original expiry.
This is not instantaneous revocation. The independent Operations guard and its
actual account/lease limits remain authoritative regardless of client timing.

A concrete future integration would have the existing sole authorized executor
obtain canonical owner/guard readbacks outside Node REPL callbacks, verify them,
and update one typed in-memory checkpoint in the already-owned session. A small
checker closure would only read/validate that cached checkpoint, without MCP or
network access inside the callback. Facts retain their ORIGINAL observed
timestamp: receiving/reading the cache or continuing a chat must never re-stamp
them as fresh. An upstream readback taking3–5 s leaves only5–7 s of the proposed
age budget; update cadence/latency and revocation delivery need measurement
before live readiness, with no new accounts merely to discover latency failure.
Failure to maintain the cache closes the process; no retry/lease/quota renewal.

**No such authenticated checkpoint publisher/checker bridge is implemented or
operationally verified in this batch.** MCP reads cannot run automatically inside
the Node callback. The wrapper is therefore PREPARED source, not an executable
live plan or secret-channel approval. A future approved integration must also
deliver revocation/abort and independently validate cleanup. No extra automation,
resource, direct secret/API shortcut or fabricated freshness is authorized here.

### Pipe ownership, secret handling and failure closure

`OwnedStdioTransport` is a bounded stream adapter; its injected-child interface
is used by offline stream fixtures and cannot choose/launch a target. Only the
two fixed factories create processes. An error observer (which discards the
exception) AND independent close observer attach immediately after spawn,
before constructors/awaits. Any later setup failure stops and observes that child
even when the transport constructor did not return. Deferred stop cannot claim
true merely because an engine is absent after spawn. A deterministic native
setup_failure fixture and asynchronous fake-owned error regression cover this.
Spawn attempted, actual PID, error observation, stdout EOF, process exit and
close are distinct; a kill return or stream EOF alone is never close proof.

The accepted collector owns configuration and passes it only memory→owned stdin.
No password/key goes to argv, environment, temporary file, stderr, snapshot,
receipt or debug method. Writes cap at16KiB, serialize one at a time and require
both completion callback and drain when backpressured. Abort/error/timeout
removes pending listeners, discards local references, destroys stdin on forced
stop, and waits at most2 s for observed close. Node/OS buffers and caller-owned
objects are not physically erased; a future channel still needs explicit owner
acceptance of its actual retention/logging. No current secrets are discovered.

Stdout is bounded by64KiB total ingress,64KiB queued bytes and256 chunks; high-bit
bytes reject before decoding. Stderr is drained without retaining text. Unknown
stdout/echo/CSI is handled by the frozen strict collector/parser, not stripped
or searched for nested JSON. Receipts expose counters/fixed codes/owned PID only,
with no raw chunk or upstream exception. Read/write concurrency and errors fence
the process. Closed pipes report zero/nonzero exit only after the actual child
close event; exit and stdout-end observations are tracked separately. Stop is
idempotent; unconfirmed close is never success.

Native child kill/EOF is **not account ban, logout, revocation or cleanup**.
Collector cleanup intent remains set and processEvidence.accountCleanupVerified
remains false. Parent timers do not survive parent/kernel death; the public child
has its own20 s watchdog, while the frozen real helper has its own configuration/
original-deadline watchdogs. Actual account cleanup still belongs exclusively to
the independent existing Operations guard, including after executor death/expiry.

### Fixed public child and actual two-call proof

`fill_uat_synthetic_wire_child.mjs` has no network/live-helper import. It accepts
ONLY exact canonical public predetermined configure/command DTOs; passwords/key/
run/user substitutions, duplicate-key JSON, URLs and arbitrary input reject.
Values are public SYNTHETIC_SENTINEL/zero UUID fixtures. Replies use the genuine
plain six-key JSONL wire, without invented FMC frames/nonces. Nineteen finite
scenarios cover normal/fragmented/CRLF/SGR, faults and deterministic setup error.
Its CLI is inert on import and its independent watchdog is20 s.

`createSentinelCollector()` fixes this child/path/executable and provides only
the accepted collector, a safe process snapshot and finite forward MODEL-age
advancement. It has an immutable REAL monotonic lifetime of at most18 s, separate
from the collector's fixed2030 fictional T0/expiry. It accepts no arbitrary
credential/config/path/executable/environment override. The public child does
not supply a real canary/CTO verdict or open the collector's independent gate.

Actual persistent Node REPL proof, ONE child across TWO separate tool calls:
2026-11-01 **03:50:36.488–03:50:40.731 UTC /4,243 ms**, same PID20716. Call1
read ready/configure/canary login/own_today/foreign_today (five records,
ordinals1..5). Call2 advanced only MODEL ages130/131, read retained/fresh denial
(two records, ordinals6..7), then closed stdin. All responses remained
RESPONSE_COMPLETE_UNFENCED with boundaryVerified=false/grantsOwnerGo=false.
The REAL deadline18252.5484 stayed unchanged; MODEL original expiry remained
2030-01-01T00:30:00.000Z. Separate close returned
PROCESS_CLOSED_UNAUTHENTICATED; stdoutEOF/exit/close were observed, exit0,
stopConfirmed=true, queue0/writeInFlight=false. accountCleanupVerified=false,
actualHelperLaunched=false, hostedAcceptance=false. Only safe metadata printed.

Probe-bound source SHA256 (scripts unchanged after proof):

- Transport: `831b3e2d460390cb194e956499e2e3567c0185f2fe6a2e7ecc7c1926abd504cf`.
- Public child: `a41f6cc6b99e75d12d91bf4be144185dfe91e87606e0c861fd8cb9f80a3644d8`.
- Frozen collector: `4751a40941ddb9379e6d7efc96f6b8e207fc3aa7d45d9e1965c623cb891cad04`.

Earlier interim transport6fbb1dce… had a6,601 ms Work probe and an independent
314 ms CTO probe, both successfully closed. A subsequent cold future-launch
change bounded fixed-file hashing, so those remain interim evidence. After32
affected tests passed, the documented reset cleared the closed REPL/module cache
and the final two-call probe above bound the final831b3e2d… bytes. No real helper,
current secret, account or unchanged-source retry was involved.

The32 new tests pass locally, including all finite native scenarios/observed
teardown, backpressure, buffers, callbacks, early setup errors, deadlines, idle
revocation/expiry, missing/stale/consumed permits, cached timestamps and no live
factory invocation. Twelve existing deploy/CI gates also passed in the affected
checks. Both existing CI jobs explicitly run the new suite on the exact head.
These are transport/code checks; the REAL path remains uninvoked/unverified.

### Remaining activation prerequisites

CTO must review this exact transport/hash, actual cached-checkpoint integration
and measured latency/revocation behavior, trusted host/dependency assumptions,
private stdin/log retention, and real interpreter/helper compatibility before
calling the future live factory. Separately applicable owner authority must
cover exact environment/candidate/helper/transport, secret handling and a new
fictional identity budget; the original budget remains CONSUMED and all13
historical identities preserved banned. This batch requests no GO/quota.

Future execution still requires current protected preview/Operations/Core/
Supabase pins, independently healthy sole cleanup guard, known identities/counts
and settled nonces, immutable originalDBT0/expiry and canary proof before the
independent CTO verdict/operators. Missing proof/revocation/ambiguity aborts;
account cleanup/readback continues independently even after expiry, preserving
timing FAIL separately from eventual cleanup PASS. Nothing here is hosted F1 or
MVP/pilot acceptance. No production/public/provider/customer/booking/hold/pay/
paid/outreach action or new infrastructure is authorized. `PUBLIC_GO=false`.

## CHECKPOINT-07 — canonical readback and externally driven relay (source only)

Base `b51bfe6880d908bf7e8365728b5f205d11f9da40`; exclusive four-path lease:
`platform/scripts/fill_uat_checkpoint_bridge.mjs`, its new test,
this readout, and one test invocation in each existing Platform CI job.
The collector, reducer, process transport, parser, public child and Python6ca
are frozen. No live helper, account, Auth API, secret transfer, row write,
deployment or additional runtime authority is part of this batch.

### Schema, query and trust boundary

The bridge reads the actual `20261030202410_fill_uat_guard.sql` and
`20261031004340_fill_uat_bootstrap.sql` schema through a single bounded SELECT.
`buildCheckpointReadPlan({run_id,known_ids,expected_lease_digest})` returns
the query, SHA256, three-slot parameter template and validated parameters.
The existing official raw-SQL connector accepts no separate bind arguments:
only validated lowercase UUID/hex literals are rendered into those three
slots. No caller SQL or identifier is accepted. The project is fixed to
`yclqnbcrchwieyzkyumx`; run count1, principals<=3, attempts<=6, scoped Auth IDs<=16.
The query reads one overflow sentinel beyond collection limits so malformed
extra rows fail validation instead of disappearing. It performs no DML/DDL,
locking, server file read or Auth operation.

Projection: DB `clock_timestamp()`; immutable run/spec IDs, candidate, two
organizations, original starts/expiry, armed/stopped/health/cleanup flags and
receipt count; intent authorization/deployment/admission times, stopped and
reconciliation flags; principal ID/label/ban/expiry/receipt/isolation; attempt
label/operation/scoped user ID/verified/settled/has-nonce/reservation/first-ban
times; allowlisted Auth `id,banned_until` only. Out-of-scope principal/attempt
IDs are masked and rejected. Membership inspection returns only an isolation
boolean for those IDs and the two fixed fictional organizations.

No raw spec, verdict, nonce, email, password/hash, key, token or input_digest
is returned. The password-bearing bootstrap input_digest produces only a
format-valid boolean. The public lease/spec SHA256 is compared server-side
against the separately supplied expected digest and against the verdict;
only comparison booleans leave the query. A closed diagnostic may omit the
expected public digest and therefore cannot become an active permit.

`decodeReadback` accepts exact JSON rows and the official connector's nested
result/text envelopes, including its exact symmetric untrusted-data wrapper.
It parses data only, rejects mismatched/nested/multiple tags and arbitrary log
prefixes, and never evaluates returned instructions. Typed rows have exact
keys, bounded arrays, finite UTC timestamps retaining microseconds, scope and
identity checks. Unexpected output becomes fixed safe DENY metadata.

DTOs do not authenticate their own provenance. A trusted external caller must
bind tool/project/query SHA and independently supply verified, current owner
authority, original T0, disjoint new3/historical13 identities, deployment,
public lease digest, accepted pins and frozen transport SHA. Neither the
query, mapper nor trusted_readback flag grants GO. Missing/consumed authority,
stopped/reconciliation state, unknown creation/unsettled activation, stale
health, scope conflict or expired original window denies. All13 historical
IDs must have current supported long-ban metadata. A create's settled=false
is normal; a verified settled activation can await first-ban within its
original window. request_expires_at controls start admission, not active
lease renewal. Null independent verdict allows only the canary phase; an
operator activation requires the canonical scoped PASS and timely canary
ban. The frozen collector still owns its independent operator gate.

### Concrete existing-tool invocation and cache handoff

The trusted driver uses `relay.begin()` in persistent Node REPL, then calls
the EXISTING official tool OUTSIDE any REPL callback:

```js
const result = await tools.mcp__codex_apps__supabase_execute_sql({
  project_id: ticket.plan.project_id,
  query: ticket.plan.query
});
// Existing Node REPL then receives safe JSON DTOs:
await relay.complete(ticket.sequence, result, {
  tool: 'mcp__codex_apps__supabase_execute_sql',
  project_id: ticket.plan.project_id,
  query_sha256: ticket.plan.query_sha256,
  trusted_readback: true
});
// publish(envelope) -> cache.install(envelope)
// Future accepted transport callback: () => cache.current()
```

This is an externally driven adapter, not automatic MCP access from a Node
callback, a new service, scheduler or network client. `refresh()` is optional
dependency injection for a trusted driver that already owns a read function;
this batch does not add one to the live helper. The actual one-shot uses a
single functions.exec orchestration begin -> official SELECT -> complete,
with no model/typing boundary between those steps.

Final read timeout<=6s, external minimum start-to-start cadence2.5s,
publish wait<=500ms for an in-memory install. A stuck
read/publisher settles the caller's wait; this does NOT cancel the underlying
tool/network/publisher promise. Late completion cannot restore an older ALLOW
over a higher sequence DENY. Original DB checked_at is never re-stamped.
Cache current() expires it after10s, separately checks the ORIGINAL guard
healthy_at+45s and original run/authority expiry, and latches clock reversal,
changed T0/expiry, revocation and terminal failures. Its cleanup evidence
retains the original DB observation separately even after denial/stop.

Cadence is not an extra sleep after a slow read: when a read exceeds2.5s,
the next read can start immediately after completion. A hypothetical6s
read+500ms publish must still arrive before the previous DB observation+10s;
additional host scheduling can consume the remaining margin. The frozen transport's
bounded checker wait (2s) and idle check (1s) do not renew that budget. This
is an assumption requiring measured margin, not demonstrated active safety.
The bridge performs no autonomous refresh. Guard cleanup stays independent.

### Initial one real CLOSED read; original4s latency gate FAIL, cleanup PASS

Closed run `0e3a5a5a-fa68-4b3f-9a96-bdca500b1ab4`, expected digest=null,
exact CTO-known13 allowlist, one official Supabase SELECT; no retry.
Query SHA256:
`ad1f55fd9ed6fecf47e59187dc6fc2e482418bbd3e6919bc4935dc8bb368dd34`.
Result envelope keys content/structuredContent/isError, one text5887 bytes,
strict snapshot accepted. DB observation **2026-11-01T04:18:26.926995Z**.
Original T0 **2026-10-31T10:03:01.320855Z**, expiry **10:33:01.320855Z**;
healthy_at **10:09:56.780556Z**. Three principals, four attempts (one activation),
unknown creates0, unsettled activations0; all13 long-banned, active0,
run/intent stopped=true, cleanup_complete=true, reconciliation_required=true,
canonical verdict=fail. Mapper DENY/permit=null/operatorGateEligible=false,
with CONSUMED_CONTEXT/stopped/expired/guard-unhealthy/FAIL/no-owner reasons.
Cleanup independently PASS AS OF that observation; it does not erase timing
or canary failure, reconciliation or consumed authority.

Measured official tool roundtrip **4891ms >4000ms**. The independent relay
timer published READ_TIMEOUT, complete returnedfalse, and cache latched DENY.
The retained result was decoded as a separate closed diagnostic with source
age65.005ms; that small age reflects the DB observation near response time
and does not make the4891ms read meet its4s gate. The same retained DENY
diagnostic was installed as sequence2 to preserve cleanup, with no immediate
query repeat or ALLOW. Relay was stopped. This proves fail-closed timeout behavior,
NOT a successful current-checkpoint handoff or active helper integration.
After this probe, cache envelope typing was tightened. CTO then explicitly
extended the batch for the engineering budget correction and EXACTLY TWO
additional dry SELECTs below. The first timeout receipt remains unchanged.

### Final source: two consecutive CLOSED publications, measured margin PASS

CTO correction:6s read cap and500ms in-memory publisher wait, unchanged10s
cache freshness/2s frozen checker wait/1s frozen idle poll/45s guard health
and immutable original T0/authority expiry. No runtime authority, account
quota or live launch was added. Exactly two additional SELECTs ran using the
SAME closed run/query hash/known13 projection, each as begin -> official SQL
outside REPL -> complete/cache within ONE functions.exec orchestration, with
no model/typing delay and no added2.5s post-read sleep.

Both bound these final bridge bytes, SHA256:
`387dc8b9c0f8579844cde1ca7c2f42250a4d20d085b037718a3bbcff98cd8998`.

| Dry read | DB observed_at UTC | Received UTC | Published UTC | Official tool RTT | Full relay RTT | Source age at mapping |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-01 04:21:50.712893 | 04:21:50.764 | 04:21:50.772 | 3932ms | 3995.2823ms | 51.107ms |
| 2 | 2026-11-01 04:21:53.717822 | 04:21:53.756 | 04:21:53.760 | 2883ms | 2936.2929ms | 38.178ms |

Both complete returned a typed result and cache install=true. Publication2
arrived **6952.893ms BEFORE observation1+10s**. No prior observation existed
inside this new dry relay for publication1, so its continuity margin is N/A.
These two samples show a positive consecutive CLOSED read/cache margin under
the revised budget; they do not prove production latency bounds or an active
permit/helper path. Both states remained DENY/permit=null/cleanupPASS,
knownBanCount13/active0/unknownCreates0/unsettledActivations0, consumed,
stopped, reconciliation_required=true, canonicalFAIL, expired and no owner.
Original T0/expiry/healthy_at stayed exactly as above. Relay and cache were
explicitly stopped, cache closed/latched=true, with original last verified
cleanup retained at04:21:53.717822Z. No more reads, helper invocation, Auth
operation or row write was performed. Total real SELECT count for this batch3.

### Offline Python6ca compatibility: distinct from hosted acceptance

Exactly once, the existing reviewed interpreter ran the unchanged helper:
`.work/f1-auth-admin-venv/Scripts/python.exe -I -B .work/f1-readonly-validator.py --self-test`.
ProcessStartInfo used no shell/window; environment was cleared except
SystemRoot; no stdin/credential was supplied. Inspected self-test clients use
httpx.MockTransport only; helper config tests patch httpx.Client. Output:
`{"offline_self_test":"PASS","cases":41,"real_network_calls":0}`.
Exit0, elapsed1430ms, stderr0, process closed. This was not a live helper run.

Verified before execution: helper6ca033af474c21180652652c21ee6d4d4dafd16d379a4c11eb646d9ac9e53548;
venv interpreter9f29b8965d6bf169315bbc20946f33b23c9dacb4587c3cccaf1f536b844b2dc2;
pyvenv.cfg fb495c656cb2605b9acdaa9e32df46ba855ea4470a0568a25ec962dcb79d1a31.
Helper hash remained unchanged afterward. The one permitted offline self-test
has been consumed and will not be repeated for this batch.

The34 new synthetic tests cover active schema-to-permit/cached callback,
canary/independent operator gating, scope/time/authority conflicts, historical
bans, strict connector wrapper, cleanup separate from consumed DENY, original
timestamps, rollback/reordering/revocation, stuck read/publish, bounded waits,
late completion and no query after expiry, a real4.9s injected read under6s,
minimum start cadence, and slow/hung500ms publisher waits. Frozen source hashes are checked;
both existing exact-head CI jobs include the new suite. Twelve deployment/CI
safety gates also passed locally. No valid live factory invocation occurred.

DONE: typed canonical query/decoder/mapper and externally driven cache/relay,
synthetic active-path tests, three scoped closed reads including initial
timeout and revised two-sample margin, one offline41-case compatibility
check. NOT DONE: active live checkpoint integration/ongoing margin, REAL helper
launch/current stdin, canary/F1 hosted browser UAT or MVP/pilot acceptance.
Main blocker: actual active helper/current-permit path remains uninvoked and
requires CTO acceptance plus separately applicable runtime authority.
Next: CTO reviews this exact bridge/transport integration and measured timing,
including the preserved initial timeout and limited two-sample CLOSED pass.
This batch requests no new GO/quota; prior authority is consumed and all13
historical accounts remain banned. `PUBLIC_GO=false`; production untouched.

## FILL-F1-19-BATCH-11: source and foreground preparation, no runtime yet

The owner granted exactly one fresh attempt and at most three new fictional
identities in the original CTO chat, human message
`01a195d0-a2d3-7492-ada1-13093bfac556`. Native readback verified it. The prior
`4c0cdb3b-c138-479b-9b69-fef96420642b` attempt remains FAIL, its authority
`01a1958f-5bc5-7382-822d-27d4db023a3e` consumed, and all16 previous identities
must remain long-banned. This section records PHASE A, not runtime acceptance.

The binding now requires exactly16 distinct historical identities disjoint
from the three new principals; known scope is capped at19. The query reads
only validated explicit IDs, narrow ban metadata, one run, at most three
principals and six operation slots. Its Auth subquery limit20 detects an
oversized result without widening the allowlisted scope. Closed16 diagnostic
scopes remain DENY without owner authority. Old run/authority are explicitly
consumed. Backend, migrations, helper6ca, deployed Operationsed0, Core and
workers, protected preview, Get source and provider rules are unchanged.

The canonical historical16 set is the earlier13 plus:

- `70e38a5b-a980-4b1a-8a62-e7478fcb8b08`
- `9e30235b-9ddf-4a7f-83dc-1aa95bd56c0b`
- `b3ab3f9d-b94c-456c-84f0-35181e0ec224`

The actual controller is now reviewed as
`platform/scripts/fill_uat_foreground_controller.mjs`, with portable PUBLIC
2030 model tests. Its live installer still uses the existing fixed Windows
checkout and one unchanged reviewed helper. The local serialization wrapper
must match this controller function exactly. Genuine owner/source acceptance
and exact checkout/hash verification are trusted caller prerequisites:
`trustedOwnerReceiptVerified` and `trustedSourceAcceptanceVerified` do not
authenticate themselves. Source SHA must equal the independently accepted SHA.
No public fixture or readiness receipt grants owner GO.

Canary readiness requires all three verified creates, a verified and settled
canary activation and fresh guard before the first positive helper command.
After independent canary acceptance, the controller holds WAIT_OPERATORS until
BOTH a/b activation rows are verified and settled, identity/nonce correlated,
the current guard is healthy and both operators are unbanned. A missing b or
a short canonical reserved b slot does not consume a gate/login. A pending
known slot is bounded below10s, never ALLOW, and never refreshes the permit:
the prior genuine permit retains its original DB timestamp and10s expiry.
Unknown/mismatched/overdue state, stale guard/cache or revocation is terminal.
Only after both ready does one helper gate and one login per operator occur,
under the original below600s admission window. The backend is not changed.

### One awaited tool lifetime, before allocation

`platform/scripts/fill_uat_foreground_lifetime.mjs` runs this complete sequence
in ONE awaited `functions.exec`, with functions and ControlRpc retained in that
same isolate:

```javascript
await runFillLifetime({
  scope, rpc,
  prepare: () => prepareFillForeground(tools, {prepare_id}, rpc),
  arm: prepared => armFillForeground(prepared, scope),
  admit: () => existingTrustedCanonicalAdmission(),
  run: armed => runFillForeground(tools, scope, armed),
});
```

The trusted admission callback is bound and reviewed before this invocation.
It is invoked exactly once only after actual install, arm and lookup complete.
No prepared object/method is serialized through store or another fresh exec;
there is no slow INSTALL after release, model-turn heartbeat or detached
controller. Modules compiled into the V8 caller use separate lexical scopes.
The root observer uses canonical receipts without steering the foreground.
`live_ready`/`pre_t0` are scheduling/protocol prerequisites, not authenticated
proof that canonical T0 is absent or permission to allocate accounts. Existing
owner preflight and before-account canonical admission are still mandatory.

Early stop/rejected arm/discovery timeout clears NEW password/client_plan
references without changing actual account counts or consuming/renewing GO.
Every failed arm/readiness/lookup closes its exact owned host; late install
and factory ownership are retained. Safe finite caller stage/RPC code and
duration are preserved; raw errors/configuration are discarded. Late admission
cannot enter foreground; unresolved ownership is explicitly reported. The
automatic server guard remains responsible for any eventual account cleanup.
Existing active2s/checker2s/DBfresh10s/read6s/publish500ms/guard45s/canary120-180s
and original30min limits are unchanged, with no active retry or renewal.

### Verification and pre-account gates

Local complete Fill UAT suites:219PASS/0FAIL/0SKIP. Deployment/CI safety
contracts:12PASS. They cover19 boundaries/disjointness/old bans/consumed context,
pending and ambiguous state, actual controller cleanup, staggered operator
readiness, independent JSON-first gate, method identity and failed lifetime
stages. A PUBLIC exact functions/V8 integration of the actual wrapper plus
lifetime completed a real3103ms fake install BEFORE admission, then arm/lookup,
one admission and foreground stub, ending with pending0/timers0 and no real
network/Auth/helper activity. Both exact-head CI jobs include the new suites;
the actual full final-SHA CI result belongs in the canonical handback receipts.

After confirming the previous driver stopped/no task pending, neutral host
closed/unarmed and prior RPC pending0, the sole executor used the supported
reset of its own Node kernel. A fresh actual REPL import accepted16history+3,
rejected old13 and missing-history15, confirmed max19 and both consumed IDs;
loaded dependency hashes matched disk. No source-cache-busting assumption was
used. Before credentials, the accepted final source and loaded semantics must
still match; if dependencies change, repeat this pre-account readiness check
in a safely reset own kernel, without a process or account.

Before push, PR8 title `[skip netlify]` and all four Railway exact commit pins
were read back: Operationsed0, Core0134f603, both workers3d5ef5d6, no staged
changes. No new source SHA may deploy. Root must independently accept this
final source and concrete lifetime before runtime. Then verify protected ed0
alias/manifest/form/anon401, four healthy pins, old16 bans, no unknown/pending,
sole foreground/automatic guard, supported Admin preflight, fixed interpreter
and helper hashes/clock. Only a fresh INPUT and at most one selected SAME-BUILD
Operations redeploy is authorized; no Netlify/new-SHA/other-service deploy.
Any proposed single bounded closed transport read requires that source/flow
handback acceptance first; none was executed in PHASE A.

DONE: source19 contract, whole-lifetime implementation and public evidence.
NOT DONE: new runtime attempt/canary/operator hosted acceptance, full F1 browser
desktop/mobile/logout/revoke/expiry UAT, onboarding or MVP/pilot acceptance.
Main current gate: independent CTO final-source/flow acceptance plus actual
pre-account technical readiness. No credentials/input/intent/T0/accounts or
runtime allocation have been created for this new attempt. `PUBLIC_GO=false`.
