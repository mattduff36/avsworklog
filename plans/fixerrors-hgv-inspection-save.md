# Fixerrors cluster-1: HGV inspection item persistence

Workstream: `ws_97e5d1d19f914a8d`  
Snapshot: `97e5d1d1-9f91-4a8d-a0a7-95d69d9dd45e`  
Decision: `docs_private/error-analysis-decision.md` cluster-1  
Architecture: first pass `blocked` ([Architecture](6b0953ca-3e59-4957-8809-e4dc1ba76c80)); second pass `approved_with_conditions` ([Architecture](d44f618f-a2e4-4af3-b271-9e507b0cf9be)); closure amendment `approved_with_conditions` ([Architecture](31907c69-7cec-4662-a9c8-a2654e30596d)).

## Classification

- Lane: CRITICAL
- Risk: high
- Why: persistence, authorization, and a transactional RPC for `hgv_inspections` / `inspection_items`. Production `42501` after Save Signature, plus stale-draft `Draft not found`.
- Task type: change. Independent of report-only cluster-3 and manual-investigation cluster-2.

## Recommended build model

- Implementation stays on the economical Cursor Grok parent after the architecture gate.
- Mandatory premium gates: architecture-gate and final-diff-reviewer.

## Architecture gate

- Closure amendment reviewed before implementation: fail closed before lookups, sanitize hints in TypeScript and SQL, uniform save-route 403s, unique incoming item keys, collapse extras with `ROW_NUMBER() OVER (... ORDER BY id)`, repoint `actions.inspection_item_id` to the keeper, new forward migration only.

## Implementation contract

Canonical neighbour: `app/api/hgv-inspections/[id]/discard/route.ts` plus existing `SECURITY DEFINER` RPCs granted to `service_role` only.

### Route and authz

1. Add `lib/server/hgv-inspection-save.ts` plus `POST /api/hgv-inspections/save`.
2. Authorize with `getInspectionRouteActorAccess('hgv-inspections')`. Fail 401/403 closed. Do not rewrite that helper. Workshop managers can already receive `canManageOthers` (`is_manager_admin` and workshop team, or full-access role).
3. Zod-validate a closed body. Reject unknown fields and any client-supplied authority (`role`, `canManageOthers`, `access_level`, actor id).
4. Subject `user_id` is the inspection owner, not write authority. Authorize the requested subject **before** creating or querying the admin client. Then authorize the existing row owner after a sanitized lookup.
5. Server derives `inspection_id` from `(hgv_id, subject user_id, inspection_date)`. A client id is a hint only. Non-managers look up hints with `id` and `user_id = actor` so unauthorized rows never enter TypeScript. Managers may load another owner's draft hint. Never return an unauthorized hint row; pass the sanitized hint (or null) to the RPC, never the raw client hint. The RPC independently treats unauthorized hints as absent.
6. Uniform 403 body `Forbidden: cannot save this inspection` for every save-route write-authorization failure, including module-access 403s and caught exceptions.

### Transactional RPC

6. Forward migration `supabase/migrations/20260828_hgv_inspection_save_rpc.sql` already applied. Corrective forward migration `supabase/migrations/20260901_hgv_inspection_save_rpc_itemset.sql` (`finalise-phase: predeploy`) `CREATE OR REPLACE`s `public.save_hgv_inspection(...)`. Same signature. `GRANT EXECUTE` to `service_role` only. No RLS policy change. No table `UNIQUE` constraint. Do not edit the applied 20260828 file.
7. RPC locks the resolved parent with `SELECT ... FOR UPDATE` (insert-then-lock on create; unique-key `23505` retries as lock-existing). After the lock, revalidate the locked owner against the server-supplied `expected_owner` and actor authorization (close the ownership TOCTOU). Parent, item replacement, submit fields, and mileage are one transaction.
8. Item replacement: reject duplicate incoming `(item_number, day_of_week)` keys (`HGV_SAVE:INVALID_ITEM`). Insert/upsert the new set, then delete rows whose key is not in incoming. Collapse remaining extras with `ROW_NUMBER() OVER (PARTITION BY item_number, day_of_week ORDER BY id)` and keep `rn = 1`. Repoint `actions.inspection_item_id` to the keeper before deleting extras. Never delete existing items before replacement succeeds.
9. Concurrency: a draft save against a submitted row aborts (409). A submit that wins the lock writes one complete submitted item set. Concurrent draft+submit must not mix item sets or revert a submitted row to draft.
10. Apply `submitted` / signature / HGV mileage only in the same RPC after items succeed.
11. Route calls the RPC only through the admin client after authz. Keep `/api/hgv-inspections/sync-defect-tasks` as a post-submit client call.
12. DB harness reads the 20260901 forward migration.

