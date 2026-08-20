# 12-month archived error log retention

Workstream: `ws_9a32058dd5c4e0c4`  
Source: `ws_4720608c76e8b80b`

## Classification

- Lane: CRITICAL
- Risk: high
- Why: production DELETE of expired archived `error_logs` and safety-contract bump to `fixerrors-exact-snapshot-v4`.
- Task type: change. Not a trusted operational execution of leftover v3 archive-only commands.

## Recommended build model

- Implementation stays on the economical Cursor Grok parent after the architecture gate.
- Mandatory premium gates: architecture-gate and final-diff-reviewer.

## Architecture gate

- Independent premium architecture gate: `approved_with_conditions` ([Architecture](cf48d343-2dc0-479a-83f9-b5d6cfc0b1b3)).
- Reasons: production DELETE, snapshot/retention binding split, FK CASCADE/SET NULL, leftover v3 fail-closed.

## Implementation contract

- Purge only `status = 'archived' AND archived_at IS NOT NULL AND archived_at < now() - 12 months`.
- Separate SERIALIZABLE transaction after a committed archive or empty-snapshot no-op.
- Never delete active rows.
- Alerts change only via CASCADE; health/usage FKs SET NULL.
- Retention is bound to the transaction-local candidate set, not the exported snapshot.
- Leftover v3 artifacts fail closed.

## Required tests

| ID | Status | Check |
| --- | --- | --- |
| FE-RETENTION-001 | completed | Isolated PostgreSQL (PGlite) eligibility, cutoff, active preserved, CASCADE, SET NULL |
| FE-RETENTION-TXN-002 | completed | Archive stays committed if purge fails; mismatch rolls back; commit uncertainty indeterminate |
| FE-RETENTION-EMPTY-003 | completed | Empty snapshot still runs independently safeguarded purge |
| FE-RETENTION-MIG-004 | completed | Exact valid partial index and non-pooling concurrent runner |
| FE-TRUST-002 | completed | v4 registry; leftover v3 / delete-all / extra tables / predicate changes / missing binds suspend trust |

## Final review

- Independent premium final-diff review of this retention delta only.

## Commit and handoff

- Local commit after verification and review. Do not push unless requested.

## Unresolved risks

- FE-RETENTION-EVENTUAL-001: purge is eventual (first successful `fixerrors` after eligibility).
- FE-RETENTION-BACKLOG-002: a large eligible backlog may take one SERIALIZABLE purge window.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_9a32058dd5c4e0c4",
  "sourceWorkstreamIds": ["ws_4720608c76e8b80b"],
  "taskId": "error-log-retention-12m",
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
    "rationale": "Registered fixerrors safety-contract change plus production DELETE of expired archived rows.",
    "fallbackEscalation": "Stop if review requires deleting active rows or widening the retention predicate."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "production-retention-delete",
    "trusted-command-safety-contract-v4",
    "snapshot-versus-candidate-set-binding"
  ],
  "requiredTests": [
    { "id": "FE-RETENTION-001", "status": "completed" },
    { "id": "FE-RETENTION-TXN-002", "status": "completed" },
    { "id": "FE-RETENTION-EMPTY-003", "status": "completed" },
    { "id": "FE-RETENTION-MIG-004", "status": "completed" },
    { "id": "FE-TRUST-002", "status": "completed" }
  ],
  "unresolvedRisks": [
    { "id": "FE-RETENTION-EVENTUAL-001", "note": "Purge is eventual: first successful fixerrors after eligibility." },
    { "id": "FE-RETENTION-BACKLOG-002", "note": "A large eligible backlog may occupy one SERIALIZABLE purge window." }
  ],
  "implementationContract": {
    "invariants": [
      "Purge deletes only archived rows whose archived_at is older than the transaction cutoff.",
      "Active rows are never deleted.",
      "error_log_alerts change only via CASCADE; health and usage FKs SET NULL.",
      "Retention is bound to the transaction-local candidate set, not the exported snapshot."
    ],
    "boundaries": [
      "Do not delete active rows.",
      "Do not run purge after failed or indeterminate archive.",
      "Do not bind retention delete to the exported error snapshot."
    ],
    "rollback": "Keep the additive archived_at index. Revert writers to v3 archive-only behaviour; never restore unbounded DELETE."
  },
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1"
}
-->
