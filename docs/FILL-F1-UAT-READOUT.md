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
`SystemRoot`. Stderr is drained without retaining text and immediately aborts
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

The new suite has 32 tests. A normal native child completes all five phases with
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
and deployment/CI gate regressions passed **78/78**, with no skips. Only the
new suite needs repetition after a new session-test change; full required CI is
run once on the final source candidate.

Actual persistent-tool probe on 1 November 2026:

1. Documented `mcp__node_repl__js` persistent state, repository file access and
   dynamic imports of `node:fs/promises`, `node:url` and `node:child_process`
   succeeded. Documentation explicitly says `node:process` import is unavailable;
   the absence of a global `process` was observed in the next step.
2. The first session probe failed while dynamically importing the source module:
   **`process is not defined`** at its producer's main-entry guard. Import did
   not complete; `createSyntheticSession()` was never called, no child was
   launched and no phase command was sent. This is the tool's observed error,
   not an automatic approval rejection or proof that a spawn was attempted.
3. Per the CTO plan, that probe was stopped. No alternate process import,
   executable derivation, terminal/security setting, hidden bridge, installation
   or permission workaround was attempted. No raw producer output existed.

Therefore **two-call persistent-tool no-echo acceptance is NOT ESTABLISHED**.
Ordinary Node child PIPE tests establish only their own source contract. Prior
direct execution-tool PIPE and TTY observations remain separate and unchanged;
none proves this persistent tool or compatibility with the frozen hosted helper.
The historical run cause stays UNKNOWN and its authority stays consumed, with
all thirteen prior identities blocked. No Auth/staging/helper/account/credential
operation or new UAT/quota request belongs to SESSION-03. The remaining gate is
a documented, supported actual-tool capability reviewed by CTO; this batch does
not implement a substitute credential transport. `PUBLIC_GO=false`.
