# /fixerrors

<!-- trusted-operational-action: {"commandId":"fixerrors","safetyContract":"fixerrors-exact-snapshot-v4","registry":"scripts/automation/trusted-operational-actions.ts"} -->

1. Run `npm run fixerrors`. This exports a repeatable-read snapshot of **active** production error logs, writes and reads back the recovery artifact and analysis report, then archives those exact snapshot rows in the same process. After a successful archive or empty-snapshot no-op, it purges **archived** rows whose `archived_at` is older than 12 months. No confirmation step. Do not reconstruct a separate cleanup command.
2. If the snapshot is empty, no archive write is required. Newer or already-archived rows stay untouched until they age past the 12-month retention window. The exported artifact is retained.
3. Archive mutates only `error_logs.status` and `error_logs.archived_at` for the exact verified snapshot IDs. Retention deletes only expired archived rows in a separate transaction. `error_log_alerts` change only via verified CASCADE. Any artifact, target, schema, identity, expiry, mixed-state, or transaction mismatch suspends operational trust and stops that write.
4. Read `docs_private/error-analysis.md` and verify each root-cause cluster's proposed TEE lane/action independently.
5. Process clusters separately. One CRITICAL database/RLS/auth/security cluster must not escalate unrelated FAST/STANDARD clusters. External, network, third-party, and user-input patterns remain report-only when no code defect is evidenced.
6. After clustering, apply the current TEE execution-mode advisory only when multiple substantial clusters are genuinely independent.
7. CRITICAL clusters require normal architecture/final review gates and the database rule where relevant. Changing this command's snapshot, validation, transaction, archive, retention, or safety-contract implementation is itself CRITICAL.
8. Run targeted checks for each fixed cluster, report fixed/report-only/manual-investigation outcomes, and commit a coherent local set. Resolve any printed monthly follow-up through the established flow. Never push without separate authorization.
9. Crash recovery only: if analysis sealed but archive did not finish, `npm run fixerrors -- --cleanup` with the exact bound snapshot identity may be used. That path archives, then may purge expired archived rows. It must never delete active or recently archived rows. Old v2/v3 delete or archive commands fail closed.
