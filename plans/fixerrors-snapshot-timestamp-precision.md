# fixerrors snapshot timestamp precision

Workstream: `ws_c4e91a7b2f08`

## Classification

- Lane: CRITICAL
- Why: changes `fixerrors` snapshot selection/validation (registered safety contract `fixerrors-exact-snapshot-v2`). Production cleanup remains blocked until export can capture an exact verified snapshot.
- Task type: change (safety-implementation bugfix). Not a trusted operational execution of cleanup.
- Escalation: `/fixerrors` export failed closed with `Production error snapshot boundary mismatch; cleanup blocked`. Operational trust is suspended for that run. Leftover `docs_private/error-snapshot.json` is version 1 from 2026-08-11 and must not be used for cleanup.

## Evidence

- `error_logs.created_at` / `timestamp` are `TIMESTAMPTZ DEFAULT NOW()` (microsecond precision).
- `node-pg` returns `timestamptz` as a JavaScript `Date` (millisecond precision) unless the value is selected as text.
- `normalizeTimestamp()` uses `Date.toISOString()`, then that truncated string is bound as `$1::timestamptz` for count/page `ROW(created_at, id)` filters.
- The captured boundary still identifies the true latest row. Count/page therefore omit that row (and any later-microsecond peers in the same millisecond), count still matches the filtered set, and the last fetched row ≠ boundary.
- The leftover v1 snapshot already stored `created_at` values such as `2026-08-10T21:50:14.694888+00:00`, proving production rows have microseconds.
- Unit mock `ExportClient` does not apply the SQL boundary bind, so FXERR-SNAPSHOT-001 never caught this.

## Architecture source and reasons

- Independent premium architecture gate: `approved_with_conditions` ([Architecture](f10062c8-616a-4c77-b898-c093a34c7c24)).
- Reasons: snapshot/selection contract, transactional integrity of the export bound, production-data cleanup depends on exact snapshot identity.
- Mandatory conditions: project canonical microsecond text in boundary, page, and cleanup `lock-target-rows` verification; keep `ROW` filters on native `TIMESTAMPTZ`/UUID columns; separate snapshot vs operational timestamp functions; reject Date-typed snapshot timestamps; do not reuse v1/pre-fix artifacts.

## Implementation contract

Restore the already-approved v2 semantics: inside one `REPEATABLE READ READ ONLY` transaction, the snapshot is every `public.error_logs` row with `ROW(created_at, id) <=` the transaction-visible max `(created_at, id)`, and the last exported row must be that max.

Do not change:

- safety contract id `fixerrors-exact-snapshot-v2`
- allowed mutations / cleanup deletion / confirmation binding
- isolation, statement timeout, keyset pagination, checksum/manifest rules
- leftover v1 artifact reuse (still rejected)

Do:

1. Select `created_at` and `timestamp` as UTC text with microsecond precision (`to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`), and `id::text`.
2. Canonicalize snapshot/boundary timestamps as `YYYY-MM-DDTHH:MM:SS.mmmmmmZ`. Do not round-trip those fields through `Date.toISOString()`.
3. Bind that canonical string as the Postgres boundary/cursor `timestamptz` parameters.
4. Fail closed if a snapshot row/boundary timestamp arrives as a JavaScript `Date` or any string that cannot be canonicalized without precision loss.
5. Leave `exportedAt`, `expiresAt`, and `transactionStartedAt` as millisecond JS ISO so existing `isValidIsoTimestamp` checks stay unchanged.
6. Project the same canonical text in cleanup `lock-target-rows` so checksum verification cannot see `Date`-truncated values. Do not change deletion SQL.
7. Keep `ROW` filtering and `ORDER BY` on native `error_logs.created_at` / `error_logs.id`.
8. Teach the unit `ExportClient` to honour both boundary and cursor `ROW` binds.

## Invariants

- Export remains read-only; failure rolls back; no cleanup starts without a new verified v2 snapshot plus explicit confirmation of the printed bound command.
- Concurrent/backdated rows that become visible only after `BEGIN` stay excluded (FXERR-CONCURRENCY-002).
- Same-millisecond, different-microsecond rows remain strictly ordered as Postgres orders them.
- Cleanup still deletes only exact snapshot IDs plus registered dependent diagnostic alerts.

