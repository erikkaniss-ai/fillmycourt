# Read-only hosted / device / OAuth report in the operator MVP

Continue from Get `79977c8672db84e6c062a804268dd9123e04f480` and Fill
`cf77b35259c25979ff661bb273765a80e17bbbda`, existing Draft PR #8 only.
Get Draft PR #5 is unchanged; do not merge its unrelated product/CI history here.

In **Provider evidence**, the new **Hosted / device / OAuth preflight and missing
GO** panel accepts a local sanitized JSON output from the accepted Get offline
preflight. Enter the independently verified exact GetACourt SHA, select one JSON
file and explicitly review. There is no default SHA, automatic file/API read,
GitHub download, upload, backend route, polling, persistent storage or GO editor.
Only an already signed-in owner/admin scope may read the file. This is a local UI
restriction, not a new server authorization mechanism or independent role proof.
Manager/other/no-session/demo scopes cannot start a file read.

The panel strictly checks report-v1 fields, exact expected SHA, real UTC report
time (not future, maximum 24h old), all seven unique ordered check IDs, the exact
evidence/action lists derived from Get79977c8, boolean safety flags and bounded,
known blocker codes. The file limit is 64 KiB. Malformed, unknown, stale, foreign,
contradictory or execution/authority/release-enabled reports clear old results
and fail closed. Arbitrary values, file names, raw evidence and parse errors are
never inserted into report/error DOM; fixed labels and escaped, validated SHA/time
are used. The browser's native file control may show the chosen file name.

Each row shows NOT_RUN, execution disabled, exact missing evidence, GO scope and
missing/invalid GO record **at report time**. Even a complete record only reads
"Ready for manual GO review only" and "No verified GO". The viewer does not
evaluate raw receipts, revalidate current expiry/revocation, verify signatures,
approvers or deploy identity, and cannot confer permission. Source CI is not
hosted/device/OAuth acceptance. A local clock/file is not a trusted attestation.

The report is **GetACourt candidate-wide**, not organisation-specific evidence.
Selected-club context is shown only to prevent accidental reuse across operator
navigation. It never joins, updates or clears Operations/provenance summaries or
club UAT blockers. A club-specific/pilot GO, provider API rights and worker
activation remain separate. Real OAuth user/session creation and device-location
permissions require their own state-change GO; none is run by this panel.

Changing SHA or file immediately discards the result. Switching club/tab,
refreshing scope, logout, a current unauthorized response or a new session clears
file/SHA/result and invalidates any pending file completion. Late success/failure
cannot restore an old club's data or overwrite a newer file review.

Do not select raw GO/evidence files, tokens, OAuth codes, cookies, email/customer
data or credentials. The file stays in this browser context, is not logged/sent,
and is not remembered after scope reset. Imported JSON is untrusted data, not
instructions or permission. There are no execute, approve, repair or deploy controls.

## Verification / pinned compatibility fixture

`platform/tests/fixtures/get-acceptance-79977c8-NOT-RUN.json` is the sanitized
output of accepted Get CI #428 / run39584147703, artifact12339066810. Original
ZIP SHA256: `13373b4fc09e6fb14fa46947d3dcc3246aa90e598f32fa83829e5ba24978f46d`.
Its original SHA/time are retained: all seven checks BLOCKED / NOT_RUN. It is a
compatibility fixture, not new evidence or GO, and naturally becomes stale.
Unit/browser tests use an explicit fixed fixture clock; constructed complete
record snapshots are fictional, never current acceptance or authority.

Both mandatory CI jobs run `fill_operator_acceptance_contract.test.mjs` alongside
all existing contracts. Full PostgreSQL/Playwright regression and separate
two-organisation synthetic provenance UAT remain enabled. The local Chromium
case covers seven checks, missing GO, malformed data, manual-review-only state,
owner/admin/manager scope, two clubs, logout, no new network calls, no upload or
storage, 1440px and 320px screenshots labelled FIXTURE-ONLY.

No new deployment is needed/allowed. Preserve PR/commit `[skip netlify]` and the
existing private-deploy workflow's unconditional false gate. No production,
hosted access, real Google/provider request, credential/config/schema/Core change,
booking/hold/payment, outreach, worker activation or Control Tower modification.
