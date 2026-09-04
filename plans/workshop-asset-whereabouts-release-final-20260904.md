# Workshop task asset whereabouts (final independent recovery)

CRITICAL plan for a workshop-gated asset whereabouts preview on `/workshop-tasks`.

This is the one final genuinely independent recovery successor authorised by the operator. It is not a split child of `ws_39fa6357c1b1c3a7` or `ws_d347e25bb2aae3ab`.

Baseline: successor branch `feature/workshop-location-release-final-20260904` @ `3b00606a97eb81d81fda103a3ea58e5b12cae8b0` (`origin/main` after the tooling release).
Workstream: `ws_5971543ac3b23cf3` — new lineage. `failedPremiumReviewCount = 0`. `inheritedFailedReviewCount = 0`.

Exhausted predecessors `ws_39fa6357c1b1c3a7` and `ws_d347e25bb2aae3ab` are audit/re-home provenance only. Both failed first and failed closure. They are not claimed as passed. Old review tokens are not authority for this successor.

Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

## Classification

- Lane: CRITICAL.
- Risk: high.
- Reason: new privileged read API. Workshop staff will see Daily Allocation published job/site/customer data (today manager-gated) and inspector phone numbers (PII), via the admin client after a `workshop-tasks` server check.
- Task type: change.
- Workstream: `ws_5971543ac3b23cf3`.
- routingDecision: economical_default.
- Parent: current economical parent. Stay Agent until the architecture gate is approved, then implement on the same economical default.
- No schema, migration, Daily Allocation write path, or tracker matching change.
- No `sourceWorkstreamIds`. Provenance is `rehomeProvenance` only.

## Recommended build model

- Implementation: economical Cursor Grok default after the architecture gate.
- Family: cursor-grok.
- Mandatory premium gates: architecture-gate before implementation; premium final-diff after frozen-candidate verification.
- Switch timing: not applicable; parent is already economical.
- Execution mode: Agent. One read-API plus modal; no parallel implementation streams until the architecture gate is approved.
- Fallback: stop and report if the gate rejects the authz/PII/allocation-read contract, or if implementation would need schema, Daily Allocation writes, or a new permission module.

## Architecture gate

- Status: approved_with_conditions by independent architecture-gate confirmation against the already-approved design from `d242fe87-df7d-4580-a162-5bed92aa147c`. Scope has not changed.
- Source: independent_subagent.
- Locked conditions:
  - Authenticate with the app session, then require effective `workshop-tasks` access. Return 401/403 before any privileged domain read. Validate `assetType` and UUID `assetId`.
  - Create/use the admin client only after authorization. Select explicit columns—never `*`, tracker IDs, DVLA/raw data, notes, or quote commercial fields.
  - The 14-day range is trailing Europe/London civil dates: today plus the preceding 13 days.
  - Select publication headers first, then maximum revision per `(work_date, scope_team_id)`. Treat null team as one legacy scope, not publication ID. Read only v1/v2 published snapshot tables.
  - Plant alone receives allocation events. Snapshot values are authoritative; catalogue data may only fill missing customer/title/site. Prefer exact `job_source_type` plus `job_source_id`; ambiguous code-only matches must produce no enrichment rather than selecting an arbitrary catalogue. Do not use `loadJobCatalogueRecords`.
  - Submitted inspections only, newest-first, maximum 10. Read names for all inspectors, but query `phone_number` separately for only the newest inspector.
  - Response is `Cache-Control: private, no-store`, with no payload/phone logging.
  - The new route must never call telematics. Map failure must leave the timeline usable.
  - Do not reuse current map all-locations warmup. Workshop dialog may call only the selected-asset location endpoint and must ignore speed. Do not open `AssetLocationMapModal`.
  - Single-asset FleetSmart/Velocityfleet endpoints must enforce effective-module authorization permitting workshop, fleet (`admin-vans`), or maintenance access.
  - `canOpenFleetHistory` is View-As-aware `admin-vans` UX only. Hide the link while loading or denied.
  - Fetch whereabouts only when opening the dialog; cancel/ignore stale responses when switching assets. Every card Location action must stop propagation.
  - A real mounted `AssetLocationMap` (or the closest real rendered path that owns the fetch lifecycle) must prove that switching from asset A to asset B aborts or invalidates request A so a late A response cannot populate B's map. Cleanup/unmount must not leak stale mutation.
  - `WorkshopTasksAccess` and `SingleAssetTrackerAccess` always include `validation`. Access mocks must supply that object. `applyValidationCookieIfNeeded` receives a real `AppSessionValidationResult`.
