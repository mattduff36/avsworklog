# Delete-user keep-data: remove booked annual leave

## Classification

- Lane: CRITICAL.
- Risk: high.
- Reason: keep-data user deletion is a privileged destructive persistence change. It must remove live annual-leave bookings, keep other audit data, and stop those bookings being recreated through a stale data token or manager insert.
- Workstream: `ws_238835cc7ae62abc`.
- routingDecision: `economical_default`.

## Recommended build model

- Implementation: economical Cursor Grok implementation after the architecture contract is approved. The change is a bounded keep-data path, one tombstone column, one privileged cleanup RPC, and an absence write guard.
- Mandatory gates: independent premium architecture gate before implementation and independent premium final-diff review after deterministic verification.
- Execution mode: Agent. The delete-user API, migration, modal copy, and tests share one persistence contract.
- Fallback escalation: stop and route or split if absence delete triggers, closed-year guards, tombstone write-guard, or service-role RPC auth contradict the contract.

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter `initialized` / preflight to mint a new `first` review.

## Architecture gate

- Status: approved with conditions by independent architecture-gate review.
- Binding conditions:
  1. `deleted_at` is immutable once set, including the original timestamp. Retries must keep the first tombstone time.
  2. The one-time backfill matches the generated ` (Deleted User)` suffix exactly, runs before the immutable write lock, and removes matching open-year annual leave for those legacy deleted profiles.
  3. `DEL-AL-03` is executable PGlite or disposable local Postgres with real roles, `auth.role()`, grants, and trigger behaviour. Static SQL inspection alone is not enough.
- Root cause: `DELETE /api/admin/users/[id]?mode=keep-data` marks the profile `(Deleted User)`, nullifies reviewer refs, bans auth, and revokes sessions. It never removes `absences`. `mode=delete-all` is not the recommended audit path.
- Direct `absences` deletes through the service-role client are not sufficient. `trg_guard_absence_historic_delete` still fires and blocks past or approved/processed rows unless `effective_is_admin()` or `app.absence_historic_delete_bypass` is set. Service-role has no admin JWT.
- Closed-year rows are separately blocked by `guard_absence_closed_financial_year_mutation`. Those rows are historical audit, not current bookings.
- Binding repair from architecture review: app-session revoke does not invalidate an already-issued one-hour Supabase data token. Absence INSERT still allows `auth.uid() = profile_id`, and managers can insert for others. Cleanup is not durable without a database tombstone and absence write guard.

## Implementation contract

Invariants:

1. Keep-data deletion still preserves timesheets, inspections, and other submitted company work, and still marks the profile display name as a deleted user.
2. Keep-data sets durable `profiles.deleted_at`. That column is the database deleted-profile boundary. `full_name` is display-only and is not the security check for absence writes.
3. Authenticated actors cannot set or clear `deleted_at`. Once set, `deleted_at` cannot be cleared by any role, including service role. Service role may set it from null to a timestamp.
4. No absence may be inserted or have `profile_id` targeted at a deleted profile. The guard is table-level and applies to the deleted user, managers, and service role.
5. Keep-data deletion removes every open-financial-year `absences` row for that profile whose reason name normalizes to `annual leave`, including pending, approved, processed, rejected, cancelled, bank-holiday, auto-generated, and bulk rows.
6. Other absence reasons stay. `absences_archive` stays. Closed-financial-year rows still in `absences` stay.
7. Timesheet hours are not restored or rewritten.
8. Order is fail-closed and retryable: validate target → write tombstone and deleted display name → nullify reviewer refs → ban/revoke sessions and WebAuthn → run annual-leave cleanup last. Every newly relied-upon step must check its error. If cleanup fails, the response fails; retry is idempotent and must not report success without a successful cleanup.
9. The privileged cleanup RPC is SECURITY DEFINER with `search_path = public, pg_temp`, sets only transaction-local `app.absence_historic_delete_bypass`, and does not set `app.absence_archive_move`.
10. The RPC rejects unless `auth.role() IS NOT DISTINCT FROM 'service_role'` with SQLSTATE `42501`. Execute is revoked from `PUBLIC`, `anon`, and `authenticated`, then granted only to `service_role`.
11. The RPC requires exactly one annual-leave reason after `lower(trim(name)) = 'annual leave'`. Zero or more than one match fails closed. It returns the removed-row count. Zero matching rows is success.
12. Login, session issue/validate, and data-token issue treat `deleted_at IS NOT NULL` as deleted, and keep the existing display-name marker as a second check.
13. The delete-user modal Keep Company Data copy states the annual-leave exception explicitly. It must not say company data is preserved without that exception.

