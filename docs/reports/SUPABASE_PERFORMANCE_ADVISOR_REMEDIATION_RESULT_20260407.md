## Supabase Performance Advisor Remediation Result

Date: `2026-04-07`

This report records the performance-focused remediation work applied after the security advisor cleanup and the refreshed performance advisor comparison that followed.

## Baseline

Initial performance advisor snapshot before this batch:

- Total findings: `465`
- Warnings: `256`
- Info: `209`

Baseline families:

- `multiple_permissive_policies`: `184`
- `unused_index`: `139`
- `auth_rls_initplan`: `70`
- `unindexed_foreign_keys`: `69`
- `duplicate_index`: `2`
- `auth_db_connections_absolute`: `1`

## Applied Batches

### 1. Remaining RLS initplan remediation

Applied:

- `supabase/migrations/20260407_optimize_remaining_auth_rls_initplan_policies.sql`
- `scripts/run-advisor-remaining-auth-rls-initplan-migration.ts`

What changed:

- Rewrote the remaining advisor-flagged RLS policies to wrap `auth.uid()` and row-independent permission helpers in `SELECT` subqueries.
- Cleaned up a few redundant manager policies while touching the affected tables, which also reduced some `multiple_permissive_policies` noise.
- Included a final pass for `absence_secondary_permission_exceptions` after the first refresh showed it was the only remaining `auth_rls_initplan` family.

Verification:

- Runner applied successfully.
- Post-migration verification confirmed `0` remaining direct auth/helper patterns across the targeted tables.

### 2. Duplicate index and targeted FK index tuning

Applied:

- `supabase/migrations/20260407_tune_performance_indexes.sql`
- `scripts/run-performance-index-tuning-migration.ts`

What changed:

- Removed the duplicate `quote_manager_series` initials index.
- Removed the duplicate `inspection_items` unique constraint/index pair, keeping a single unique key.
- Added targeted FK indexes on active tables:
  - `actions`
  - `absences`
  - `timesheets`
  - `van_inspections`
  - `rams_assignments`
  - `vehicle_maintenance`

Verification:

- Runner applied successfully.
- Verification confirmed all expected new indexes exist.
- Verification confirmed the duplicate `quote_manager_series` index is gone and only one duplicate-key unique constraint remains on `inspection_items`.

### 3. Safe permissive-policy consolidation

Applied:

- `supabase/migrations/20260407_consolidate_safe_permissive_policies.sql`
- `scripts/run-consolidate-safe-permissive-policies-migration.ts`

What changed:

- Consolidated only the clearly behavior-preserving `multiple_permissive_policies` cases.
- Replaced overlapping manager/self `SELECT` policies with single combined `SELECT` policies on:
  - `absence_allowance_carryovers`
  - `admin_error_notification_prefs`
  - `employee_work_shifts`
  - `messages`
- Split `vans` so manager `UPDATE`/`DELETE` access remains explicit while vehicle visibility is handled by one combined `SELECT` policy.
- Left higher-risk tables such as inspections, timesheets, recipients, and profiles unchanged where policy merging could alter workflow behavior.

Verification:

- Runner applied successfully.
- Verification confirmed there are no duplicate permissive command rows remaining on the safe-consolidation target tables.

## Advisor Comparison

After the first performance batch:

- Total findings: `332`
- Warnings: `123`
- Info: `209`

After the final follow-up RLS pass:

- Total findings: `327`
- Warnings: `118`
- Info: `209`

After the safe permissive-policy consolidation pass:

- Total findings: `320`
- Warnings: `111`
- Info: `209`

Net change from baseline to final:

- Total findings: `465 -> 320` (`-145`)
- Warnings: `256 -> 111` (`-145`)
- Info: `209 -> 209` (`0`)

Family deltas from baseline to final:

- `auth_rls_initplan`: `70 -> 0`
- `duplicate_index`: `2 -> 0`
- `multiple_permissive_policies`: `184 -> 111`
- `unindexed_foreign_keys`: `69 -> 57`
- `unused_index`: `139 -> 151`
- `auth_db_connections_absolute`: `1 -> 1`

## Remaining Findings

### `unused_index` (`151`)

This family increased after the index tuning batch because newly created indexes have not yet built up usage history.

Decision:

- Do not drop indexes immediately based on this snapshot.
- Re-check after normal production traffic has had time to exercise the new indexes.

### `multiple_permissive_policies` (`111`)

Many of the remaining findings are structurally valid access models where separate self/manager/workshop policies intentionally coexist.

Decision:

- The clearly safe overlaps have already been consolidated.
- Any further reduction here should be done table-by-table with behavior review because it changes authorization shape, not just performance hints.

### `unindexed_foreign_keys` (`57`)

The remaining FK findings are concentrated in archive, workflow-history, quote, and lower-volume attachment/admin tables.

Decision:

- Leave the broad remainder for a later evidence-led pass.
- If another batch is needed, prioritize the few remaining tables that are both active and user-facing rather than indexing every low-volume archive FK.

### `auth_db_connections_absolute` (`1`)

This is an operational Auth service configuration item, not a schema migration issue.

Decision:

- Handle in Supabase project settings when ready.

## Summary

This batch cleared the remaining `auth_rls_initplan` family entirely, removed both duplicate-index warnings, reduced permissive-policy warnings in two careful passes, and trimmed the highest-value FK-index warnings without over-indexing archive-heavy tables. The remaining performance advisor output is now dominated by either observation-driven index decisions or RLS-shape warnings that need explicit authorization review rather than blind mechanical cleanup.
