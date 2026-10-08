# FillMyCourt / GetACourt platform architecture

## One booking domain, four deployable units

`fmc-core-api` is the player-facing booking boundary: availability queries,
quotes, expiring holds, idempotent confirmation and player booking history.
`fmc-operations-api` is the operator boundary: clubs, customer import/review,
venues/courts, provider mappings, payment evidence, reconciliation review and
audit history.

`fmc-reconciliation-worker` consumes only `reconcile` jobs and projects its
own internal activity feed. `fmc-provider-sync-worker` consumes only
`sync_bookings`, `sync_players` and `sync_payments` jobs. Both use durable
leases and idempotency keys.

All units share one PostgreSQL authority: `fmc-platform-prod` in Frankfurt.
They are separated for scaling and failure containment, not because booking
inventory is split across databases.

## Provider safety contract

The Playtomic adapter is read/sync plus handoff only. It has no write API and
reports `authorized_native_write: false`. A provider connection records one
of three explicit modes: `read_sync`, `handoff`, or
`authorized_native_write`. The last requires written provider authorization,
tenant-bound credentials and per-court approval.

The migration in `supabase/migrations/` enforces those labels. It does not
grant Playtomic write permission and is intentionally not applied here.

## Data compatibility gate

The v0.4 package's original SQLAlchemy schema is retained as a tested domain
reference, but it is not the Frankfurt schema. Managed environments require
`FMC_DATA_CONTRACT=supabase-v1`, refuse implicit schema creation, and must use
the existing organization, people, venue, court, booking, hold, payment,
provider, reconciliation, audit and event tables.

The next implementation step is the `supabase-v1` repository adapter and its
contract tests against a disposable Supabase branch. Do not attach a managed
service to the shared production database until that adapter is complete.
