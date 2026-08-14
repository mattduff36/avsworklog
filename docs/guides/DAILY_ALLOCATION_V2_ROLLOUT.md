# Daily Allocation v2 rollout

This guide controls activation of the FFTS-style Daily Allocation board after
its additive schema and application code have been deployed. Activation is a
production-data operation and must follow CRITICAL review and finalisation.

## Control planes

- The existing permissions matrix decides who can access Daily Allocation.
- `private.daily_allocation_v2_runtime.board_enabled` selects the v2 board.
- `private.daily_allocation_v2_runtime.writes_enabled` guards every v2 write RPC.
- Activation and emergency disable must never change team, user, role, or
  module permission rows.

The runtime gate is global across users who already satisfy the permissions
matrix. Manager planning still requires Level 4 or higher.

## Prerequisites

1. Use `POSTGRES_URL_NON_POOLING` from `.env.local`.
2. The connection must identify Supabase project `lrhufzqfzeutgvudcowy` and
   use direct/session port `5432`, never transaction-pool port `6543`.
3. Complete the independent CRITICAL final-diff review.
4. Run `npm run finalise:full:push`.
5. Confirm the Vercel production deployment is `READY` and its source commit
   is the exact deployed SHA returned by `git rev-parse HEAD`.
6. Keep `scripts/supabase/activate-daily-allocation-v2.sql` and
   `supabase/rollback/20260813_zzz_disable_daily_allocation_v2.sql` unchanged
   after review. The operator executes these checked-in artifacts directly.

Never print the database URL, credentials, environment, profile IDs, or
permission rows.

## Commands

```bash
# Read current checked state and fingerprints.
npm run daily-allocation:v2:status

# Verify migration checksum, objects, grants, fingerprints, closed flags, and
# rehearse the idempotent runtime-only disable path.
npm run daily-allocation:v2:preflight

# Activate only after exact deployment confirmation.
npm run daily-allocation:v2:activate -- --expected-commit <40-character-sha>

# Emergency runtime-only disable. Permissions and data remain unchanged.
npm run daily-allocation:v2:disable
```

The activation operator verifies:

- exact production project identity and direct connection mode;
- the local operator, activation, disable, and grant migration exactly match
  the expected deployed commit;
- the checked-in v2 migration SHA-256 against the protected migration ledger;
- every required v2 table type, RLS state, API-used RPC signature, writer
  guard, table/column grant, and private-table boundary;
- no direct authenticated v2 writes and no anonymous v2 table access;
- one closed runtime singleton;
- stable permission, complete v1/v2 content, linked-message, and row-count
  fingerprints;
- an authorized Level 4+ runtime/board read;
- denial for a Level 0 principal;
- a guaranteed-nonexistent mutation reaches `Visit not found`, not
  `V2_DISABLED`, and creates no rows.

## Automatic disable

Activation and smoke checks are one bounded operator action. If activation
validation, authorization smoke, content comparison, or the smoke timeout
fails, the operator immediately runs the runtime-only disable artifact and
verifies both flags are `false`.

A fail-fast session advisory lock serializes preflight, activation, and
disable. Smoke checks use a separate database connection so cancellation or a
stalled smoke cannot block the privileged control connection. Handled
`SIGINT`/`SIGTERM` interruption cancels smoke and disables the runtime before
the operator exits.

If automatic disable itself fails, stop. Do not retry activation, change
permissions, run generic migration repair, or delete data. Diagnose the
database state through the CRITICAL workflow.

## Rollback boundary

Rollback is disable-and-forward-fix:

- preserve all v1 and v2 tables and rows;
- preserve publications, snapshots, messages, conversions, and permissions;
- do not infer historical times or reopen converted v1 team/date writes;
- do not automatically roll back the deployed code or schema;
- require open clients to reload after disable while the database write guard
  takes effect immediately.

After a successful rollout, retain the final pushed SHA, exact deployed SHA,
activation timestamp, safe fingerprints, runtime state, smoke results, and
the emergency disable command in the handoff evidence.
