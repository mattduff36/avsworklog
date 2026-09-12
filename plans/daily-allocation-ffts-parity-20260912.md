# Daily Allocation FFTS parity

This repository contract binds workstream `ws_7e5a9c14d2f63b80` to the approved
Cursor plan at
`C:/Users/mattd/.cursor/plans/daily_allocation_ffts_parity_e21f5341.plan.md`.
It records the independent architecture conditions without modifying that plan.

## Classification

- Lane: CRITICAL under TEE-FULL.
- Risk: high.
- Reason: scheduling persistence, concurrency, immutable publication behavior,
  legacy-draft conversion, permissions, production migration, and activation.
- Workstream: `ws_7e5a9c14d2f63b80`.

## Recommended build model

- GPT-5.6 Sol owns implementation, integration, deterministic evidence, and
  release orchestration.
- Independent premium architecture and final-diff gates are mandatory.
- Stop if production identity, migration ledger, v1 fingerprints, runtime
  flags, or exact deployment SHA cannot be proved.

## Architecture gate

- Decision: approved with conditions.
- Source: independent architecture-gate subagent
  `ec5feb51-3a66-4835-a77e-1772155cdec3`.
- Mandatory conditions:
  - `DA-GATE-C01`: conversion requires a request ID, source fingerprint, every
    source row ID/version, explicit intervals, and a disposition for every draft.
  - `DA-GATE-C02`: conversion and every v1 writer/publisher share the same
    team/date lock, acquired before testing conversion state.
  - `DA-GATE-C03`: conversion preserves v1 rows byte-for-byte, never parses
    legacy start time, canonicalizes jobs server-side, and commits atomically.
  - `DA-GATE-C04`: request IDs bind actor, action, and canonical semantic input,
    including expected versions; changed reuse fails.
  - `DA-GATE-C05`: runtime/auth checks precede replay, while replay precedes
    entity lookup so successful deletes remain replayable.
  - `DA-GATE-C06`: assignment update/delete requires assignment row-version CAS.
  - `DA-GATE-C07`: strict plan-version CAS remains; persistence is serialized
    per plan day.
  - `DA-GATE-C08`: plant job identity is canonical source type plus source ID.
  - `DA-GATE-C09`: business writes stay authenticated SECURITY DEFINER RPCs;
    request storage stays private.
  - `DA-GATE-C10`: migration leaves runtime closed, removes obsolete executable
    signatures, and activation remains migration, deploy, preflight, enable,
    smoke, with runtime-only disable on failure.

## Implementation contract

Invariants:

1. AVS jobs remain projections of the canonical job catalogue.
2. v1 draft/publication rows and publication hashes remain unchanged.
3. No legacy time is inferred and no v1/v2 dual-write occurs.
4. Conversion is complete, explicit, fingerprint-bound, and atomic per team/date.
5. Converted scopes reject all later v1 writes after taking the shared lock.
6. Every scoped employee receives exactly one immutable allocation or absence
   itinerary message per publication.
7. Registered and hired plant may occupy multiple visits only for one canonical
   job per day.
8. All v2 mutations retain authorization, runtime gates, expected plan versions,
   entity row versions, deterministic locks, and audited overrides.
9. Optimistic projection never permits an unrelated failed operation to roll
   back successful or pending work.
10. Manager board phone widths below 768px remain blocked; desktop/tablet retain
    touch and keyboard alternatives.

Boundaries:

- Adapt FFTS coordinator, reconciliation, viewport, timeline, occupancy, and
  primary-axis patterns, not its quote lifecycle, Quick add, returned visits,
  day-team buckets, service-role writes, or weaker version model.
- Keep employee issued view and job sheets behaviorally stable.
- Use a new forward-only migration and never edit shipped migration bytes.
- Serialize same-plan persistence while preserving immediate independent UI
  projection.
- Do not activate until the reviewed migration is applied, exact deployment is
  ready, closed-state preflight passes, and rollback disable is available.

Rollback:

- Before activation, additive objects remain inert while both runtime flags are
  false. After activation, any failed validation or smoke triggers the checked-in
  runtime-only disable; all v1/v2 data, conversions, publications, snapshots,
  messages, and permissions remain preserved. Schema rollback and destructive
  downgrade are forbidden; correction is forward-only.

## Required tests

- `DAFP-DB-001`: complete conversion returns authoritative IDs and versions.
- `DAFP-DB-002`: invalid/stale/incomplete conversion rolls back unchanged v1.
- `DAFP-DB-003`: concurrent v1 write versus conversion serializes correctly.
- `DAFP-IDEM-001`: ambiguous retry returns the exact stored result once.
- `DAFP-IDEM-002`: actor/action/payload/version request-ID reuse is rejected.
- `DAFP-LOCK-001`: multi-session operations terminate without deadlock/lost update.
- `DAFP-CAS-001`: stale plan, visit, and assignment versions fail atomically.
- `DAFP-PLANT-001`: same-job visits pass; distinct-job plant claims fail.
- `DAFP-PUB-001`: publication snapshots, messages, and recipients stay immutable.
- `DAFP-AUTH-001`: allowed and denied authorization/RLS paths are proved.
- `DAFP-FLAG-001`: closed flags preserve v1 and reject every v2 write/replay.
- `DAFP-STATE-001`: claims, aliases, coalescing, retries, and retirement are proved.
- `DAFP-UI-001`: three projections, unassigned work, a11y, touch, and phone gate.
- `DAFP-ROLL-001`: signatures, ACLs, fingerprints, deploy SHA, smoke, and disable.

