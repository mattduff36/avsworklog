# Delete-user absence write-guard lock

## Classification

- Lane: CRITICAL.
- Risk: high.
- Reason: keep-data deletion must remove open-year annual leave and stop concurrent inserts from recreating bookings after cleanup. That is persistence, concurrency, and destructive leave cleanup.
- Workstream: `ws_84cb68b5830be523`.
- routingDecision: `economical_default`.
- Predecessor: exhausted `ws_238835cc7ae62abc` on `fix/delete-user-keep-data-annual-leave` at `e901ef6b`. That lineage is `routing_required` and is not claimed as passed. This successor is a new isolated release obligation on local `main` in `D:/Websites/avsworklog`. It does not inherit the exhausted two-pass budget. Do not treat this as a split child.

## Recommended build model

- Implementation: economical Cursor Grok after architecture approval. The remaining defect is a row lock on the existing absence write guard, plus a concurrent regression, on top of the already-written keep-data leave-removal path.
- Mandatory gates: independent premium architecture gate before the lock change, and independent premium final-diff review after verification.
- Execution mode: Agent. Work stays in this project folder on `main`. Do not create another Git worktree.
- Fallback escalation: stop if `FOR SHARE` / tombstone lock modes do not conflict, or if executable concurrency proof cannot be run without production Postgres.

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter `initialized` / preflight to mint a new `first` review.

## Architecture gate

- Status: approved with conditions by independent architecture-gate review (`9d708a66-8d0d-4b77-aced-d96d21f1fdfc`). This is not final-diff approval.
- Predecessor finding: `guard_absence_deleted_profile_write` used an unlocked `EXISTS` on `profiles.deleted_at`. Under `READ COMMITTED`, an insert can read `deleted_at IS NULL`, the tombstone and cleanup can commit, and the insert can commit afterward.
- Binding conditions:
  - Lock with `SELECT deleted_at ... FOR SHARE` on the target profile, then check `NOT FOUND` and `deleted_at`. A missing profile fails closed.
  - `FOR SHARE` is the minimum correct lock. Do not use `FOR KEY SHARE`. Do not use `FOR NO KEY UPDATE` / `FOR UPDATE`.
  - Amend `20260907230000_delete_user_keep_data_annual_leave.sql` only if it has never been applied to any persistent/shared ledger. If application is uncertain or confirmed, add a forward migration instead.
  - Narrow `DEL-AL-08` to open-year annual-leave inserts/reassignments. A pre-tombstone non-annual absence can legitimately commit and is not removed.
  - PGlite cannot prove lock contention. `DEL-AL-08` must use disposable local PostgreSQL and two `pg.Client` sessions. A skipped or PGlite-only test is not a pass.
  - Prove both orderings with `pg_blocking_pids()`, distinct backend PIDs, bounded lock/statement timeouts, and the exact migration under review:
    1. Writer holds the share lock → tombstone update is blocked → writer commits → tombstone and cleanup complete → booking is absent.
    2. Tombstone update holds the lock → writer is blocked → tombstone commits → writer rejects with the deleted-profile error.
  - Register the new DB test as an allowed local PostgreSQL runner target.
  - No API/RPC redesign. Keep tombstone-before-cleanup; cleanup last and fail-closed.
  - `DEL-AL-06` must also prove missing profiles fail closed.
- Keep the approved keep-data contract: immutable `deleted_at`, exact-suffix backfill, open-year annual-leave cleanup only, service-role RPC, modal copy, login/session deleted checks.

## Implementation contract

Invariants:

