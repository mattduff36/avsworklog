# Test Strategy and Acceptance Criteria

## Document Control
- Owner: QA Lead
- Contributors: Engineering Lead, Product Owner
- Status: Draft for review
- Risk level: Medium
- Implementation window: BusinessHours
- Primary dependencies: `Absence-Leave-Workflow-Spec-v2.md`, `RLS-and-Authorization-Spec.md`, `Pilot-and-Wave-Cutover-Runbook.md`

## Objective
Define the test strategy and acceptance criteria for org hierarchy v2 Phase 1 (absence and leave), including dual-mode team behavior.

## Scope
- In scope:
  - Unit, integration, and regression testing for Phase 1 behavior.
  - Legacy and org_v2 coexistence validation.
- Out of scope:
  - Non-Phase 1 workflow enforcement.

## Test Levels

## Unit Tests
- Scope resolver:
  - admin global allow,
  - manager scoped allow,
  - non-scoped deny.
- Team mode resolver:
  - `legacy` and `org_v2` selection correctness.
- Mapping validation:
  - self-manager block,
  - manager cycle detection,
  - missing manager handling.

## Integration Tests
- Absence list scoping by actor type and team mode.
- Approve/reject action authorization matrix.
- API-level denial behavior for unauthorized actors.
- Team mode switch effects without redeploy.

## Regression Tests
- Existing legacy team behavior unchanged.
- Existing role and module access unaffected.
- Admin user-management workflows continue working.
- Existing approvals page remains functional for non-migrated teams.

## Acceptance Matrix (Phase 1)

| Scenario | Expected Result |
|---|---|
| Employee views own absence | Allowed |
| Employee views another user absence | Denied |
| Manager approves direct report in org_v2 team | Allowed |
| Manager approves other-team user in org_v2 team | Denied |
| Admin approves any team user | Allowed |
| Non-migrated team uses legacy behavior | Unchanged |

## Data Quality Gates
- 100 percent of pilot users have valid team assignment.
- 100 percent of pilot users requiring approver have valid line manager mapping.
- Zero manager cycle violations in pilot dataset.

## Pre-Cutover Validation Suite
- Run unit and integration suite in CI.
- Run staging cutover simulation and smoke tests.
- Confirm no critical test failures before production window.

## Post-Cutover Validation Suite
- Execute smoke matrix in runbook.
- Validate denial and allow paths from real pilot accounts.
- Validate no unexpected authorization error spikes.

## Exit Criteria
- Business-hours implementation is complete when:
  - all required automated tests pass,
  - test evidence is attached to release checklist,
  - pilot pre-cutover validation is green.

## Go / No-Go Criteria
- Go when:
  - acceptance matrix passes in staging,
  - pilot data quality gates pass,
  - rollback test has been validated.
- No-Go when:
  - any critical authorization path fails,
  - legacy behavior regressions are detected.
