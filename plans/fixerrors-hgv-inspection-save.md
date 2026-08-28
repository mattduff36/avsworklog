# Fixerrors cluster-1: HGV inspection item persistence

Workstream: `ws_97e5d1d19f914a8d`  
Snapshot: `97e5d1d1-9f91-4a8d-a0a7-95d69d9dd45e`  
Decision: `docs_private/error-analysis-decision.md` cluster-1  
Architecture: first pass `blocked` ([Architecture](6b0953ca-3e59-4957-8809-e4dc1ba76c80)); second pass `approved_with_conditions` ([Architecture](d44f618f-a2e4-4af3-b271-9e507b0cf9be)).

## Classification

- Lane: CRITICAL
- Risk: high
- Why: persistence, authorization, and a transactional RPC for `hgv_inspections` / `inspection_items`. Production `42501` after Save Signature, plus stale-draft `Draft not found`.
- Task type: change. Independent of report-only cluster-3 and manual-investigation cluster-2.

## Recommended build model

- Implementation stays on the economical Cursor Grok parent after the architecture gate.
- Mandatory premium gates: architecture-gate and final-diff-reviewer.

## Architecture gate

- Re-review this revised contract before implementation.
- First pass required a row-serialized RPC, dual-owner authz, server-derived identity, and concurrency coverage.

## Implementation contract

Canonical neighbour: `app/api/hgv-inspections/[id]/discard/route.ts` plus existing `SECURITY DEFINER` RPCs granted to `service_role` only.

### Route and authz

1. Add `lib/server/hgv-inspection-save.ts` plus `POST /api/hgv-inspections/save`.
2. Authorize with `getInspectionRouteActorAccess('hgv-inspections')`. Fail 401/403 closed. Do not rewrite that helper. Workshop managers can already receive `canManageOthers` (`is_manager_admin` and workshop team, or full-access role).
3. Zod-validate a closed body. Reject unknown fields and any client-supplied authority (`role`, `canManageOthers`, `access_level`, actor id).
4. Subject `user_id` is the inspection owner, not write authority. Before mutation, authorize **both** the existing row owner (if a row is resolved) **and** the requested subject: each must be the actor or `canManageOthers`.
5. Server derives `inspection_id` from `(hgv_id, subject user_id, inspection_date)`. A client id is a hint only: use it to recover a row whose key changed (HGV/date/subject) or to detect a missing stale id. Never write items to a missing id.

### Transactional RPC

6. Forward migration `supabase/migrations/20260828_hgv_inspection_save_rpc.sql` (`finalise-phase: predeploy`): `public.save_hgv_inspection(...)` `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `GRANT EXECUTE` to `service_role` only. No RLS policy change. No grant to `authenticated` or `anon`.
7. RPC locks the resolved parent with `SELECT ... FOR UPDATE` (insert-then-lock on create; unique-key `23505` retries as lock-existing). After the lock, revalidate the locked owner against the server-supplied `expected_owner` and actor authorization (close the ownership TOCTOU). Parent, item replacement, submit fields, and `hgvs.current_mileage` are one transaction.
8. Item replacement: insert/upsert the new set, then delete rows not in that set. Never delete existing items before replacement succeeds.
9. Concurrency: a draft save against a submitted row aborts (409). A submit that wins the lock writes one complete submitted item set. Concurrent draft+submit must not mix item sets or revert a submitted row to draft.
10. Apply `submitted` / signature / HGV mileage only in the same RPC after items succeed.
11. Route calls the RPC only through the admin client after authz. Keep `/api/hgv-inspections/sync-defect-tasks` as a post-submit client call.

### Page

12. `mergeIntoExistingDraft`, `ensureDraftSaved`, and `saveInspection` call the new API. Remove browser `inspection_items` insert/delete from those write paths. Keep browser reads.

### Production apply

13. Land the SQL file only. Do not apply it to production in this task. Application stays on `npm run finalise` after separate authorization.

## Boundaries

- No RLS, grant-to-authenticated, or production-data change.
- Do not suppress or relabel PostgreSQL `42501` as success.
- Do not rewrite `getInspectionRouteActorAccess`.
- Do not migrate plant/van save paths.
- Do not implement cluster-2 or cluster-3.

## Rollback

- Drop/replace the RPC with a forward corrective migration if needed. Revert the route/helper/page. Do not restore browser delete-then-insert.

## Required tests

| ID | Check |
| --- | --- |
| HGV-SAVE-COORD-01 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "does not delete existing items when replacement fails"` |
| HGV-SAVE-COORD-02 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "recovers a stale draft id without writing items to a missing draft"` |
| HGV-SAVE-AUTH-01 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "uses the authenticated save boundary for inspection items"` — unauthenticated, own-user, forbidden cross-user, and permitted manager |
| HGV-SAVE-CONC-01 | Disposable PostgreSQL, two sessions: concurrent draft and submit leave exactly one complete submitted item set. Command: `npm run test:db:local:hgv-save` |

## Unresolved risks

- HGV-SAVE-RISK-01: RPC is unusable in production until the migration is applied via authorized finalise.
- HGV-SAVE-RISK-02: PGlite concurrency proves function locking, not live PostgREST/session races.

## Commit and handoff

- Local commit after verification and the mandated final-diff review. Do not push. Do not apply the migration.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_97e5d1d19f914a8d",
  "sourceWorkstreamIds": [],
  "taskId": "fixerrors-hgv-inspection-save",
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
    "rationale": "Privileged HGV inspection persistence via a service-role RPC after production 42501 and stale-draft miss.",
    "fallbackEscalation": "Stop if review requires RLS widening, grant to authenticated/anon, or plant/van migration."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "inspection-item-persistence",
    "transactional-save-rpc",
    "no-rls-widening"
  ],
  "requiredTests": [
    { "id": "HGV-SAVE-COORD-01", "status": "completed" },
    { "id": "HGV-SAVE-COORD-02", "status": "completed" },
    { "id": "HGV-SAVE-AUTH-01", "status": "completed" },
    { "id": "HGV-SAVE-CONC-01", "status": "completed" }
  ],
  "unresolvedRisks": [
    { "id": "HGV-SAVE-RISK-01", "note": "RPC is unusable in production until authorized finalise applies the migration." },
    { "id": "HGV-SAVE-RISK-02", "note": "PGlite concurrency proves function locking, not live PostgREST races." }
  ],
  "implementationContract": {
    "invariants": [
      "Route authorization precedes the service-role RPC.",
      "Server derives inspection_id; client id is a hint only.",
      "Existing owner and requested subject are both authorized before mutation.",
      "Parent lock, post-lock owner revalidation, item replacement, submit fields, and mileage are one transaction.",
      "Existing items are never deleted before replacement insert/upsert succeeds.",
      "No RLS widening; EXECUTE granted to service_role only."
    ],
    "boundaries": [
      "Do not change RLS or grant the RPC to authenticated/anon.",
      "Do not apply the migration to production in this task.",
      "Do not migrate plant/van save paths.",
      "Do not implement cluster-2 or cluster-3.",
      "Do not rewrite getInspectionRouteActorAccess."
    ],
    "rollback": "Forward corrective migration to drop/replace the RPC. Revert route/helper/page. Do not restore browser delete-then-insert."
  },
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1"
}
-->