1. Keep-data still preserves timesheets, inspections, and other submitted company work, and still marks the profile as a deleted user.
2. Keep-data writes durable `profiles.deleted_at`. That column remains the deleted-profile boundary.
3. `deleted_at` stays immutable once set, including the original timestamp. Authenticated actors cannot set it. Service role may set it from null to a timestamp.
4. The absence write guard locks the target profile row with `FOR SHARE` (or a stronger conflicting lock) before reading `deleted_at`. A missing profile fails closed.
5. No absence may be inserted or have `profile_id` targeted at a deleted profile, including an insert that began before the tombstone and would otherwise commit after cleanup.
6. Keep-data removes every open-financial-year annual-leave absence for that profile. Other reasons, archive rows, and closed-year live rows stay.
7. Timesheet hours are not restored.
8. Order remains: validate → tombstone and deleted name → nullify reviewer refs → ban/revoke → cleanup last. Cleanup failure is not success.
9. Reason id and count still come from one snapshot (`COUNT(*) OVER ()`).
10. Login, session issue/validate, and data-token issue treat `deleted_at` as deleted.
11. The delete-user modal states that booked annual leave is removed.

Boundaries:

- Work only in this repository folder on local `main`. Do not add a second worktree.
- Change the keep-data delete path, tombstone, absence write guard lock, cleanup RPC, session/login deleted checks, types, modal copy, and targeted tests.
- Do not edit historical applied migrations. The uncommitted `20260907230000_delete_user_keep_data_annual_leave.sql` may still be amended because it is not in `main` history.
- Do not apply the migration to production unless the user later authorises finalise/apply.
- Do not use production `POSTGRES_URL*` for new verification.

Rollback:

- Revert the successor commit on `main` to drop the unreleased keep-data leave-removal and lock changes.
- The exhausted predecessor commit on `fix/delete-user-keep-data-annual-leave` stays historical and is not claimed as passed.

Unresolved risks:

- Closed-year annual leave still sitting in live `absences` remains until archival.
- Delete-all absence cleanup can still fail silently. Out of scope.
- Kept timesheets may still show holiday hours.
- Ban, session revoke, WebAuthn revoke, and the cleanup RPC are not one database transaction.
- Official protocol `rehome-bind` against the predecessor is mechanically blocked because that lineage reviewed an uncommitted tree (empty base..HEAD range) and then committed. This successor records the predecessor relationship in this plan instead of minting a split child.

## Required tests

- `DEL-AL-01`: keep-data calls leave cleanup after the tombstone and fail-closes on error.
- `DEL-AL-02`: keep-data writes `deleted_at`, revokes access, and keeps non-leave company data.
- `DEL-AL-03`: executable PGlite proof of backfill, grants, guards, and open-year cleanup.
- `DEL-AL-04`: missing or ambiguous annual-leave reason fails closed; zero rows succeed.
- `DEL-AL-05`: modal states the annual-leave exception.
- `DEL-AL-06`: a deleted or missing profile cannot receive a new or reassigned absence.
- `DEL-AL-07`: failed cleanup after tombstone is not reported as success.
- `DEL-AL-08`: the write guard takes a profile row lock that conflicts with the tombstone update, and an in-flight insert or reassignment cannot survive deletion cleanup. Executable database proof; static SQL inspection alone is not enough.

## Final review

- Independent premium final-diff review is mandatory after `DEL-AL-01` through `DEL-AL-08`.
- Use bounded `two-pass-v1` for this successor only.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- Immediately before premium final-diff, run one bounded economical adversarial challenge. The challenge is not premium review.
- Supply a compact `premium-review-packet`. The reviewer may inspect any relevant evidence.

## Commit and handoff