- Re-plan only if this architecture/scope materially changes.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.

## Implementation contract

### Invariants

- Workshop-tasks permission is the only module gate for this read.
- Unpublished / superseded allocation never appears.
- Van/HGV events never invent job/site.
- Phone is only the latest inspector’s `profiles.phone_number`.
- Admin client is server-only and only after 401/403 checks.
- Card Location click does not open the task modal.
- Selected-asset tracker fetches abort or invalidate when the selected asset changes; a stale response cannot update the new asset's map.
- Access helpers always return `validation`; routes pass that object to `applyValidationCookieIfNeeded`.
- Changed integration and UI tests must actually execute on the frozen candidate.
- No migration, no Daily Allocation write path, no tracker_id matching change (lookup stays plant number / VRN).
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass. A split child inherits the lineage-scoped budget and must not re-enter `initialized` / preflight to mint a new `first` review.

### Boundaries

- In scope: workshop-gated whereabouts loader and GET route; Location button under card actions and on the task modal; compact dialog with map + newest-first timeline; selected-asset tracker abort proof; access-result fixture repair; targeted unit, integration, and UI tests.
- Out of scope: Daily Allocation draft/board UI; new permission module; quote commercial fields beyond customer name, title, site; production data changes; tracker speed; TEE redesign, preflight redesign, or new verification frameworks. The existing changed-files ledger may include changed integration/UI tests so those files are proven executed.
- No deploy. Fast-forward push to origin/main is authorised after legal review PASS and mutating full finalise.

### Rollback

- Revert the successor feature commit on this isolated branch. No schema to undo. Existing tracker and allocation APIs stay unchanged.

## Required tests

Stable IDs:

1. `WT-WHERE-401` — unauthenticated → 401
2. `WT-WHERE-403` — authenticated without workshop-tasks → 403
3. `WT-WHERE-404` — unknown asset → 404
4. `WT-WHERE-PLANT-ORDER` — plant payload merges allocation + inspection and sorts `occurredAt` desc
5. `WT-WHERE-VAN-NO-ALLOC` — van/HGV has no allocation events
6. `WT-WHERE-DRAFT-HIDDEN` — draft / non-latest publication excluded
7. `WT-WHERE-PHONE` — latest inspector phone present; older inspection events have no phone
8. `WT-WHERE-CATALOGUE` — job code enriched with customer/title/site when catalogue has it
9. `WT-WHERE-UI-STOP` — Location click does not call `onOpenTaskModal`
10. `WT-WHERE-VIEW-AS` — View As grants and denials follow the effective role
11. `WT-WHERE-WINDOW` — only the trailing 14 Europe/London work dates are read
12. `WT-WHERE-DATA-MIN` — response and queries exclude tracker, raw vehicle, older-phone, and commercial fields
13. `WT-WHERE-TRACKER-AUTH` — selected-asset tracker endpoints enforce effective module authorization
14. `WT-WHERE-TRACKER-INDEPENDENT` — whereabouts succeeds without telematics and never requests all-locations
15. `WT-WHERE-UI-LAZY-FLEET` — fetch occurs only on open and fleet link follows View-As-aware admin-vans access
16. `WT-WHERE-TRACKER-STALE` — mounted `AssetLocationMap` aborts or invalidates asset A’s in-flight tracker fetch when selection switches to asset B; stale A cannot render on B; B’s legitimate result is allowed; unmount does not leak stale mutation
17. `WL-TEST-001` — access mocks/fixtures include the real `validation` object; `applyValidationCookieIfNeeded` is not called with a missing result
18. `T-EXISTING-WORKFLOW-TESTS` — canonical workflow suite executes
19. `T-TYPECHECK` — typecheck
20. `T-LINT` — lint

