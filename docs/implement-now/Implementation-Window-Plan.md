# Implementation Window Plan

## Document Control
- Owner: Engineering Lead
- Contributors: Operations Lead, Product Owner
- Status: Draft for review
- Risk level: Medium
- Implementation window: BusinessHours
- Primary dependencies: all documents in `/docs/implement-now` and `/docs/out-of-hours`

## Objective
Provide a single sequencing guide that clearly separates work that can be implemented now from tasks that must be executed out of hours.

## Window Labels
- `BusinessHours`: can be built, tested, and prepared with low service risk.
- `OutOfHours`: production-impacting changes requiring controlled cutover windows.

## Phase Sequence

## Phase 1 - BusinessHours Preparation
- Finalize architecture and workflow specs.
- Build feature-flagged app changes.
- Build and validate API and UI changes.
- Prepare migration scripts in dry-run mode.
- Complete automated and staging validation.

## Phase 2 - OutOfHours Pilot Cutover
- Execute production data/policy deployment for pilot.
- Backfill pilot mappings and validate.
- Enable pilot team mode.
- Run smoke tests and monitor.
- Roll back if any critical gate fails.

## Phase 3 - BusinessHours Stabilization
- Review pilot outcomes and defect patterns.
- Apply non-disruptive fixes behind flags.
- Confirm next wave readiness checklist.

## Phase 4 - OutOfHours Wave Cutovers
- Repeat team-wave enablement process.
- Validate each wave before moving to next.
- Keep rollback path active per wave.

## Phase 5 - BusinessHours Consolidation Planning
- Evaluate readiness to reduce legacy path reliance.
- Plan expansion to timesheets/workshop/report scoping.
- Prepare Phase 2 architecture addendum.

## Task Mapping By Window

| Task | Window | Dependency |
|---|---|---|
| Feature-flagged app logic | BusinessHours | Architecture and workflow specs |
| API and admin UI updates | BusinessHours | Admin UX and API spec |
| Automated and staging tests | BusinessHours | Test strategy doc |
| Production schema updates | OutOfHours | Data model and migration spec |
| Production policy/function updates | OutOfHours | RLS and authorization spec |
| Production backfill | OutOfHours | Valid mapping input and runbook |
| Team mode cutovers | OutOfHours | Pilot and wave runbook |
| Rollback actions | OutOfHours | Runbook and monitoring readiness |

## Handoff Checklist (BusinessHours -> OutOfHours)
- All business-hours validation evidence attached.
- Pilot team mapping file approved.
- Release commander assigned.
- Monitoring and rollback owners confirmed.
- Go/no-go review signed off.

## Success Metrics
- No unplanned service outage during migration windows.
- No non-admin cross-team approval in org_v2 teams.
- Pilot and each wave pass smoke checks.
- Legacy teams remain unaffected until toggled.

## Go / No-Go Criteria
- Go when:
  - all prerequisite documents are approved,
  - validation evidence is complete,
  - cutover team and rollback owners are confirmed.
- No-Go when:
  - prerequisite documents are not approved,
  - pre-cutover validation is incomplete,
  - no confirmed rollback execution owner exists.