Boundaries:

- Change only keep-data deletion, `profiles.deleted_at` plus its write lock, the absence deleted-profile write guard, the cleanup RPC, session/login deleted checks, generated profile types, targeted tests, and the delete-user modal copy.
- Do not change delete-all behaviour, absence booking UX, Daily Allocation filters, allowance maths, or archived leave.
- Do not edit historical migrations. Add one forward-only dated predeploy file. Include a one-time tombstone backfill for existing `(Deleted User)` profiles.
- Do not apply the migration to production in this task unless the user later authorises finalise/apply.
- Do not restore timesheet leave effects and do not delete sickness or other non-annual-leave absences.
- Do not use production `POSTGRES_URL*` for new verification. Executable SQL proof is PGlite or the disposable local Postgres workflow.

Rollback:

- Revert the API/modal/helper/session commit to restore previous keep-data behaviour.
- Drop the RPC, absence write guard, and `deleted_at` write lock with a forward migration if needed. Already-deleted leave rows are not automatically restored. Clearing `deleted_at` is intentionally impossible; recovery of a wrongly deleted account is a separate explicit undelete task, not this workflow.

Unresolved risks:

- Closed-year annual leave still sitting in live `absences` remains until archival.
- Existing delete-all absence cleanup can still fail silently against the same triggers. Out of scope.
- After removal, current-year timesheets may still show holiday hours while the matching absence row is gone.
- Ban, session revoke, WebAuthn revoke, and the cleanup RPC are not one database transaction. The tombstone-first order plus idempotent retry is the accepted safety property.

## Required tests

- `DEL-AL-01`: keep-data delete calls the annual-leave cleanup RPC for the target profile after the tombstone is written, and fails the request when that call errors. Completed.
- `DEL-AL-02`: keep-data still revokes sessions/WebAuthn, writes `deleted_at`, and does not delete timesheets or non-leave company data. Completed.
- `DEL-AL-03`: PGlite (or disposable local Postgres) executes the new migration and proves grants, service-role allow/deny, historic and closed-year delete guards, all statuses, open-year filtering, and archive preservation. Static SQL inspection alone is not enough. Completed.
- `DEL-AL-04`: missing or ambiguous annual-leave reason fails closed; a zero-row cleanup result is success. Completed.
- `DEL-AL-05`: delete-user modal Keep Company Data copy states that booked annual leave is removed and does not claim unqualified company-data preservation. Completed.
- `DEL-AL-06`: a deleted profile cannot receive a new absence insert or profile_id assignment, including cases that model a stale authenticated token or a manager insert. Completed.
- `DEL-AL-07`: a failed cleanup after a successful tombstone returns failure, and a retry converges without reporting false success. Completed.

## Final review

- Independent premium final-diff review is mandatory after `DEL-AL-01` through `DEL-AL-07`.
- Use bounded `two-pass-v1`: one first review, at most one consolidated blocker-family fix, then one closure review.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- Immediately before premium final-diff, run one bounded economical adversarial challenge (one challenge, one consolidated repair if needed, one re-check). The challenge is not premium review, not approval, and does not consume or reset the two-pass budget. Challenge repair does not consume the premium fix or `closure` slot. `premium-readiness` ready is not `review_closed` and not `finalise_ready`.
- Supply a compact `premium-review-packet` as starting evidence. The reviewer may inspect any relevant evidence beyond the packet. The packet and `premium-readiness` are not authority.
- Review surfaces: keep-data API, tombstone/RPC/write-guard SQL, session deleted checks, modal copy, and targeted tests.