## Final review

- Independent premium final-diff after every required ID is completed or explicitly unresolved.
- Reviewer starts from a compact packet and may inspect any relevant file. Packet green is not a pass.
- Bounded `two-pass-v1`: first review; at most one consolidated blocker-family fix; one closure review.
- Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.
- After two failed premium rounds the lineage is `routing_required`. That state is terminal for the normal review loop and is not `finalised`, `review_closed`, or `finalise_ready`.
- Immediately before premium final-diff, run one bounded economical adversarial challenge (one challenge, one consolidated repair if needed, one re-check). The challenge is not premium review, not approval, and does not consume or reset the two-pass budget. Challenge repair does not consume the premium fix or `closure` slot. `premium-readiness` ready is not `review_closed` and not `finalise_ready`.
- Supply a compact `premium-review-packet` as starting evidence. Do not dump the parent conversation, full rules corpus, or unrelated docs.
- If `first` passes, do not run closure. If `first` fails and closure is legal, generate a NEW closure packet against the current closure candidate. Do not reuse the first packet.
- The reviewer may inspect any relevant evidence beyond the packet. The packet and `premium-readiness` are not authority.

## Commit and handoff

- Commit: pending until implementation is finished; then local commit (`feat(workshop-tasks): …`).
- Handoff: pending.
- Finalise: mutating full finalise after legal review PASS, then fast-forward push to origin/main. No deploy.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_5971543ac3b23cf3",
  "taskId": "workshop-asset-whereabouts-release-final-20260904",
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
    "rationale": "Current parent is already economical. Implementation is mechanical after the architecture gate confirms the already-approved workshop-gated allocation/PII read contract.",
    "fallbackEscalation": "Stop and report if the architecture gate rejects the authz, PII, or allocation-read contract, or if implementation would need schema, Daily Allocation writes, or a new permission module."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "privileged-allocation-read",
    "inspector-phone-pii",
    "selected-asset-tracker-stale-fetch"
  ],
  "requiredTests": [
    { "id": "WT-WHERE-401", "status": "unresolved" },
    { "id": "WT-WHERE-403", "status": "unresolved" },
    { "id": "WT-WHERE-404", "status": "unresolved" },
    { "id": "WT-WHERE-PLANT-ORDER", "status": "unresolved" },
    { "id": "WT-WHERE-VAN-NO-ALLOC", "status": "unresolved" },
    { "id": "WT-WHERE-DRAFT-HIDDEN", "status": "unresolved" },
    { "id": "WT-WHERE-PHONE", "status": "unresolved" },
    { "id": "WT-WHERE-CATALOGUE", "status": "unresolved" },
    { "id": "WT-WHERE-UI-STOP", "status": "unresolved" },
    { "id": "WT-WHERE-VIEW-AS", "status": "unresolved" },
    { "id": "WT-WHERE-WINDOW", "status": "unresolved" },
    { "id": "WT-WHERE-DATA-MIN", "status": "unresolved" },
    { "id": "WT-WHERE-TRACKER-AUTH", "status": "unresolved" },
    { "id": "WT-WHERE-TRACKER-INDEPENDENT", "status": "unresolved" },
    { "id": "WT-WHERE-UI-LAZY-FLEET", "status": "unresolved" },
    { "id": "WT-WHERE-TRACKER-STALE", "status": "unresolved" },
    { "id": "WL-TEST-001", "status": "unresolved" },
    { "id": "T-EXISTING-WORKFLOW-TESTS", "status": "unresolved" },
    { "id": "T-TYPECHECK", "status": "unresolved" },
    { "id": "T-LINT", "status": "unresolved" }
  ],
  "unresolvedRisks": [
    {
      "id": "new-workshop-allocation-surface",
      "note": "Workshop users intentionally receive limited published job/customer/site information."
    },
    {
      "id": "tracker-match-gaps",
      "note": "Some assets lack a tracker match; timeline data remains available."
    },
    {
      "id": "fleet-history-permission",
      "note": "Link visibility is UX; fleet routes retain their own authorization responsibility."
    },
    {
      "id": "legacy-all-locations-authz",
      "note": "Existing broad all-location endpoint authorization is separate, provided this feature never calls it."
    }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "reviewClosureProtocol": "two-pass-v1",
  "implementationContract": {
    "invariants": [
      "Workshop-tasks permission is the only module gate for this read.",
      "Unpublished or superseded allocation never appears.",
      "Van and HGV events never invent job or site.",
      "Phone is only the latest inspector profiles.phone_number.",
      "Admin client is server-only and only after 401/403 checks.",
      "Card Location click does not open the task modal.",
      "Selected-asset tracker fetches abort or invalidate when the selected asset changes; a stale response cannot update the new asset map.",
      "Access helpers always return validation; routes pass that object to applyValidationCookieIfNeeded.",
      "Changed integration and UI tests must actually execute on the frozen candidate.",
      "No migration, Daily Allocation write path, or tracker_id matching change.",
      "Do not launch a third premium review for the same CRITICAL continuation. Routing or split does not reset this budget.",
      "The active descendant owns remaining work. After two failed premium rounds, remaining work is routing, isolation, or proven removal from release — not another normal final-diff pass."
    ],
    "boundaries": [
      "Only the workshop-gated whereabouts read API, Location button, compact dialog, selected-asset tracker abort proof, access-result fixture repair, and targeted tests.",
      "No Daily Allocation draft or board UI.",
      "No new permission module.",
      "No quote commercial fields beyond customer name, title, and site.",
      "No production data changes.",
      "No TEE redesign, preflight redesign, or new verification frameworks. The existing changed-files ledger may include changed integration and UI tests."
    ],
    "rollback": "Revert the successor feature commit on this isolated branch. No schema to undo. Existing tracker and allocation APIs stay unchanged."
  },
  "rehomeProvenance": {
    "schemaVersion": "1",
    "status": "declared",
    "predecessorRootWorkstreamId": "ws_39fa6357c1b1c3a7",
    "predecessorDescendantWorkstreamId": "ws_d347e25bb2aae3ab",
    "predecessorHeadCommit": "c7013307b67180ef29a59a9088e8cc3ce0691f80",
    "predecessorReleaseContext": "D:/Websites/avsworklog-workshop-location-release#feature/workshop-location-final-20260904",
    "successorBranchName": "feature/workshop-location-release-final-20260904",
    "successorBaselineCommit": "3b00606a97eb81d81fda103a3ea58e5b12cae8b0",
    "sourcePatchSha256": "82d257a14fac9518d94be52173440b6d7b8a80a4b25bc9d3a2080cf2a3ce25fd",
    "sourceProductTreeFingerprint": "bc1939e09f96fa9993aea968fe22ffc74172ddac5ac4be81f589c20cbb1fb2ec",
    "sourceReleaseContext": "D:/Websites/avsworklog-workshop-location-release#feature/workshop-location-final-20260904",
    "sourceHeadCommit": "c7013307b67180ef29a59a9088e8cc3ce0691f80",
    "sourceBaselineCommit": "3b00606a97eb81d81fda103a3ea58e5b12cae8b0",
    "sourceReviewWorkstreamId": "ws_d347e25bb2aae3ab",
    "predecessorHeadIsAncestor": false,
    "predecessorPassedReview": false
  }
}
-->
