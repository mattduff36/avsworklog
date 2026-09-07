# Completed workshop corrections (isolated release successor)

CRITICAL release plan for completed workshop-task and attachment corrections, re-homed from the exhausted `ws_c8f31a0e7b924d65` lineage into an independently isolated Git context.

Baseline: `workflow/workshop-completed-corrections` from `88d1dd6498b147535f5c1fc1cc49a44ef486a605`.
Workstream: `ws_fcfc4b85d3ea8fab`.

The predecessor failed first and closure review and is not claimed as passed. Its implementation was cherry-picked as a new SHA; the successor must add the completed-timestamp manager gate and receive fresh independent review.

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

## Classification

- Lane: CRITICAL.
- Risk: high.
- Task type: change.
- Reason: authorization, service-role writes, audit persistence, RLS, migration, and production release.
- routingDecision: continued_premium.
- Execution mode: Agent with GPT-5.6 Sol as implementing parent.
- No `sourceWorkstreamIds`; provenance is represented only by `rehomeProvenance`.

## Recommended build model

- Implementation: GPT-5.6 Sol parent in Agent mode.
- Mandatory independent gates: architecture-gate before the remaining auth change; final-diff-reviewer after frozen-candidate verification.
- Switch timing: not applicable; the operator selected the current premium parent.
- Fallback: stop if supported route/re-home evidence cannot be bound, authorization would occur after admin-client creation, verification fails materially, or the two-pass successor review budget is exhausted.

## Architecture gate

- Status: approved_with_conditions by independent architecture-gate `e9c9a389-e29f-4ffa-9c38-e7ce48f6f018`.
- Required conditions:
  - App session → workshop-tasks → effective manager-or-higher before any admin/Postgres client or mutation.
  - No `getUser()` security boundary on completed correction write paths.
  - Apply the manager gate to the entire completed-timestamp PATCH; non-manager returns 403 with no admin client or table access.
  - Completed Service meter, next type, asset, and category remain on `correctServiceWorkshopTask`.
  - Completed attachment schema POST remains 409; managers use `correct-responses`.
  - Preserve migration audit RLS and triggers.

## Implementation contract

### Invariants

- `requireWorkshopTasksManagerAccess()` runs before any admin/Postgres client in the timestamp PATCH.
- Non-managers receive 403 and no mutation is attempted.
- Correction-event timestamp edits continue to return 400.
- Responses continue through `jsonWithWorkshopSession`.
- Completed Service scheduling identity and meter changes remain on the dedicated service correction path.
- Completed attachment response changes remain manager-gated and audited.
- The predecessor stays exhausted, re-homed, non-release, and not marked passed.
- Review and verification evidence must bind to the successor HEAD and product-tree fingerprint.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

### Boundaries

- In scope: cherry-picked completed-correction implementation, timestamp route manager gate, directly affected tests, required verification, migration via finalise, and production landing on `origin/main`.
- Out of scope: SS15AVS 650153 application, R1–R5 residual cleanup, UI polish, broad auth changes, migration redesign, workflow tooling changes, and full finalise.
- Do not force-push, use `--no-verify`, hand-edit protocol JSON, or push a preview branch as production.

### Rollback

Before release, revert the successor commits. After release, use forward migration/application rollback practices and revert the product commits; never rewrite the applied migration or ledger.

## Required tests

1. `WT-CORR-CTA-001` — the Correct Service action retains explicit readable workshop colours.
2. `WT-CORR-AUTH-001` — unauthenticated completed-task and attachment corrections return 401 before privileged services.
3. `WT-CORR-AUTH-002` — authenticated non-manager completed-task and attachment corrections return 403 before privileged services.
4. `WT-CORR-SVC-001` — completed Service correction preserves dedicated scheduling behavior.
5. `WT-CORR-SVC-002` — Service category/subcategory identity and dependent scheduling behavior remain correct.
6. `WT-CORR-TASK-001` — completed task correction validates and audits allowed fields.
7. `WT-CORR-ATT-001` — completed attachment response correction validates and audits allowed fields.
8. `WT-CORR-ATT-002` — invalid required attachment responses are rejected while completed rows remain locked.
9. `WT-CORR-VIEWAS-001` — View-As authorization follows the effective role.
10. `WT-CORR-AUTH-COMPLETED-TIMESTAMP` — timestamp PATCH requires effective manager-or-higher before admin access; non-manager is 403 with no write.
11. `T-TYPECHECK` — TypeScript typecheck.
12. `T-LINT` — lint.
13. `T-EXISTING-WORKFLOW-TESTS` — canonical workflow verification suite.

## Final review

- Run one bounded economical adversarial challenge, at most one consolidated repair, and one re-check.
- Generate a fresh compact premium-review packet for the exact successor HEAD and fingerprint.
- Independent `final-diff-reviewer` first pass is mandatory.
- PASS closes review; do not run closure.
- FAIL permits one consolidated blocker-family repair, fix-delta evidence, and one closure review. Closure FAIL means `routing_required` and stop.
- Packet/readiness evidence is not approval; only the independent recorded review can close the successor.

