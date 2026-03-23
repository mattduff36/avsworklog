# RLS and Authorization Spec

## Document Control
- Owner: DBA and Security Lead
- Contributors: Engineering Lead, Technical Architect
- Status: Draft for review
- Risk level: High
- Implementation window: OutOfHours
- Primary dependencies: `Data-Model-and-Migration-Spec.md`, `Absence-Leave-Workflow-Spec-v2.md`

## Objective
Define the phased database authorization model that enables legacy and org-hierarchy v2 to run in parallel, with safe rollback for each migration wave.

## Scope
- In scope:
  - Function and policy sequencing for dual-mode checks.
  - Absence and leave workflow enforcement in Phase 1.
  - Admin-only cross-team override rules.
- Out of scope:
  - UI gating behavior (documented separately).

## Security Principles
- Enforce authorization at data boundary, not only in application logic.
- Use additive policy rollout before restrictive cleanup.
- Keep migration reversible by team mode changes.
- Ensure no non-admin cross-team bypass during org_v2 mode.

## Dual-Mode Authorization Contract
- Inputs:
  - actor profile id
  - requester profile id
  - workflow name (`absence_leave`)
  - requester team mode (`legacy` or `org_v2`)
- Output:
  - allow view/action or deny

## Compatibility Function Set (Planned)
- `effective_team_mode(requester_profile_id, workflow_name)` -> `legacy | org_v2`
- `is_actor_admin(actor_profile_id)` -> boolean
- `is_actor_line_manager_of(actor_profile_id, requester_profile_id)` -> boolean
- `can_actor_access_absence_request(actor_profile_id, requester_profile_id)` -> boolean
- `can_actor_approve_absence_request(actor_profile_id, requester_profile_id)` -> boolean

## Policy Rollout Sequence (Additive First)
1. Deploy helper functions without changing existing behavior.
2. Add parallel policies that support org_v2 checks for migrated teams.
3. Keep legacy policy branch for non-migrated teams.
4. Validate authorization matrix in pilot.
5. After full migration stability, remove redundant legacy branches.

## Phase 1 Policy Intention (Absence and Leave)
- Legacy team:
  - Existing policy behavior remains active.
- Org_v2 team:
  - Admin: allow.
  - Manager (non-admin): allow only if line-manager relation is valid.
  - Others: deny.

## Conflict Handling
- If multiple policies match, result must still obey least privilege intent.
- Avoid broad `manager-global` checks for org_v2 teams.
- Deny on ambiguous team mode or missing manager relation.

## Rollback Design
- Immediate rollback action: switch affected team workflow mode to `legacy`.
- Keep org_v2 functions and policies deployed but inactive for legacy teams.
- If policy regression is detected:
  - halt wave,
  - revert team mode,
  - capture diagnostics,
  - remediate before retry.

## Verification Queries (Pre/Post Cutover)
- Validate active mode per pilot team.
- Validate manager mappings for requester population.
- Validate sample actor/requester decisions against expected matrix.
- Validate no non-admin cross-team approval success paths.

## Audit Requirements
- Log each mode change with actor and timestamp.
- Capture denied approval attempts for diagnostics.
- Capture policy version deployed for each wave window.

## Change Safety
- No destructive table or column removals in Phase 1.
- Apply function updates before policy references.
- Use out-of-hours windows for policy changes in production.

## Go / No-Go Criteria
- Go when:
  - Function set deployed and validated in staging.
  - Pilot matrix tests pass for all actor types.
  - Rollback switch tested and confirmed.
- No-Go when:
  - Any unresolved policy path allows cross-team non-admin approvals.
  - Authorization outcomes differ between server and database checks.
