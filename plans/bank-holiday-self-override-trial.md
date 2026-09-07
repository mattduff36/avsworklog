# Bank holiday self-override trial — CRITICAL cluster

CRITICAL cluster only: settings table/RLS, confirmation dates, confirm API override write, settings write API, and submit fail-closed. GUARDED timesheet modal/off-day unlock and STANDARD admin card/notification are out of this workstream.

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_425d015b6a54acad",
  "taskId": "bank-holiday-self-override-trial",
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
    "rationale": "Implementation is mechanical after the architecture gate confirms additive schema, confirm-before-persist, and submit fail-closed. No trigger rewrite.",
    "fallbackEscalation": "Stop and report if the architecture gate requires changing enforce_timesheet_entry_absence_rules, a second hours-bypass, or a production data backfill."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "schema-rls-persistence",
    "absence-override-write",
    "payroll-adjacent-timesheet-hours"
  ],
  "requiredTests": [
    { "id": "BH-TRIAL-PHRASE-001", "status": "completed" },
    { "id": "BH-TRIAL-OVERRIDE-001", "status": "completed" },
    { "id": "BH-TRIAL-SUBMIT-001", "status": "completed" },
    { "id": "BH-TRIAL-OFF-001", "status": "completed" },
    { "id": "BH-TRIAL-SETTINGS-001", "status": "completed" }
  ],
  "unresolvedRisks": [
    {
      "id": "draft-client-write-race",
      "note": "Draft saves still write entries from the browser. Confirm must complete before insert, or the existing trigger wipes hours. Submit is independently fail-closed."
    }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1",
  "implementationContract": {
    "invariants": [
      "Only is_bank_holiday absences can be auto-overridden.",
      "Hours cannot persist without the existing allow_timesheet_work_on_leave override flag.",
      "Confirm plus override write must succeed before entry persist for draft and submit.",
      "Submit independently rejects unconfirmed bank-holiday hours when the trial is ON.",
      "Trial flag defaults ON and is writable only by Admin Settings access.",
      "View As must not grant extra override-write rights.",
      "Do not change enforce_timesheet_entry_absence_rules to add a second bypass.",
      "Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.",
      "The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass."
    ],
    "boundaries": [
      "This workstream is schema/RLS, settings write API, confirm API, and submit fail-closed only.",
      "GUARDED off-day unlock and typed-confirm modal are out of this workstream.",
      "STANDARD admin card, employee flag GET, old-warning removal, and Submit notification are out of this workstream.",
      "No change to payroll 2x or timesheet_entries.bank_holiday treatment.",
      "No production data backfill."
    ],
    "rollback": "Turn the admin toggle OFF. New hours on bank holidays again require a manager override. Schema is additive."
  }
}
-->

## Classification

CRITICAL persistence/enforcement cluster only. Mixed-lane product: GUARDED/STANDARD surfaces are implemented in the same coding pass but are not this workstream and do not receive CRITICAL protocol state.

## Recommended build model

Cursor Grok economical-default implementation after an independent premium architecture gate. Mandatory premium final-diff after verification. Stop if the gate requires a trigger rewrite or a second hours-bypass.

## Architecture gate

Independent `architecture-gate` before any CRITICAL schema or API mutation. Conditions to confirm or reject:

- Confirm + override write before entry persist (draft and submit).
- Submit is independently fail-closed.
- Eligible override writes are `is_bank_holiday` absences only.
- Trigger contract unchanged: hours still require `allow_timesheet_work_on_leave` on annual leave.
- Settings writes use `requireAdminSettingsAccess`; employees cannot mutate the flag.

## Implementation contract

See marker invariants and boundaries. Additive `timesheet_module_settings` (default ON) and `timesheets.bank_holiday_work_confirmed_dates`. Confirm API sets override only on matching bank-holiday absences and merges confirmed dates. Submit rejects unconfirmed bank-holiday hours when trial is ON.

## Required tests

- `BH-TRIAL-PHRASE-001`
- `BH-TRIAL-OVERRIDE-001`
- `BH-TRIAL-SUBMIT-001`
- `BH-TRIAL-OFF-001`
- `BH-TRIAL-SETTINGS-001`

Existing timesheet absence guardrails remain: without override, the trigger still wipes hours.

## Final review

Independent premium final-diff after CRITICAL verification. One bounded economical challenge first. Fresh packet per premium pass. Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

## Commit and handoff

Local commit after the coding pass unless blocked. Not a push. Release-ready is not a push.