## Commit and handoff

- Cherry-picked implementation commit: `a87180714698122cfa5dead0dd6fb4c0e20d7331`.
- Remaining commit: `fix(workshop-tasks): manager-gate completed timestamp adjustments`.
- Finalise: `npm run finalise:push` only after protocol readiness permits it.
- Production target: confirm `origin/main` is the Vercel production branch, land successor SHAs only, confirm deployment, and report the finalise summary path.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_fcfc4b85d3ea8fab",
  "taskId": "workshop-completed-corrections-release-20260907",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "premium",
  "routingDecision": "continued_premium",
  "recommendedBuildModel": {
    "implementation": {
      "role": "premium-fix-routing",
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
    "rationale": "The operator selected GPT-5.6 Sol as the implementing parent for this urgent CRITICAL re-home and release.",
    "fallbackEscalation": "Stop on unsupported re-home evidence, authorization-order regression, material verification failure, or exhausted successor review budget."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "authorization",
    "service-role-write",
    "migration-and-rls",
    "production-release"
  ],
  "requiredTests": [
    { "id": "WT-CORR-CTA-001", "status": "unresolved" },
    { "id": "WT-CORR-AUTH-001", "status": "unresolved" },
    { "id": "WT-CORR-AUTH-002", "status": "unresolved" },
    { "id": "WT-CORR-SVC-001", "status": "unresolved" },
    { "id": "WT-CORR-SVC-002", "status": "unresolved" },
    { "id": "WT-CORR-TASK-001", "status": "unresolved" },
    { "id": "WT-CORR-ATT-001", "status": "unresolved" },
    { "id": "WT-CORR-ATT-002", "status": "unresolved" },
    { "id": "WT-CORR-VIEWAS-001", "status": "unresolved" },
    { "id": "WT-CORR-AUTH-COMPLETED-TIMESTAMP", "status": "unresolved" },
    { "id": "T-TYPECHECK", "status": "unresolved" },
    { "id": "T-LINT", "status": "unresolved" },
    { "id": "T-EXISTING-WORKFLOW-TESTS", "status": "unresolved" }
  ],
  "unresolvedRisks": [
    {
      "id": "migration-rollout",
      "note": "The audited correction tables, RLS, and triggers must be applied through finalise before the application release."
    },
    {
      "id": "ss15avs-not-applied",
      "note": "The separate SS15AVS 650153 production correction is deliberately excluded."
    }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1",
  "implementationContract": {
    "invariants": [
      "requireWorkshopTasksManagerAccess runs before any admin or Postgres client in the timestamp PATCH.",
      "Non-managers receive 403 and no write is attempted.",
      "Correction-event timestamp edits remain 400 and responses use jsonWithWorkshopSession.",
      "Completed Service scheduling changes remain on correctServiceWorkshopTask.",
      "Completed attachment corrections remain manager-gated and audited.",
      "The predecessor remains exhausted, re-homed, non-release, and not passed.",
      "Review and verification evidence bind to the successor HEAD and product-tree fingerprint.",
      "Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget."
    ],
    "boundaries": [
      "Only the re-homed completed-correction implementation, timestamp manager gate, directly affected tests, required verification, migration through finalise, and production landing.",
      "No SS15AVS 650153 application.",
      "No residual cleanup, UI polish, broad auth changes, migration redesign, or workflow tooling changes.",
      "No force-push, no --no-verify, and no hand-edited protocol JSON."
    ],
    "rollback": "Revert the successor product commits before release; after release use forward migration practices and never rewrite applied migration or ledger evidence."
  },
  "rehomeProvenance": {
    "schemaVersion": "1",
    "status": "declared",
    "predecessorRootWorkstreamId": "ws_c8f31a0e7b924d65",
    "predecessorDescendantWorkstreamId": "ws_c8f31a0e7b924d65",
    "predecessorHeadCommit": "5e1e2e5e364ed43daa6c8baef208a0e390e2478c",
    "predecessorReleaseContext": "D:/Websites/avsworklog#workflow/workshop-completed-corrections-exhausted",
    "successorBranchName": "workflow/workshop-completed-corrections",
    "successorBaselineCommit": "88d1dd6498b147535f5c1fc1cc49a44ef486a605",
    "sourcePatchSha256": "3ef75916f42a877c116b19c60b7f05c879f1319539c50b68fbf8a4498bd2dd65",
    "sourceProductTreeFingerprint": "23686053bcdb90ead5b10281c6032743b44a485a02b9345eef91a06a2c2aa3d1",
    "sourceReleaseContext": "D:/Websites/avsworklog#workflow/workshop-completed-corrections-exhausted",
    "sourceHeadCommit": "5e1e2e5e364ed43daa6c8baef208a0e390e2478c",
    "sourceBaselineCommit": "88d1dd6498b147535f5c1fc1cc49a44ef486a605",
    "sourceReviewWorkstreamId": "ws_c8f31a0e7b924d65",
    "predecessorHeadIsAncestor": false,
    "predecessorPassedReview": false
  }
}
-->
