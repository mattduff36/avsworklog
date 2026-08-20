# /fixerrors

<!-- trusted-operational-action: {"commandId":"fixerrors","safetyContract":"fixerrors-exact-snapshot-v3","registry":"scripts/automation/trusted-operational-actions.ts"} -->

1. Run `npm run fixerrors`. This exports a repeatable-read snapshot of **active** production error logs, writes and reads back the recovery artifact and analysis report, then archives those exact snapshot rows in the same process. No confirmation step. Do not reconstruct a separate cleanup command.
2. If the snapshot is empty, no archive write is required. Newer or already-archived rows stay untouched. The exported artifact is retained.
3. Archive mutates only `error_logs.status` and `error_logs.archived_at` for the exact verified snapshot IDs. `error_log_alerts` and application foreign keys stay in place. Any artifact, target, schema, identity, expiry, mixed-state, or transaction mismatch suspends operational trust and stops the archive.
4. Read `docs_private/error-analysis.md` and verify each root-cause cluster's proposed TEE lane/action independently.
5. Process clusters separately. One CRITICAL database/RLS/auth/security cluster must not escalate unrelated FAST/STANDARD clusters. External, network, third-party, and user-input patterns remain report-only when no code defect is evidenced.
6. After clustering, apply the current TEE execution-mode advisory only when multiple substantial clusters are genuinely independent.
7. CRITICAL clusters require normal architecture/final review gates and the database rule where relevant. Changing this command's snapshot, validation, transaction, archive, or safety-contract implementation is itself CRITICAL.
8. Run targeted checks for each fixed cluster, report fixed/report-only/manual-investigation outcomes, and commit a coherent local set. Resolve any printed monthly follow-up through the established flow. Never push without separate authorization.
9. Crash recovery only: if analysis sealed but archive did not finish, `npm run fixerrors -- --cleanup` with the exact bound snapshot identity may be used. That path archives; it must never delete archived audit rows. Old v2 delete commands fail closed.