## Final review

- Run one bounded economical adversarial challenge after deterministic checks.
- Supply one fresh compact packet for premium first review.
- If first fails, perform one consolidated repair and one legal closure review.
- Do not launch a third premium review within the same generation. Routing or
  ordinary split does not reset this budget; only an explicit owner-authorized
  successor generation receives a fresh bounded budget and inherits blockers.

## Commit and handoff

- Commit completed implementation and evidence locally using conventional commits.
- Push is authorized by the approved production-activation scope, but report the
  branch, commits, and changed files immediately before push.
- Finish with exact deployment SHA, migration ledger result, activation state,
  smoke evidence, and any unresolved risks.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_7e5a9c14d2f63b80",
  "taskId": "daily-allocation-ffts-parity-20260912",
  "taskType": "change",
  "risk": "high",
  "initialParentTier": "premium",
  "routingDecision": "continued_premium",
  "recommendedBuildModel": {
    "implementation": {
      "role": "premium-planning",
      "tier": "premium",
      "family": "gpt-sol"
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
    "rationale": "The premium parent owns the cross-repository UI adaptation, persistence and concurrency contracts, migration, verification, and production activation.",
    "fallbackEscalation": "Stop if locking, immutable v1 evidence, migration ledger state, runtime flags, production identity, or exact deployment SHA cannot be proved."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "scheduling-persistence-and-concurrency",
    "legacy-draft-atomic-conversion",
    "immutable-publication-and-notification-contract",
    "production-migration-and-activation"
  ],
  "requiredTests": [
    { "id": "DAFP-DB-001", "status": "completed", "note": "Complete guided conversion and authoritative result." },
    { "id": "DAFP-DB-002", "status": "completed", "note": "Conversion rollback and exact v1 preservation." },
    { "id": "DAFP-DB-003", "status": "completed", "note": "Concurrent v1 writer/conversion serialization." },
    { "id": "DAFP-IDEM-001", "status": "completed", "note": "Exact replay after ambiguous failure." },
    { "id": "DAFP-IDEM-002", "status": "completed", "note": "Changed actor/action/payload/version reuse rejection." },
    { "id": "DAFP-LOCK-001", "status": "completed", "note": "Real PostgreSQL lock ordering and deadlock freedom." },
    { "id": "DAFP-CAS-001", "status": "completed", "note": "Plan, visit, and assignment CAS." },
    { "id": "DAFP-PLANT-001", "status": "completed", "note": "Canonical one-job-per-plant-day concurrency." },
    { "id": "DAFP-PUB-001", "status": "completed", "note": "Immutable publication/message/recipient behavior." },
    { "id": "DAFP-AUTH-001", "status": "completed", "note": "Allowed and denied authorization/RLS paths." },
    { "id": "DAFP-FLAG-001", "status": "completed", "note": "Closed runtime compatibility and replay denial." },
    { "id": "DAFP-STATE-001", "status": "completed", "note": "Coordinator and projection behavior." },
    { "id": "DAFP-UI-001", "status": "completed", "note": "Board parity, accessibility, touch, and phone gate." },
    { "id": "DAFP-ROLL-001", "status": "completed", "note": "Migration, rollout, exact SHA, smoke, and disable." }
  ],
  "unresolvedRisks": [
    { "id": "DAFP-RISK-001", "note": "Strict plan CAS limits same-plan persistence concurrency." },
    { "id": "DAFP-RISK-002", "note": "Disabled converted scopes cannot resume v1 editing." },
    { "id": "DAFP-RISK-003", "note": "Publication/conversion locks may create short contention spikes." },
    { "id": "DAFP-RISK-004", "note": "Complex pointer and touch interactions may have device-specific regressions." },
    { "id": "DAFP-RISK-005", "note": "Immutable request-ledger growth needs a future retention policy." }
  ],
  "finalReviewRequired": true,
  "finalReviewSource": "independent_subagent",
  "commit": "pending",
  "handoff": "pending",
  "implementationContract": {
    "invariants": [
      "Jobs remain canonical catalogue projections.",
      "v1 drafts, publications, and hashes remain byte-for-byte unchanged.",
      "No legacy time is inferred and no dual-write occurs.",
      "Conversion is complete, explicit, fingerprint-bound, and atomic per team/date.",
      "Every v1 writer takes the shared team/date lock before conversion-state checks.",
      "Publication snapshots, recipients, and one-message-per-employee behavior remain immutable.",
      "Plant occupies only one canonical job per asset/day.",
      "All v2 writes retain runtime, auth, expected-version, and deterministic-lock enforcement.",
      "Same-plan persistence is serialized while optimistic UI remains immediate.",
      "Phone manager editing stays blocked below 768px."
    ],
    "boundaries": [
      "Adapt only FFTS core board and performance patterns.",
      "Keep employee issued view and job sheets behaviorally stable.",
      "Use a new forward migration; do not edit shipped migrations.",
      "Keep business writes on authenticated SECURITY DEFINER RPCs.",
      "Exclude FFTS quotes queue, Quick add, returned visits, day teams, and service-role fallbacks.",
      "Do not activate without exact deployed SHA and closed-state preflight."
    ],
    "rollback": "Keep flags false before activation. On activation or smoke failure, execute runtime-only disable and preserve every v1/v2 row, conversion, publication, snapshot, message, permission, and migration ledger record; use forward-only correction."
  },
  "reviewClosureProtocol": "two-pass-v1"
}
-->
