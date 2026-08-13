# Local database testing

**Local-only warning:** this workflow is for a disposable PostgreSQL instance bound to `127.0.0.1` on the current checkout. Never point it at a remote host, a shared database, a normal Supabase branch, or production. Do not paste connection URLs or passwords into tickets, logs, or this guide.

## Prerequisites

- Docker Desktop (Linux containers) must be installed and running.
- Confirm Compose works before starting:

```bash
docker compose version
```

This workflow does **not** require the Supabase CLI and does **not** require a cloud Supabase project.

## Three testing tiers

1. **PGlite isolated/runtime tests** — in-process Postgres-compatible tests (the default for most database unit/runtime coverage). No Docker.
2. **Disposable plain PostgreSQL** — a checkout-scoped `postgres:15-bookworm` container for real sessions, advisory locks, deadlocks, transactions, migrations, and RLS database semantics. Auth is **fixture-mocked**; this is not a Supabase stack.
3. **Possible future full local Supabase stack** — Auth, PostgREST, Realtime, and Storage end-to-end behavior. Out of scope here. This workflow must not be treated as that stack.

PostgreSQL **15** is the local major. The Compose tag is major-only (`postgres:15-bookworm`), so patch-level drift is expected. This does **not** prove production-major parity or full-Supabase parity.

## Approved commands

Prefer the one-shot command:

- `test:db:local` runs `tsx scripts/local-test-postgres.ts one-shot`. It starts, runs the target suite once, then stops and proves cleanup.
- `test:db:local:start` runs `tsx scripts/local-test-postgres.ts start` to create a fresh disposable instance after recovery teardown.
- `test:db:local:run` runs `tsx scripts/local-test-postgres.ts run` exactly once against the started instance.
- `test:db:local:stop` runs `tsx scripts/local-test-postgres.ts stop`, including `down --volumes --remove-orphans`, then proves owned resources are absent.
- `test:db:local:verify-cleanup` runs `tsx scripts/local-test-postgres.ts verify-failure-cleanup` to exercise a deliberate sentinel failure and prove cleanup.

```bash
npm run test:db:local
```

Manual sequence when you need to inspect the instance between steps:

1. `npm run test:db:local:start`
2. exactly one `npm run test:db:local:run`
3. `npm run test:db:local:stop`

A second `run` without a fresh `start` fails closed (consumed state). Start again before another run.

## Database identity

- Database name: `avsworklog_test`
- User: `avsworklog_test`
- Host: exactly `127.0.0.1` (not `localhost`, not a LAN/public address)
- Port: derived from the canonical checkout path (unprivileged range; never `5432`)

The password and connection URL are not documented here. `TEST_DATABASE_URL` is **child-only**: the lifecycle CLI constructs it and injects it only into the Vitest child. It is not sourced from `.env` / `.env.local` files, inherited `TEST_DATABASE_URL`, or any `POSTGRES_URL` / `POSTGRES_URL*` / `DATABASE_URL` value.

## Safety

- Loopback bind is exactly `127.0.0.1`.
- Compose project name and host port are derived from the canonical checkout path.
- Lock, state, and nonce are checkout-scoped (not shared across working copies).
- Start/run refuse a dirty database: only a fresh PostgreSQL default is allowed.
- The workflow never targets a remote or normal Supabase branch.
- This workflow does not run production activation SQL. The target suite's fixture may load only after the empty-database guard passes.

## Cleanup

Handled `SIGINT` / `SIGTERM` terminate the active child when possible, then run checkout-scoped `docker compose down --volumes --remove-orphans` and exit `130` / `143`. Cleanup also runs after a successful child, a failing child, and bounded timeouts.

`stop` and one-shot success prove owned containers, volumes, and networks for this Compose project are absent. `verify-cleanup` proves the same after a sentinel child exit `23`.

**Limitation:** `SIGKILL`, process crash, host shutdown, and Docker daemon failure cannot run those handlers. Recover with `start` (verified recovery teardown) or `stop`, then retry. Do not delete Docker resources by hand unless you have confirmed they belong to this checkout's derived project.

## Troubleshooting

- **Docker unavailable / not on PATH:** install Docker Desktop, start it, and confirm `docker compose version`.
- **Docker installed but not running:** start Docker Desktop and wait until it is ready.
- **Port conflict:** another process holds the derived checkout port. Stop the conflicting listener or wait; do not retarget a remote port.
- **Live lock:** another lifecycle command for this checkout is running. Wait for it to finish.
- **Stale lock:** a previous command died. `start` / `stop` reclaim a lock whose PID is dead. Do not delete the lock directory unless you have confirmed no lifecycle command is running.
- **Dirty database:** extra schemas, relations, functions, or extensions exist. Run `stop`, then `start` for a new empty instance.
- **Consumed database:** `run` already used this instance. Run `start` again before a second `run`.
- **Health timeout:** Compose `up --wait` exceeded its wait timeout. Check Docker Desktop, disk, and image pull, then run `stop` / `start`.
- **Cleanup failure:** tests may have passed but owned resources remain. Treat this as failure. Retry `stop`; inspect only resources bearing the derived project label.

## Verification IDs

- `LTDB-BOOT-001`: disposable Postgres became healthy on loopback, reported major 15, and matched the local test database/user identity.
- `LTDB-SAFE-001`: URL, host, environment stripping, child-only `TEST_DATABASE_URL`, state allowlist, marker/freshness/consumed fail-closed, and local Docker endpoint contracts.
- `LTDB-CLEAN-001`: after a successful child, checkout-scoped Compose resources are absent.
- `LTDB-CLEAN-002`: after a deliberate failing child, checkout-scoped Compose resources are absent and the sentinel exit is preserved.
- `LTDB-CONC-001`: real multi-session concurrency, advisory-lock ordering, timeout bounds, and final database state against disposable Postgres. **A skipped concurrency test is not a pass.**
- `LTDB-RERUN-001`: two complete one-shot executions each use a fresh database and clean up.
- `LTDB-PGLITE-001`: existing PGlite isolated/runtime coverage remains the default in-process tier and still passes without Docker.
- `LTDB-DOC-001`: this guide and the approved npm command contract describe local-only use, the three tiers, cleanup, troubleshooting, and all verification IDs.