### Page

12. `mergeIntoExistingDraft`, `ensureDraftSaved`, and `saveInspection` call the new API. Remove browser `inspection_items` insert/delete from those write paths. Keep browser reads.

### Production apply

13. Land the SQL file only. Do not apply it to production in this task. Application stays on `npm run finalise` after separate authorization (`/ffap` for this closure).

## Boundaries

- No RLS, grant-to-authenticated, or production-data change.
- Do not suppress or relabel PostgreSQL `42501` as success.
- Do not rewrite `getInspectionRouteActorAccess`.
- Do not migrate plant/van save paths.
- Do not add a table UNIQUE constraint on inspection item keys.
- Do not edit `20260828_hgv_inspection_save_rpc.sql`.

## Rollback

- Forward `CREATE OR REPLACE` migration to restore or replace the RPC. Revert the route/helper/page. Do not restore browser delete-then-insert.

## Required tests

| ID | Check |
| --- | --- |
| HGV-SAVE-COORD-01 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "HGV-SAVE-COORD-01"` |
| HGV-SAVE-COORD-02 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "HGV-SAVE-COORD-02"` |
| HGV-SAVE-AUTH-01 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "HGV-SAVE-AUTH-01"` |
| HGV-SAVE-AUTH-LEAK-01 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "HGV-SAVE-AUTH-LEAK-01"` |
| HGV-SAVE-ITEMSET-01 | `npx vitest run tests/unit/hgv-inspection-save-coordination.test.ts -t "HGV-SAVE-ITEMSET-01"` |
| HGV-SAVE-CONC-01 | Disposable PostgreSQL: `npm run test:db:local:hgv-save` |

## Unresolved risks

- HGV-SAVE-RISK-01: Corrective RPC is unusable in production until the 20260901 migration is applied via authorized finalise.
- HGV-SAVE-RISK-02: Local PostgreSQL proves function locking, not live PostgREST/session races.
- HGV-SAVE-LEGACY-DUP-01: Submitted or otherwise untouched historical inspections may retain duplicates; this sweep only guarantees post-replacement uniqueness.

## Commit and handoff

- Local commit after verification and the mandated final-diff review. Do not push. Do not apply the migration.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_97e5d1d19f914a8d_hintfilter",
  "sourceWorkstreamIds": ["ws_97e5d1d19f914a8d"],
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
    { "id": "HGV-SAVE-AUTH-LEAK-01", "status": "completed" },
    { "id": "HGV-SAVE-ITEMSET-01", "status": "completed" },
    { "id": "HGV-SAVE-CONC-01", "status": "completed" }
  ],
  "unresolvedRisks": [
    { "id": "HGV-SAVE-RISK-01", "note": "Corrective RPC is unusable in production until authorized finalise applies 20260901." },
    { "id": "HGV-SAVE-RISK-02", "note": "Local PostgreSQL does not prove live PostgREST races." },
    { "id": "HGV-SAVE-LEGACY-DUP-01", "note": "Historical inspections may retain duplicates until a later replacement save." }
  ],
  "implementationContract": {
    "invariants": [
      "Route authorization precedes the service-role RPC.",
      "Unauthorized subject fails closed before admin lookup.",
      "Sanitized hint is passed to the RPC; unauthorized hints are treated as absent in TypeScript and SQL.",
      "Every save-route 403 uses one shared forbidden body.",
      "Incoming item keys are unique; replacement then collapse leaves one row per key and repoints actions.",
      "No RLS widening; EXECUTE granted to service_role only."
    ],
    "boundaries": [
      "Do not change RLS or grant the RPC to authenticated/anon.",
      "Do not apply the migration to production in this task.",
      "Do not add a table UNIQUE constraint.",
      "Do not edit 20260828_hgv_inspection_save_rpc.sql.",
      "Do not migrate plant/van save paths.",
      "Do not rewrite getInspectionRouteActorAccess."
    ],
    "rollback": "Forward CREATE OR REPLACE migration. Revert route/helper/page. Do not restore browser delete-then-insert."
  },
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1"
}
-->
