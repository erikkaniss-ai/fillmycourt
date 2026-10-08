# Staging runbook

## Railway service wiring

All services use repository `erikkaniss-ai/fillmycourt`, branch
`platform/v0.4-staging`, root directory `platform`, Dockerfile `Dockerfile`.

| Service | Start command | Health check |
| --- | --- | --- |
| `fmc-core-api` | `python -m fmc serve` with `FMC_SERVICE=core` | `/health/ready` |
| `fmc-operations-api` | `python -m fmc serve` with `FMC_SERVICE=operations` | `/health/ready` |
| `fmc-reconciliation-worker` | `python -m fmc reconciliation-worker` | `/health/ready` |
| `fmc-provider-sync-worker` | `python -m fmc provider-sync-worker` | `/health/ready` |

Workers expose health only on the Railway service listener; do not attach a
public domain. Their operational health also requires no expired leases,
repeated dead-letter jobs or stale sync cursors.

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
