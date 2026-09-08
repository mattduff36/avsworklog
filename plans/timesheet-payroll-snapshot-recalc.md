# Timesheet payroll snapshot recalculate

CRITICAL cluster only: Accounts/Admin recalculate of a frozen payroll snapshot from the current assignment. STANDARD report filters and override Sunday picker are out of this workstream.

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_fa784f334690ffeb",
  "taskId": "timesheet-payroll-snapshot-recalc",
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
    "rationale": "Implementation is mechanical after the architecture gate confirms snapshot insert, pointer move, and manager-gate clearing. No weekly pot and no calculator change.",
    "fallbackEscalation": "Stop and report if the architecture gate requires a weekly pot, snapshot UPDATE, schema change, or production write in this coding pass."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "payroll-money-mutation",
    "frozen-snapshot-revision"
  ],
  "requiredTests": [
    { "id": "PAY-RECALC-PLANT-001", "status": "completed" },
    { "id": "PAY-RECALC-REVISION-001", "status": "completed" },
    { "id": "PAY-RECALC-HASH-001", "status": "completed" },
    { "id": "PAY-RECALC-MANAGER-001", "status": "completed" },
    { "id": "PAY-RECALC-APPROVED-001", "status": "completed" },
    { "id": "PAY-RECALC-AUTH-001", "status": "completed" },
    { "id": "PAY-RECALC-NOSNAP-001", "status": "completed" },
    { "id": "PAY-RECALC-STALE-001", "status": "completed" },
    { "id": "PAY-RECALC-IDEM-001", "status": "completed" },
    { "id": "PAY-RECALC-NOTIFY-001", "status": "completed" }
  ],
  "unresolvedRisks": [
    {
      "id": "kevin-production-apply-gated",
      "note": "Authorised and applied 2026-09-07. Weeks 2026-08-16, 2026-08-23, and 2026-08-30 are Complete; 2026-09-06 is Payroll Received. Plant snapshots 24.00 / 4.50 / 3.00 / 0.6."
    },
    {
      "id": "manager-approved-cleared-on-bucket-change",
      "note": "processed weeks lose Manager Approved when pay buckets change. That is required, not optional."
    }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1",
  "implementationContract": {
    "invariants": [
      "Assigned admin rule is the only weekly-hours source (profile override > team > civils fallback).",
      "No weekly Basic pot and no work-shift scaling in calculate.ts.",
      "Recalculate inserts a new snapshot revision via insertPayrollSnapshotForLockedTimesheet; it does not UPDATE snapshot totals.",
      "Old snapshot rows remain; only current_payroll_snapshot_id moves.",
      "If pay buckets change, keep Payroll Received and clear Manager Approved (processed or manager_approved becomes approved).",
      "Already approved stays approved when buckets change.",
      "Identical input_hash is a no-op.",
      "Weeks without a current snapshot are rejected.",
      "Only Accounts/Admin payroll-received actors may recalculate.",
      "Do not change entries, travel, or leave.",
      "Do not write Kevin production data in this coding pass.",
      "Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.",
      "The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass."
    ],
    "boundaries": [
      "This workstream is the snapshot recalculate API, audit row, and timesheet-detail control only.",
      "STANDARD deleted-user report filters and override Sunday picker are out of this workstream.",
      "No schema or RLS change unless the architecture gate proves one is required.",
      "No production snapshot rebuild until explicit operator authorisation.",
      "No calculator, signed Plant bands, or weekly-pot change."
    ],
    "rollback": "Revert the recalculate API and button. Existing snapshot revisions remain; unused if never clicked."
  }
}
-->