- Commit: pending; local commit after verification unless the user says not to.
- Push: not authorised unless the user later writes an authorised push phrase.
- Handoff: report lock mode, `DEL-AL-08`, independent review outcome, commit, and that work stayed on local `main`.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_84cb68b5830be523",
  "taskId": "delete-user-absence-guard-lock",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "economical",
  "routingDecision": "economical_default",
  "recommendedBuildModel": {
    "implementation": {
      "role": "economical-default",
      "tier": "economical",
      "family": "cursor-grok"
    },
    "premiumGates": [
      {
        "phase": "architecture-gate",
        "role": "premium-architecture-gate",
        "tier": "premium",
        "mandatory": true
      },
      {
        "phase": "final-diff-reviewer",
        "role": "premium-final-review",
        "tier": "premium",
        "mandatory": true
      }
    ],
    "switchTiming": "not_applicable",
    "rationale": "The successor adds a conflicting profile-row lock to an already-written keep-data leave-removal path after architecture approval.",
    "fallbackEscalation": "Stop if the profile-row lock does not conflict with the tombstone update, or if executable concurrency proof cannot be obtained without production Postgres."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "user-deletion-persistence",
    "privileged-absence-delete-rpc",
    "concurrent-absence-recreate",
    "profile-row-share-lock"
  ],
  "requiredTests": [
    { "id": "DEL-AL-01", "status": "unresolved", "note": "Cleanup after tombstone; fail-closed." },
    { "id": "DEL-AL-02", "status": "unresolved", "note": "deleted_at, revoke, keep company data." },
    { "id": "DEL-AL-03", "status": "unresolved", "note": "Executable migration/trigger/grant proof." },
    { "id": "DEL-AL-04", "status": "unresolved", "note": "Reason snapshot fail-closed; zero rows ok." },
    { "id": "DEL-AL-05", "status": "unresolved", "note": "Modal annual-leave exception." },
    { "id": "DEL-AL-06", "status": "unresolved", "note": "No new or reassigned absences for deleted or missing profiles." },
    { "id": "DEL-AL-07", "status": "unresolved", "note": "Failed cleanup is not success." },
    { "id": "DEL-AL-08", "status": "unresolved", "note": "FOR SHARE conflicts with tombstone; in-flight insert cannot survive cleanup." }
  ],
  "unresolvedRisks": [
    { "id": "DEL-AL-R1", "note": "Closed-year live annual leave remains until archival." },
    { "id": "DEL-AL-R2", "note": "Delete-all absence cleanup can still fail silently." },
    { "id": "DEL-AL-R3", "note": "Kept timesheets may retain holiday hours." },
    { "id": "DEL-AL-R4", "note": "Ban/revoke/RPC are not one database transaction." },
    { "id": "DEL-AL-R5", "note": "Predecessor official rehome-bind is blocked by empty reviewed commit range; predecessor stays exhausted and not passed." }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "implementationContract": {
    "invariants": [
      "Keep-data still preserves timesheets, inspections, and other submitted company work.",
      "Keep-data writes durable profiles.deleted_at and uses it as the absence write boundary.",
      "Authenticated actors cannot set or clear deleted_at; once set it cannot be cleared.",
      "The absence write guard locks the target profile row with FOR SHARE or a stronger conflicting lock before reading deleted_at.",
      "An insert or profile_id reassignment that races the tombstone cannot commit after cleanup for a deleted profile.",
      "Keep-data removes open-financial-year annual-leave absences for the deleted profile.",
      "Other absence reasons, archived absences, and closed-year live rows stay.",
      "Timesheet hours are not restored.",
      "Tombstone is written before revoke; leave cleanup runs last and is fail-closed and idempotent.",
      "Reason id and count come from one snapshot.",
      "Login, session, and data-token issue treat deleted_at as deleted.",
      "The delete-user modal states that booked annual leave is removed."
    ],
    "boundaries": [
      "Stay on local main in this project folder. Do not create another worktree.",
      "Change only keep-data deletion, deleted_at plus write lock, absence deleted-profile guard including the row lock, cleanup RPC, session/login deleted checks, profile types, targeted tests, and modal copy.",
      "Do not change delete-all, Daily Allocation filters, allowance maths, or archived leave.",
      "Do not edit historical applied migrations. The uncommitted keep-data leave migration on main may still be amended.",
      "Do not apply production schema in this task without later explicit authorisation.",
      "Do not use production POSTGRES_URL for new verification."
    ],
    "rollback": "Revert the successor commit on main. The exhausted predecessor branch remains historical and is not claimed as passed. Already-deleted leave rows are not automatically restored."
  },
  "reviewClosureProtocol": "two-pass-v1"
}
-->
