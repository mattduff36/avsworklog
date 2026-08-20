# Archive error logs instead of deleting them

Workstream: `ws_4720608c76e8b80b`

## Classification

- Lane: CRITICAL
- Why: additive `error_logs` persistence, production archive mutation, and registered `/fixerrors` safety-contract change (`fixerrors-exact-snapshot-v3`).
- Task type: change. Not a trusted operational execution of the retired v2 delete command.

## Architecture source and reasons

- Independent premium architecture gate: `approved_with_conditions` ([Architecture](35c0bb69-5ecd-441a-9363-81f0ea88a3ff)).
- Reasons: snapshot-selection contract, transactional archive bound, RLS UPDATE, crash reconciliation, rollback must never delete archived audit rows.

## Implementation contract

- Archive exact checksummed snapshot IDs by updating only `status` and `archived_at`.
- Snapshot, UI, badge, email, and notify-new default to `status = 'active'`.
- Same-run `npm run fixerrors` archives after analysis; no human confirmation.
- `--cleanup` remains crash-recovery only and archives, never deletes.
- Reject v1/v2 artifacts before database work.

## Invariants

- `active => archived_at IS NULL`; `archived => archived_at IS NOT NULL`.
- `error_log_alerts` and application FK references remain untouched.
- Newer rows stay active.
- Debug Clear All archives active rows only, regardless of the archived toggle.
- Rollback stays status-aware and never deletes archived rows.

## Required tests

| ID | Status | Check |
| --- | --- | --- |
| FE-SAFE-001 | completed | Snapshot filters active; archive UPDATE; remaining active-only; references allowed; crash reconciliation; v2 fail-closed |
| FE-TRUST-001 | completed | v3 update scope, column constraint, v2/delete mismatch suspends trust |
| FE-DEBUG-001 | completed | Default active list, includeArchived, clear archives active only |
| FE-DASH-001 | completed | Dashboard badge filters `status = 'active'` |

## Unresolved risks

- FE-GROWTH-001: archived rows accumulate; no purge in this change.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_4720608c76e8b80b",
  "taskId": "error-log-archive",
  "taskType": "change",
  "risk": "high",
  "lane": "critical",
  "initialParentTier": "unknown",
  "routingDecision": "unknown",
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
    "switchTiming": "after_plan_approval",
    "rationale": "Registered fixerrors safety-contract change plus additive production schema.",
    "fallbackEscalation": "Stop if review requires deleting archived rows or widening mutation columns."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "snapshot-selection-contract",
    "production-archive-mutation",
    "trusted-command-safety-contract-v3"
  ],
  "requiredTests": [
    { "id": "FE-SAFE-001", "status": "completed" },
    { "id": "FE-TRUST-001", "status": "completed" },
    { "id": "FE-DEBUG-001", "status": "completed" },
    { "id": "FE-DASH-001", "status": "completed" }
  ],
  "unresolvedRisks": [
    "FE-GROWTH-001"
  ],
  "implementationContract": {
    "invariants": [
      "Archive mutates only exact checksummed snapshot IDs.",
      "error_log_alerts and application FK references remain untouched.",
      "Newer rows remain active.",
      "Rollback never deletes archived audit rows."
    ],
    "boundaries": [
      "No purge/un-archive UI.",
      "Do not change error_reports.status.",
      "Do not delete archived rows from product or maintenance scripts."
    ],
    "rollback": "Keep additive columns. Revert writers to status-aware archive-only behaviour; never restore v2 DELETE of archived rows."
  },
  "reviewClosureProtocol": "two-pass-v1"
}
-->
