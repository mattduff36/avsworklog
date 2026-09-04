# Fix project user assignment

CRITICAL contract for Projects (`rams`) assignment: Level 4 DELETE RLS plus a company-wide `rams-assignment` directory context.

Workstream: `ws_f6b707be9f36d4d8`

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

## Classification

- Lane: CRITICAL
- risk: high
- Reason: new RLS DELETE policy on `rams_assignments`; directory visibility change for managers; assignment write path
- Task type: change
- routingDecision: economical_default
- Workstream: `ws_f6b707be9f36d4d8`

## Recommended build model

- Implementation: Cursor Grok economical-default after the architecture-gate
- Family: cursor-grok
- Mandatory premium gates: architecture-gate before implementation; premium final-diff after frozen-candidate verification
- Execution mode: Agent
- Fallback: stop and report if the gate rejects the RLS/user-client contract, or if implementation would need an admin-client write bypass, production data backfill, or manage-page assign UI

## Architecture gate

- Status: approved_with_conditions by independent architecture-gate `3fe2714e-3c75-48cb-9814-9de74394434d`
- Source: independent_subagent
- Locked conditions from the approved operator plan plus architecture-gate:
  - New forward migration only. Do not edit `20260806_permission_alignment_tighten_rls.sql`.
  - DELETE policy: `FOR DELETE TO authenticated USING ((SELECT public.effective_has_module_level('rams', 4)))`.
  - Keep `POST /api/rams/[id]/assign` on the user-scoped server client. Do not switch writes to the admin client.
  - After DELETE, `.select('employee_id')` and fail closed if returned IDs do not match unsigned `unassignableIds`.
  - Preserve Level 4, signed-user lock, system-account block, and status-preserving upsert.
  - `rams-assignment` directory context: Level 4 only, requires `module=rams`, 403 without Level 4, no `team_id` scope when valid.
  - `AssignEmployeesModal` must request `context: 'rams-assignment'`.
  - Users without `rams` module access stay hidden. No assign control on `/projects/manage`. No schema/column changes. No production data backfill.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

## Implementation contract

### Invariants

- Only Projects Level 4 (effective role, View As aware) can assign, unassign, or open the company-wide assignment directory.
- Signed assignments are never deleted.
- Unassign either removes the intended unsigned rows or returns an error. False-success is forbidden.
- RLS remains the database boundary; application authz still runs first.
- Generic `/api/users/directory` without `rams-assignment` stays team-scoped for non-admin managers.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter `initialized` / preflight to mint a new `first` review.

### Boundaries

- In scope: DELETE RLS migration; assign-route delete verification; `rams-assignment` directory context; AssignEmployeesModal + `fetchUserDirectory` typing; targeted tests.
- Out of scope: manage-page assign button; admin-client writes; changing signed-user lock; changing who has `rams` module access; FAQ rewrite unless a one-line path clarification is needed; production data edits.
- Migration apply to production still needs explicit CRITICAL authorization.

### Rollback

- Revert the feature commit.
- If the migration has been applied: add a forward migration that `DROP POLICY IF EXISTS "Managers can delete assignments" ON public.rams_assignments`. Do not edit the shipped file.

## Required tests

1. `RLS-RAMS-DEL-001`
2. `DIR-RAMS-ASSIGN-001`
3. `DIR-RAMS-ASSIGN-002`
4. `DIR-RAMS-ASSIGN-003`
5. `DIR-RAMS-ASSIGN-004`
6. `ASSIGN-UNASSIGN-001`
7. `ASSIGN-SIGNED-001`
8. `T-EXISTING-DIR-GATES`
9. `T-TYPECHECK`
10. `T-LINT`

## Final review

- Independent premium final-diff after every required ID is completed or explicitly unresolved.
- Bounded `two-pass-v1`.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- After two failed premium rounds the lineage is `routing_required`. That state is terminal for the normal review loop and is not `finalised`, `review_closed`, or `finalise_ready`.
- Immediately before premium final-diff, run one bounded economical adversarial challenge. The challenge is not premium review, not approval, and does not consume or reset the two-pass budget.

## Commit and handoff

- Commit after implementation: `fix(projects): allow managers to assign and unassign across teams`
- Handoff: local commit; do not push unless the operator uses an authorized push phrase

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_f6b707be9f36d4d8",
  "taskId": "fix-project-assignment",
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
    "switchTiming": "before_substantive_implementation",
    "rationale": "RLS DELETE plus manager directory visibility is CRITICAL persistence/permissions work. Build economically after the architecture-gate locks the user-client and Level 4 contracts.",
    "fallbackEscalation": "Stop and report if the architecture-gate rejects the RLS/user-client contract, or if implementation would need an admin-client write bypass, production data backfill, or manage-page assign UI."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "rams-assignments-delete-rls",
    "projects-assignment-directory-visibility",
    "assignment-write-path"
  ],
  "requiredTests": [
    { "id": "RLS-RAMS-DEL-001", "status": "completed" },
    { "id": "DIR-RAMS-ASSIGN-001", "status": "completed" },
    { "id": "DIR-RAMS-ASSIGN-002", "status": "completed" },
    { "id": "DIR-RAMS-ASSIGN-003", "status": "completed" },
    { "id": "DIR-RAMS-ASSIGN-004", "status": "completed" },
    { "id": "ASSIGN-UNASSIGN-001", "status": "completed" },
    { "id": "ASSIGN-SIGNED-001", "status": "completed" },
    { "id": "T-EXISTING-DIR-GATES", "status": "completed" },
    { "id": "T-TYPECHECK", "status": "completed" },
    { "id": "T-LINT", "status": "completed" }
  ],
  "unresolvedRisks": [
    { "id": "MIG-APPLY-001", "note": "Migration is not applied until explicitly authorised." },
    { "id": "MANAGER-SESSION-001", "note": "Planning could not log in as the reporting manager; live proof is code plus production RLS." }
  ],
  "implementationContract": {
    "invariants": [
      "Only Projects Level 4 can assign, unassign, or open the company-wide assignment directory.",
      "Signed assignments are never deleted.",
      "Unassign either removes the intended unsigned rows or returns an error. False-success is forbidden.",
      "RLS remains the database boundary; application authz still runs first.",
      "Generic /api/users/directory without rams-assignment stays team-scoped for non-admin managers.",
      "Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.",
      "The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter initialized / preflight to mint a new first review."
    ],
    "boundaries": [
      "Do not edit historical migrations.",
      "Do not switch assign/unassign writes to the admin client.",
      "Do not add an Assign control on /projects/manage.",
      "Do not apply the production migration unless the operator authorises it.",
      "Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget."
    ],
    "rollback": "Revert the feature commit. If the migration has been applied, add a forward migration that DROP POLICY IF EXISTS Managers can delete assignments. Do not edit the shipped file."
  },
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1"
}
-->
