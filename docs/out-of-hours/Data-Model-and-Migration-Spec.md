# Data Model and Migration Spec

## Document Control
- Owner: Technical Architect
- Contributors: Engineering Lead, DBA, Product Owner
- Status: Draft for review
- Risk level: High
- Implementation window: OutOfHours
- Primary dependencies: `Org-Hierarchy-v2-Architecture.md`, `Pilot-and-Wave-Cutover-Runbook.md`

## Objective
Define the additive data model and migration strategy required to support line-manager hierarchy and per-team migration toggles with minimal service interruption.

## Scope
- In scope:
  - Additive schema design for org hierarchy.
  - Data migration and backfill strategy.
  - Rollback and validation constraints.
- Out of scope:
  - SQL implementation scripts (covered by execution phase).
  - Non-absence workflow data enforcement details.

## Proposed Additive Entities

## 1) Team Structure
- `org_teams`
  - `id` (uuid, pk)
  - `name` (text, unique per scope)
  - `code` (text, optional, unique)
  - `active` (boolean, default true)
  - `created_at`, `updated_at`

## 2) Team Membership
- `profile_team_memberships`
  - `id` (uuid, pk)
  - `profile_id` (uuid, fk -> `profiles.id`)
  - `team_id` (uuid, fk -> `org_teams.id`)
  - `is_primary` (boolean, default true)
  - `valid_from`, `valid_to` (timestamp, nullable for active row)
  - `created_at`, `updated_at`

## 3) Reporting Line
- `profile_reporting_lines`
  - `id` (uuid, pk)
  - `profile_id` (uuid, fk -> `profiles.id`)        # subordinate
  - `manager_profile_id` (uuid, fk -> `profiles.id`) # manager
  - `relation_type` (text: `line_manager` for Phase 1)
  - `valid_from`, `valid_to`
  - `created_at`, `updated_at`

## 4) Team Migration Toggle
- `org_team_feature_modes`
  - `id` (uuid, pk)
  - `team_id` (uuid, fk -> `org_teams.id`)
  - `workflow_name` (text, Phase 1 value: `absence_leave`)
  - `mode` (text: `legacy` | `org_v2`)
  - `effective_from` (timestamp)
  - `updated_by` (uuid, fk -> `profiles.id`)
  - `created_at`, `updated_at`

## 5) Optional Audit Table (Recommended)
- `org_hierarchy_change_log`
  - `id` (uuid, pk)
  - `change_type` (text)
  - `entity_name` (text)
  - `entity_id` (uuid)
  - `before_json`, `after_json` (jsonb)
  - `changed_by` (uuid)
  - `changed_at` (timestamp)

## Data Rules and Constraints
- A profile cannot report to itself.
- Reporting line must reference active profiles.
- Prevent direct manager cycles at write time.
- Exactly one active primary team membership per profile.
- Team mode must have one active row per `(team_id, workflow_name)`.
- Default mode for new team workflow rows: `legacy`.

## Compatibility Strategy
- Keep current role and permission tables unchanged.
- Do not remove or rename existing columns in Phase 1.
- New entities are read by new logic only when team mode is `org_v2`.
- Legacy behavior remains default until explicit team switch.

## Backfill Strategy

## Source Mapping Inputs
- Organogram approved by business stakeholders.
- Existing users and known department ownership.
- Existing manager/admin role ownership as fallback reference only.

## Backfill Sequence
1. Create teams.
2. Create primary team membership for each active profile.
3. Create reporting lines for each profile.
4. Initialize team workflow mode as `legacy`.
5. Validate integrity and exceptions.

## Validation Checks
- No missing team assignment for active profiles.
- No missing line manager for users that require approvers.
- No reporting cycles.
- No duplicate active primary team memberships.
- Team mode row exists for each pilot team workflow.

## Rollback Strategy
- Keep all new tables additive and non-destructive.
- If pilot fails, set affected team mode back to `legacy`.
- Preserve migrated rows; do not delete historical mapping data.
- If data quality is invalid, block team cutover and remediate mappings.

## Out-of-Hours Execution Boundaries
- Execute production DDL and constraints only out of hours.
- Execute production backfill writes only out of hours.
- Validation reports can be prepared during business hours.

## Go / No-Go Criteria
- Go when:
  - Data mapping sheet approved by product and operations.
  - Validation queries pass for pilot team.
  - Rollback toggles and runbook are approved.
- No-Go when:
  - Any manager cycle or missing approver remains unresolved.
  - Team membership or mode integrity checks fail.
