# Classification

CRITICAL timesheet payroll follow-up: overnight Double Time, Accounts-only Payroll Received, append-only profile overrides, generic PDF Job number / Yard.

## Recommended build model

Premium parent remains owner after independent architecture gate `approved_with_conditions`.

## Architecture gate

Independent architecture-gate subagent: PASS_WITH_CONDITIONS. Required adjustments incorporated: engine version 2, approve requires authorise plus payroll-received actor, detail Manager Approved uses `/process`, override save is append-only and non-retroactive.

## Implementation contract

See marker invariants, boundaries, and rollback.

## Required tests

Stable IDs in the plan-contract marker.

## Final review

Independent premium final-diff review after verification.

## Commit and handoff

Local commit after verification. No push unless explicitly authorised.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ts-payroll-client-fixes-20260827",
  "taskId": "ts-payroll-client-fixes-20260827",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "premium",
  "routingDecision": "continued_premium",
  "recommendedBuildModel": {
    "implementation": {
      "role": "premium-planning",
      "tier": "premium",
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
    "rationale": "CRITICAL payroll money and approval authz stay on the parent after the independent architecture gate.",
    "fallbackEscalation": "Stop and route or split if overnight treatment, payroll-received authz, or override immutability contradict the contract."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "payroll-money-calculation",
    "approval-authorization-boundary",
    "immutable-payroll-assignments"
  ],
  "requiredTests": [
    { "id": "PAY-NIGHT-OVERNIGHT-001", "status": "unresolved" },
    { "id": "PAY-NIGHT-OVERNIGHT-SAT-001", "status": "unresolved" },
    { "id": "PAY-NIGHT-OVERNIGHT-LORRIES-001", "status": "unresolved" },
    { "id": "PAY-NIGHT-MANUAL-001", "status": "unresolved" },
    { "id": "PAY-PREC-BH-OVERNIGHT-001", "status": "unresolved" },
    { "id": "PAY-ENGINE-VERSION-002", "status": "unresolved" },
    { "id": "PAY-APPROVE-PAYROLL-ACTOR-001", "status": "unresolved" },
    { "id": "PAY-APPROVE-MANAGER-DENIED-001", "status": "unresolved" },
    { "id": "PAY-PROCESS-MANAGER-001", "status": "unresolved" },
    { "id": "PAY-AUTH-APPROVAL-001", "status": "unresolved" },
    { "id": "PAY-UI-PAYROLL-BUTTON-001", "status": "unresolved" },
    { "id": "PAY-OVERRIDE-SAVE-001", "status": "unresolved" },
    { "id": "PAY-OVERRIDE-RESOLVE-001", "status": "unresolved" },
    { "id": "PAY-PDF-JOB-YARD-001", "status": "unresolved" },
    { "id": "PAY-PDF-REMARKS-001", "status": "unresolved" },
    { "id": "TS-TYPECHECK-001", "status": "unresolved" }
  ],
  "unresolvedRisks": [
    { "id": "RISK-ROLE-LIVE-001", "note": "Live Suzanne/Charlotte team and role were not queried; Accounts manager/supervisor plus admin is the code detector." },
    { "id": "RISK-OVERNIGHT-HEURISTIC-001", "note": "Rounded finish-before-start is treated as overnight." },
    { "id": "RISK-ASSIGNMENT-IMMUTABLE-001", "note": "A wrong future assignment cannot be corrected for the same Sunday." },
    { "id": "RISK-NAMED-OVERRIDE-001", "note": "Paul Jankiewicz and Dave Johnson production writes wait for explicit authorisation." }
  ],
  "implementationContract": {
    "invariants": [
      "submitted then Payroll Received then Manager Approved",
      "team managers cannot create a payroll snapshot",
      "bank holiday Double Time beats night and calendar",
      "Lorries overnight stays on calendar bands",
      "approved snapshots stay immutable",
      "Activate remains the only path that publishes new rule versions"
    ],
    "boundaries": [
      "no migration",
      "no historical snapshot rebuild",
      "no production named-employee write without explicit authorisation",
      "no email allowlist",
      "no Plant PDF change"
    ],
    "rollback": "Revert calculator overnight helper, payroll-received authz, override-save action, and generic PDF column. Existing snapshots and assignment rows remain."
  },
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending"
}
-->
