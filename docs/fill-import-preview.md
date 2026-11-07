# People-import CSV parsing

The existing Operations `POST /api/fmc/{org}/imports` handler uses
`parse_people_csv` before opening its database context. The helper only parses
text and returns staged people rows plus semantic row errors. This change adds
no endpoint, UI, booking writer, provider connection, or hosted deployment.

## Accepted input and retained behavior

- CSV text is 1–2,500,000 characters, matching `ImportIn`. The Python CSV
  library's existing field-size limit remains in force and is never changed.
- Headers are an exact subset of `external_id,name,email,phone,marketing_consent`,
  in any order. Optional headers can be omitted. Headers are not trimmed and a
  BOM is not automatically removed. Duplicate, unknown and empty headers fail.
- Cells are stripped; empty logical records are skipped. Quoted commas,
  escaped quotes, multiline cells, CRLF and valid Unicode remain supported.
- Identity precedence is external ID, case-insensitive email, then phone.
  Stored email spelling is retained. External IDs and phones retain their
  existing case-sensitive, unnormalized comparison behavior.
- Consent accepts `true`, `false`, `unknown` or blank, ignoring case. Unknown
  and blank become `None`. Missing identity, duplicate identity and invalid
  consent remain partial row errors. A key is reserved before consent checking,
  so a later duplicate of an invalid-consent row still fails as a duplicate.
- Error `line` retains the legacy logical-record index starting at 2, rather
  than a physical file line number. Multiline records and skipped physical
  blank lines therefore do not correspond to editor line numbers.

## Structural rejection

Strict CSV parsing rejects broken quoting detected by the standard CSV reader.
Surplus cells or missing cells for a declared header reject the entire file,
even after otherwise valid rows. An explicitly empty cell remains valid; a
missing optional header remains supported. Invalid UTF-8 surrogates reject
before the caller fingerprints the original text.

Structural failures raise `DomainError` with HTTP 422, code `CSV`, and fixed
message `Malformed CSV.` Invalid headers use code `CSV_HEADERS` and the existing
fixed header instruction. These errors contain no submitted field values or
CSV library diagnostics. No parsed rows are returned or persisted on a
structural failure.

The handler continues to authenticate before parsing and require the existing
organization membership and owner/admin/manager role before staging. Raw-input
SHA-256 fingerprinting, source label, duplicate-batch lookup, SQL, audit,
commit and rollback logic remain unchanged. The source label and fingerprint
identify the supplied import; they do not prove provider authorization or
data accuracy. The helper grants no role or organization access.

## Verification scope

Offline route regressions against the original handler reproduced two HTTP
500 cases (omitted email header, surplus cells) and three incorrect HTTP 201
acceptances (short row, unterminated quote, duplicate header): five failures
and nine passing role/auth/fingerprint checks before the fix.

`platform/tests/test_fill_import_preview.py` covers the corrected cases,
legacy parsing behavior, input/field limits, redacted errors and whole-file
structural rejection before any database context. Route tests use an in-memory
SQL double with the real membership/role helper; they are not PostgreSQL RLS,
hosted UAT, provider-permission or pilot acceptance evidence.
