# Daily Allocation permissions lockdown

## Classification

- Lane: CRITICAL.
- Risk: high.
- Reason: this changes live authorization defaults and removes current module access from non-admin users.
- Workstream: `ws_eeea759200e4cc30`.
- routingDecision: `continued_premium`.

## Recommended build model

- Implementation: GPT-5.6 Sol premium implementation because the current parent owns the live permission-state boundary and finalisation.
- Mandatory gates: independent premium architecture gate before implementation and independent premium final-diff review after deterministic verification.
- Execution mode: Agent; the database migration, guide data, tests, and production-state verification share one authorization contract.
- Fallback escalation: stop and route/split if migration-ledger state, admin bypass behavior, or permission-state verification contradicts the contract.

## Architecture gate

- Status: approved with conditions by an independent architecture-gate review.
- Use a new forward-only migration because the existing Daily Allocation activation migration is already recorded in the live finalise ledger.
- Keep the configured minimum at Employee/Level 2, reset all direct rows to explicit Level 0, capture exact before-images in a private revoked snapshot, and make the old postdeploy runner verification policy-neutral.
- Assert effective access with `user_module_access_level`: every non-full-access profile resolves Level 0 and every full-access profile remains Level 5.

## Implementation contract

Invariants:

1. `daily-allocation` remains present in `permission_modules` so it appears in `/admin/settings?tab=permissions`.
2. Every Admin/Super Admin retains effective Level 5 access through the existing full-access-role rule.
3. Every non-admin user has effective Level 0 immediately after the lockdown migration: all team defaults are disabled and every direct row is explicit Level 0.
4. The permission guide documents Daily Allocation for Contractor, Employee, Supervisor, Manager, and Admin, matching the initial admin-only rollout.
5. Existing Daily Allocation data, RLS functions, publication behavior, and Plant Daily Check enforcement are unchanged.

Boundaries:

- Add a new forward-only migration; do not edit the checksums of already-applied Daily Allocation migrations.
- Limit production mutation to the Daily Allocation module row, rows in `team_module_permissions`, `user_module_permissions`, and legacy `role_permissions`, plus a private revoked exact snapshot.
- Do not remove the module definition, relax RLS, change role classifications, or alter unrelated module permissions.
- Keep the configured minimum at Employee/Level 2 so future direct Level 2+ and team grants remain possible through the existing permissions matrix after testing.

Rollback:

- Capture exact module, team, user, and legacy-role before-images transactionally in a private revoked snapshot. If immediate rollback is required before any manual grants, restore through a new forward migration from that snapshot; otherwise reconcile against a fresh snapshot to avoid overwriting later assignments. Reverting code alone does not revert applied permission data.

Unresolved risks:

- The finalise migration runner may expose an existing repository-wide blocker unrelated to this work; database/migration failures will not be generically repaired.

## Required tests

- `PERM-DA-01`: targeted migration contract proves the new forward migration keeps the module configured, disables every team default, clears direct overrides, and leaves admin bypass semantics intact.
- `PERM-DA-02`: permissions-guide contract proves Daily Allocation is present with all five role descriptions and Admin-only initial behavior.
- `PERM-DA-03`: existing permission matrix unit tests pass, including locked-admin Level 5 behavior and team/default resolution.
- `PERM-DA-04`: configured database verification reports the module present at Employee/Level 2, zero enabled teams, zero positive direct rows, zero effective non-admin users, and unchanged effective Level 5 admins.
- `PERM-DA-06`: the old applied migration checksum remains unchanged, the new migration is ledgered, and the postdeploy runner no longer requires an enabled team.
- `PERM-DA-07`: an exact private rollback snapshot exists and is readable before the permission mutation is applied.
- Finalisation checkpoint: full repository finalisation must succeed and push the current branch without changing unrelated work.

## Final review

- Independent premium final-diff review is mandatory after `PERM-DA-01` through `PERM-DA-04`.
- Use bounded `two-pass-v1`: one first review, at most one consolidated blocker-family fix, then one closure review.
- Review surfaces: migration and runner/ledger behavior, permission matrix/API behavior, permission guide source, and targeted tests.

## Commit and handoff

- Commit: pending; the user requested full finalisation.
- Push: explicitly authorized by “finalise full and push”.
- Handoff: report migration state, verification IDs, independent review outcome, commit, branch, and push result.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_eeea759200e4cc30",
  "taskId": "daily-allocation-permissions-lockdown",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "premium",
  "routingDecision": "continued_premium",
  "recommendedBuildModel": {
    "implementation": {
      "role": "premium-planning",
      "tier": "premium",
      "family": "gpt-sol"
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
    "rationale": "The current premium parent owns the live authorization boundary, migration state, deterministic verification, and finalisation.",
    "fallbackEscalation": "Stop and route or split if ledger state, full-access-role behavior, or permission-state verification contradicts the contract."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "permissions-security-boundary",
    "production-data-mutation",
    "already-applied-migration-ledger"
  ],
  "requiredTests": [
    {
      "id": "PERM-DA-01",
      "status": "completed",
      "note": "Forward migration contract."
    },
    {
      "id": "PERM-DA-02",
      "status": "completed",
      "note": "Permission guide coverage."
    },
    {
      "id": "PERM-DA-03",
      "status": "completed",
      "note": "Permission matrix behavior."
    },
    {
      "id": "PERM-DA-04",
      "status": "completed",
      "note": "Configured database state."
    },
    {
      "id": "PERM-DA-06",
      "status": "completed",
      "note": "Ledger immutability and policy-neutral postdeploy verification."
    },
    {
      "id": "PERM-DA-07",
      "status": "completed",
      "note": "Exact private rollback snapshot."
    }
  ],
  "unresolvedRisks": [
    {
      "id": "PERM-DA-R1",
      "note": "Unrelated repository-wide finalise blockers may remain."
    }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "implementationContract": {
    "invariants": [
      "Keep daily-allocation visible in the permission matrix.",
      "Preserve automatic Admin/Super Admin Level 5 access.",
      "Make every non-admin effective Daily Allocation level zero after migration and reset every direct row to explicit Level 0.",
      "Document all five role tiers in the Permission Guide.",
      "Leave unrelated module permissions and Daily Allocation data behavior unchanged."
    ],
    "boundaries": [
      "Use a new forward migration because activation is already ledgered.",
      "Keep the configured minimum at Employee/Level 2 and capture exact before-images in a private revoked snapshot.",
      "Touch only Daily Allocation permission rows, policy-neutral runner verification, guide data, and contract tests.",
      "Do not weaken RLS or role-classification checks."
    ],
    "rollback": "Before manual grants, restore through a new forward migration from the exact private snapshot; after manual grants, reconcile from a fresh snapshot. Code reversion alone does not revert migrated data."
  },
  "reviewClosureProtocol": "two-pass-v1"
}
-->