## Boundaries

- Files: `scripts/fixerrors-safety.ts`, `tests/unit/fixerrors-safety.test.ts`, this plan.
- No schema/migration, no RLS change, no cleanup SQL change, no safety-contract bump.

## Rollback

- Revert the two code files. Failed export continues to fail closed. No production mutation is introduced by this change.

## Unresolved risks

- `FXERR-RISK-PERFORMANCE` remains: no `(created_at, id)` index; timeout still fails closed.
- After this fix, `/fixerrors` must be re-run as the registered export. Cleanup still requires a separate explicit confirmation of the exact printed command.

## Required tests

| ID | Status | Check |
| --- | --- | --- |
| FXERR-SNAPSHOT-001 | completed | 0/1/199/200/405-row keyset export still complete |
| FXERR-CONCURRENCY-002 | completed | backdated post-BEGIN insert stays outside snapshot and survives cleanup |
| FXERR-TS-PREC-015 | completed | latest row with non-zero microseconds is included; last row equals boundary |
| FXERR-TS-ORDER-016 | completed | two rows in the same millisecond, different microseconds, stay strictly ordered |
| FXERR-TS-DATE-017 | completed | Date-typed boundary and page-row timestamps fail closed |
| FXERR-TS-CLEANUP-018 | completed | Canonical microseconds survive locked-row checksum verification |
| FXERR-V1-REJECT-019 | completed | Stale v1 artifact causes zero database work |

## Verification

- `npx vitest run tests/unit/fixerrors-safety.test.ts`
- Then re-run `npm run fixerrors` (export only). Do not reconstruct cleanup arguments.

## Final review

- Independent premium final-diff review after verification.
- Bounded two-pass-v1.

## Commit and handoff

- Commit the precision fix locally after review (`type(scope): summary`).
- Do not push.
- Then continue `/fixerrors` export → confirmation → exact cleanup → cluster handling.

<!-- plan-contract-marker:v1
{
  "schemaVersion": "1",
  "registryVersion": "2",
  "workstreamId": "ws_c4e91a7b2f08",
  "taskId": "fixerrors-snapshot-timestamp-precision",
  "taskType": "change",
  "risk": "high",
  "lane": "critical",
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
    "rationale": "Snapshot-bound export/cleanup identity is a registered safety contract. The current premium parent owns diagnosis, the plan, and later operational re-entry to /fixerrors.",
    "fallbackEscalation": "Stop if the gate requires a safety-contract bump, cleanup SQL change, or leftover v1 snapshot reuse."
  },
  "architectureGate": "approved_with_conditions",
  "architectureReviewSource": "independent_subagent",
  "independentReviewRequired": true,
  "independentReviewReasons": [
    "snapshot-selection-contract",
    "transactional-export-bound",
    "production-cleanup-depends-on-exact-snapshot"
  ],
  "requiredTests": [
    { "id": "FXERR-SNAPSHOT-001", "status": "completed" },
    { "id": "FXERR-CONCURRENCY-002", "status": "completed" },
    { "id": "FXERR-TS-PREC-015", "status": "completed" },
    { "id": "FXERR-TS-ORDER-016", "status": "completed" },
    { "id": "FXERR-TS-DATE-017", "status": "completed" },
    { "id": "FXERR-TS-CLEANUP-018", "status": "completed" },
    { "id": "FXERR-V1-REJECT-019", "status": "completed" }
  ],
  "unresolvedRisks": [
    "FXERR-RISK-PERFORMANCE",
    "operational-export-must-be-rerun-after-fix"
  ],
  "executionMode": {
    "recommendation": "agent",
    "detectedMode": "unknown",
    "advised": true,
    "accepted": null,
    "parallelUnitCount": 1,
    "reason": "CRITICAL snapshot-safety fix is a single sequential unit until architecture is approved."
  },
  "operationalTelemetry": {
    "commandId": "fixerrors",
    "safetyContract": "fixerrors-exact-snapshot-v2",
    "intent": "modify",
    "trusted": false,
    "trustSuspended": true,
    "reason": "Export-time boundary mismatch suspended operational trust; leftover v1 artifact is not a cleanup source."
  }
}
-->
