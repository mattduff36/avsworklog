# Pilot and Wave Cutover Runbook

## Document Control
- Owner: Operations Lead
- Contributors: Engineering Lead, DBA, Product Owner
- Status: Draft for review
- Risk level: High
- Implementation window: OutOfHours
- Primary dependencies: `Data-Model-and-Migration-Spec.md`, `RLS-and-Authorization-Spec.md`, `Absence-Leave-Workflow-Spec-v2.md`

## Objective
Provide an operationally safe process for pilot and team-wave migration from legacy approval scope to org hierarchy v2, with fast rollback.

## Scope
- In scope:
  - Pilot team cutover.
  - Subsequent wave cutovers.
  - Validation, smoke tests, and rollback.
- Out of scope:
  - Business-hours feature development tasks.

## Roles and Responsibilities
- Release Commander: owns go/no-go decision.
- DBA Operator: executes schema/policy/data steps.
- App Operator: executes toggle and validation checks.
- Product Observer: validates business behavior.

## Pre-Window Checklist (T-48h to T-2h)
- Confirm approved pilot team and manager mapping list.
- Confirm staging dry-run succeeded with same step order.
- Confirm rollback plan tested in staging.
- Confirm incident and communication channels are active.
- Confirm no conflicting production changes in same window.

## Pilot Cutover Procedure (Weekend Window)

## Step 1: Readiness Gate
- Verify prechecks report zero blocking mapping issues.
- Verify all required scripts and dashboards are ready.
- Obtain explicit go-ahead from Release Commander.

## Step 2: Deploy Out-of-Hours Data/Policy Changes
- Apply approved production migration steps.
- Apply policy/function updates in documented order.
- Confirm migration logs are clean.

## Step 3: Backfill Pilot Team
- Create or verify team membership records.
- Create or verify line-manager mappings.
- Run post-backfill validation queries.

## Step 4: Enable Pilot Team Mode
- Set `absence_leave` mode to `org_v2` for pilot team only.
- Record exact timestamp and operator.

## Step 5: Smoke Test Matrix
- Employee in pilot team can submit/view own request.
- Pilot manager can view/approve direct report request.
- Pilot manager cannot approve outside scoped users.
- Admin can view/approve across teams.
- Legacy team behavior remains unchanged.

## Step 6: Decision Gate
- If all checks pass: keep pilot enabled and monitor.
- If any critical check fails: execute rollback immediately.

## Rollback Procedure (Pilot)
- Set pilot team mode back to `legacy`.
- Re-run critical smoke tests.
- Confirm behavior has returned to baseline.
- Open incident review and block next wave until resolved.

## Wave Rollout Procedure (Subsequent Teams)
- Process one wave at a time.
- For each team:
  1. Re-validate mappings.
  2. Enable team mode.
  3. Execute smoke tests.
  4. Observe for stabilization period.
- Do not run next wave until current wave is green.

## Monitoring and Alerts
- Monitor approval action failures.
- Monitor authorization denied spikes.
- Monitor request queue anomalies by team.
- Monitor error logs on mode-switch timestamp windows.

## Communication Template
- Start message:
  - "Org hierarchy v2 pilot cutover has started for [team]."
- Success message:
  - "Pilot cutover completed successfully for [team]."
- Rollback message:
  - "Pilot cutover rolled back to legacy mode for [team]. Reason: [short reason]."

## Go / No-Go Criteria
- Go when:
  - Prechecks pass.
  - Required personnel are present.
  - Rollback path is confirmed.
- No-Go when:
  - Unresolved mapping integrity issues remain.
  - Monitoring is unavailable.
  - Rollback execution ownership is unclear.
