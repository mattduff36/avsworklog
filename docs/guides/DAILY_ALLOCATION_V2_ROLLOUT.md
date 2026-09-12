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
4. Apply migrations only through the approved finalise migration ledger path,
   in this order:
   - `supabase/migrations/20260813_zzz_daily_allocation_v2_visit_model.sql`;
   - `supabase/migrations/20260814155048_daily_allocation_v2_rpc_only_grants.sql`;
   - `supabase/migrations/20260912_daily_allocation_idempotent_mutations_and_guided_conversion.sql`;
   - `supabase/migrations/20260913_daily_allocation_runtime_rpc_grants.sql`.
5. Keep both runtime flags `false`. After the additive migration, run status
   and confirm the singleton remains exactly `false/false` before deployment.
6. Push/finalise only through the separately authorized release workflow, then
   confirm the Vercel production deployment is `READY` and its source commit
   is the exact pushed 40-character SHA. The rollout command independently
   reads the no-store production deployment identity endpoint and refuses a
   stale or different commit.
7. Keep `scripts/supabase/activate-daily-allocation-v2.sql` and
   `supabase/rollback/20260813_zzz_disable_daily_allocation_v2.sql` unchanged
   after review. The operator executes these checked-in artifacts directly.

Never print the database URL, credentials, environment, profile IDs, or
permission rows.

## Commands

```bash
# Read current checked state and fingerprints.
npm run daily-allocation:v2:status

# After the exact pushed SHA is deployed, verify migration checksums, objects,
# grants, semantics, fingerprints, closed flags, and the disable rehearsal.
npm run daily-allocation:v2:preflight -- --expected-commit <40-character-sha>

# Activate only after exact deployment confirmation.
npm run daily-allocation:v2:activate -- --expected-commit <40-character-sha>

# Emergency runtime-only disable. Permissions and data remain unchanged.
npm run daily-allocation:v2:disable
```

The activation operator verifies:

- exact production project identity and direct connection mode;
- the local operator, activation, disable, and grant migration exactly match
  the expected deployed commit;
- all four checked-in migration SHA-256 values and `predeploy` phases against
  the protected migration ledger, including the guided-conversion and runtime
  grant migrations;
- every required v2 relation type, request-ledger RLS/ACL, private-schema
  boundary, complete new RPC signature, SECURITY DEFINER property, and exact
  authenticated/anonymous execution boundary;
- removal or full client/service-role revocation of every obsolete executable
  overload, with no other authenticated public Daily Allocation v2 overload;
- no direct authenticated v2 table/request-ledger DML and no anonymous access;
- one closed runtime singleton;
- shared team/date lock guards for conversion and every v1 writer/publisher;
- conversion source fingerprint, row/version exhaustiveness, explicit
  disposition/interval, canonical-job, and no-legacy-time guarantees;
- actor/action/payload-hash request binding, runtime-before-replay ordering,
  replay-before-lookup behavior, assignment row-version CAS, and the canonical
  source-type/source-ID plant job rule;
- stable permission, v1 content, v1 publication, v2 content, v2 publication,
  linked-message/recipient, request-ledger, and row-count fingerprints;
- the local rollout artifacts and current Git HEAD exactly match the commit SHA
  returned by
  `https://avsworklog.mpdee.uk/api/daily-allocation/deployment-identity`;
- an authorized Level 4+ runtime/board read;
- denial for a Level 0 principal;
- a request-ID-bearing guaranteed-nonexistent mutation reaches `Visit not found`, not
  `V2_DISABLED`, and creates no rows.

## Required release sequence

1. Keep `board_enabled=false` and `writes_enabled=false`.
2. Apply the reviewed additive migrations in the order above through the
   approved finalise/ledger path. Never use dashboard SQL or bypass the ledger.
3. Run status and stop unless the migration checksums/contracts pass and the
   runtime singleton is still closed.
4. Deploy the exact pushed SHA and wait for that exact deployment to be ready.
5. Run closed-state preflight with that SHA. Preflight must pass without a
   database mutation other than an idempotent runtime-only disable rehearsal.
6. Run activation with the same SHA. The checked-in SQL validates and enables
   both flags atomically from an exactly closed singleton.
7. Complete the bounded manager-allowed and Level-0-denied smoke checks.
8. On any activation validation, authorization smoke, fingerprint comparison,
   interruption, or timeout failure, automatically execute and verify the
   runtime-only disable. Do not retry or broaden permissions.

Guided conversion is an explicit manager action for one team/date scope. It is
never an automatic migration or activation side effect. Once a scope is
converted, emergency disable closes v2 access/writes but must not reopen that
scope for v1 editing.

## Automatic disable

Activation and smoke checks are one bounded operator action. If activation
preflight, validation, authorization smoke, content comparison, or the smoke timeout
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