## Commit and handoff

- Commit: pending; local commit after verification unless the user says not to.
- Push: not authorised unless the user later writes an authorised push phrase.
- Handoff: report root cause, RPC name, verification IDs, independent review outcome, commit, and branch.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_238835cc7ae62abc",
  "taskId": "delete-user-remove-annual-leave",
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
    "rationale": "After the architecture contract is approved, keep-data leave removal is a bounded API helper plus one tombstone column, one privileged RPC, and an absence write guard, and can stay on economical Cursor Grok implementation.",
    "fallbackEscalation": "Stop and route or split if absence delete triggers, closed-year guards, tombstone write-guard, or service-role RPC auth contradict the contract."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "user-deletion-persistence",
    "privileged-absence-delete-rpc",
    "audit-retention-vs-leave-removal",
    "stale-data-token-absence-recreate"
  ],
  "requiredTests": [
    {
      "id": "DEL-AL-01",
      "status": "completed",
      "note": "Keep-data calls leave cleanup after tombstone and fail-closes on error."
    },
    {
      "id": "DEL-AL-02",
      "status": "completed",
      "note": "Keep-data writes deleted_at, revokes access, and preserves non-leave company data."
    },
    {
      "id": "DEL-AL-03",
      "status": "completed",
      "note": "Executable PGlite or local Postgres migration/trigger/grant proof."
    },
    {
      "id": "DEL-AL-04",
      "status": "completed",
      "note": "Missing or ambiguous reason fails; zero matching rows succeeds."
    },
    {
      "id": "DEL-AL-05",
      "status": "completed",
      "note": "Delete-user modal states the annual-leave exception."
    },
    {
      "id": "DEL-AL-06",
      "status": "completed",
      "note": "Deleted profiles cannot receive new or reassigned absences."
    },
    {
      "id": "DEL-AL-07",
      "status": "completed",
      "note": "Failed cleanup after tombstone is retryable and not reported as success."
    }
  ],
  "unresolvedRisks": [
    {
      "id": "DEL-AL-R1",
      "note": "Closed-year annual leave still in live absences remains until archival."
    },
    {
      "id": "DEL-AL-R2",
      "note": "Delete-all absence cleanup can still fail silently against the same triggers."
    },
    {
      "id": "DEL-AL-R3",
      "note": "Kept timesheets may retain historic holiday hours."
    },
    {
      "id": "DEL-AL-R4",
      "note": "Auth revoke and cleanup are not one database transaction; tombstone-first retry is the safety property."
    }
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
      "Keep-data removes open-financial-year annual-leave absences for the deleted profile.",
      "Other absence reasons, archived absences, and closed-year live rows stay.",
      "Timesheet hours are not restored.",
      "Tombstone is written before revoke; leave cleanup runs last and is fail-closed and idempotent.",
      "The new RPC is SECURITY DEFINER, uses historic-delete bypass only, returns the removed count, and is executable only by service_role.",
      "Login, session, and data-token issue treat deleted_at as deleted.",
      "The delete-user modal states that booked annual leave is removed."
    ],
    "boundaries": [
      "Change only keep-data deletion, deleted_at plus write lock, absence deleted-profile guard, cleanup RPC, session/login deleted checks, profile types, targeted tests, and modal copy.",
      "Do not change delete-all, Daily Allocation filters, allowance maths, or archived leave.",
      "Add one forward-only dated predeploy migration including a one-time tombstone backfill. Do not edit historical migrations.",
      "Do not apply production schema in this task without later explicit authorisation.",
      "Do not use production POSTGRES_URL for new verification."
    ],
    "rollback": "Revert the API/modal/helper/session commit to restore previous keep-data behaviour. Drop the RPC, absence write guard, and deleted_at lock with a forward migration if needed. Already-deleted leave rows are not automatically restored. Clearing deleted_at is intentionally impossible."
  },
  "reviewClosureProtocol": "two-pass-v1"
}
-->
