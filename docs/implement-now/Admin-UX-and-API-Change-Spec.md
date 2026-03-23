# Admin UX and API Change Spec

## Document Control
- Owner: Engineering Lead
- Contributors: Product Owner, UX Lead
- Status: Draft for review
- Risk level: Medium
- Implementation window: BusinessHours
- Primary dependencies: `Org-Hierarchy-v2-Architecture.md`, `Absence-Leave-Workflow-Spec-v2.md`

## Objective
Define planned admin interface and API behavior changes needed to manage hierarchy data and migration controls without breaking existing user-role workflows.

## Scope
- In scope:
  - Users module updates for team and line manager management.
  - Migration mode controls at team workflow level.
  - Backward compatible API contract additions.
- Out of scope:
  - Production data migration execution.
  - Timesheet/workshop/report permission rollout.

## UX Changes (Planned)

## 1) Users Table Enhancements
- Add columns:
  - Primary team
  - Line manager
  - Team mode for absence_leave (`legacy` or `org_v2`)
- Add filters:
  - Team
  - Manager
  - Migration mode

## 2) User Edit Flow Enhancements
- Add editable fields:
  - Assign primary team.
  - Assign line manager.
- Validation messaging:
  - Manager cannot be same as user.
  - Incomplete hierarchy blocks team `org_v2` switch.

## 3) Team Management View
- New team management section:
  - List teams and member counts.
  - Show workflow mode status for absence_leave.
  - Provide switch control with confirmation prompt.

## 4) Migration Safety UX
- Toggle confirmation includes:
  - Impact summary
  - Required validations
  - Rollback instruction link
- Read-only warning state if prechecks fail.

## API Contract Additions (Planned)

## Read APIs
- Users list endpoint:
  - include `team`, `line_manager`, `team_mode_absence_leave`.
- Teams list endpoint:
  - include `member_count`, `workflow_modes`.
- Validation endpoint:
  - returns hierarchy integrity issues by team.

## Write APIs
- Update user endpoint:
  - supports `team_id`, `line_manager_id`.
- Team mode endpoint:
  - set `workflow=absence_leave`, `mode=legacy|org_v2`.
- Bulk mapping endpoint (optional):
  - batch assign team and manager mappings for pilot prep.

## Authorization Expectations
- Admin only:
  - team mode changes,
  - cross-team mapping edits,
  - migration operations.
- Manager non-admin:
  - no migration mode control in Phase 1.
- Existing role/permission management remains unchanged unless explicitly extended.

## Backward Compatibility
- Existing user role endpoints remain valid.
- New fields are additive and nullable initially.
- Existing UI paths continue to function if hierarchy fields are absent.

## Error Handling
- Reject invalid manager assignments with clear cause.
- Reject team mode switch if unresolved validation errors exist.
- Return consistent error schema for UI rendering.

## Telemetry and Audit
- Track changes to user team and manager assignments.
- Track team mode changes with actor and timestamp.
- Track blocked mode changes and reason code.

## Go / No-Go Criteria
- Go when:
  - UX states and edge cases are approved by product.
  - API additions are documented and backward compatible.
  - Validation behavior is aligned with migration runbook.
- No-Go when:
  - Any admin flow allows invalid hierarchy mapping.
  - Team mode changes are possible without required prechecks.
