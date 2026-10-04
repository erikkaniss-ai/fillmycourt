# Staging runbook

## Railway service wiring

All services use repository `erikkaniss-ai/fillmycourt`, branch
`platform/v0.4-staging`, root directory `platform`, Dockerfile `Dockerfile`.

| Service | Start command | Health check |
| --- | --- | --- |
| `fmc-core-api` | `python -m fmc serve` with `FMC_SERVICE=core` | `/health/ready` |
| `fmc-operations-api` | `python -m fmc serve` with `FMC_SERVICE=operations` | `/health/ready` |
| `fmc-reconciliation-worker` | `python -m fmc reconciliation-worker` | process/lease monitoring |
| `fmc-provider-sync-worker` | `python -m fmc provider-sync-worker` | process/cursor monitoring |

Workers deliberately do not expose a public HTTP listener. Their operational
health is the absence of expired leases, repeated dead-letter jobs and stale
sync cursors; expose those through a private operations endpoint only after
the Supabase-v1 adapter is in place.

## Non-secret staging settings

Set `GAC_ENV=staging`, `FMC_DATA_CONTRACT=supabase-v1`,
`GAC_BOOKING_ENABLED=false` and `FMC_SERVICE` as above. Keep public domains
unset: Railway-generated domains only, `noindex`, no DNS changes and no
GetACourt/FillMyCourt traffic.

## Secrets and manual gates

Supply the least-privilege server-side PostgreSQL runtime URL only after the
Supabase-v1 adapter has passed against a disposable Supabase branch. Add Google
and Apple credentials only after the staging callback URLs are known. Provider
credentials require a signed authorization, tenant binding and explicit mode.
Do not add a Playtomic native-write credential.
