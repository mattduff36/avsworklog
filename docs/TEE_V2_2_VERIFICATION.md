# TEE V2.2 verification ledger

Workstream: `ws_7c2f91d8b4a6`

No schema migration, production `fixerrors` execution, application-data mutation, build, or push is part of this migration.

## Required checks

- `FXERR-SNAPSHOT-001` — completed: 0, 1, 199, 200, and 405-row repeatable-read keyset exports; no offset pagination.
- `FXERR-CONCURRENCY-002` — completed: a concurrent backdated arrival remains outside the snapshot and survives exact cleanup.
- `FXERR-ARTIFACT-003` — completed: artifact read/write/validation failure performs zero database cleanup work.
- `FXERR-DELETE-004` — completed: exact IDs, 100-ID batches, returned-identity verification, and diagnostic-alert scope.
- `FXERR-FAILURE-005` — completed: later-batch failure rolls back all transaction mutations; commit uncertainty is indeterminate.
- `FXERR-COLLATERAL-006` — completed: application references and unregistered trigger scope block before deletion.
- `FXERR-CLUSTER-007` — completed: CRITICAL security evidence and unrelated routine/report-only findings retain independent lanes.
- `TEE22-TRUST-008` — completed: exact registered execution is operational; modification, unregistered commands, failed safeguards, wider scope, and contract mismatch are CRITICAL.
- `TEE22-COMPAT-009` — completed: V2.1 Multitask advisory and V1-V4 telemetry compatibility tests remain passing.
- `VERIFY-010` — completed: focused tests, broad unit closure, application typecheck, targeted ESLint, IDE diagnostics, diff inspection, architecture gate, and independent final review protocol.
- `FXERR-TXN-011` — completed: repeatable-read export, locked atomic cleanup, rollback, artifact lock, and indeterminate commit handling.
- `FXERR-SCHEMA-012` — completed: every FK column set is catalogued; composite/unknown FKs and non-internal triggers block.
- `FXERR-CONFIRM-013` — completed: cleanup binds snapshot ID, row checksum/count, target, expiry, safety contract, and immutable manifest.
- `FXERR-TARGET-014` — completed: cross-target artifact reuse is rejected before database work.

The authoritative checks are in:

- `tests/unit/fixerrors-safety.test.ts`
- `tests/unit/fixerrors-source-extraction.test.ts`
- `tests/unit/trusted-operational-actions.test.ts`
- `tests/unit/workflow-execution-mode.test.ts`

## Residual risks

- `FXERR-RISK-PERFORMANCE` — the live schema has no dedicated `(created_at, id)` index. A slow export hits the bounded statement timeout and fails closed; no migration was authorized.
- `FXERR-RISK-ARTIFACT` — a process crash can leave the exclusive artifact lock or an `in_progress` outcome requiring manual investigation. The command never auto-removes or bypasses uncertain evidence.
- `TEE22-RISK-ROLLBACK` — the global Skill is outside Git. Repository rollback and restoration of the recorded timestamped Skill backup are coordinated manual operations.
