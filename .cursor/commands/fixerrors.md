# /fixerrors

<!-- trusted-operational-action: {"commandId":"fixerrors","safetyContract":"fixerrors-exact-snapshot-v2","registry":"scripts/automation/trusted-operational-actions.ts"} -->

1. Run `npm run fixerrors`. This is the non-destructive export/analysis phase. It creates a repeatable-read production snapshot, writes and reads back the recovery artifact and analysis report, and prints a cleanup command bound to the snapshot ID, checksum, row count, expiry, and database target.
2. If the snapshot is empty, do not run cleanup. Otherwise ask exactly once for explicit confirmation: production error logs have been exported; only the exact verified snapshot rows and their registered dependent diagnostic alerts will be cleared; newer errors remain; the exported artifact is retained.
3. After confirmation, run the exact bound cleanup command printed by the export phase. Never reconstruct, loosen, or substitute its arguments. Any artifact, target, schema, reference, identity, expiry, or transaction mismatch suspends operational trust and stops cleanup.
4. Read `docs_private/error-analysis.md` and verify each root-cause cluster's proposed TEE lane/action independently.
5. Process clusters separately. One CRITICAL database/RLS/auth/security cluster must not escalate unrelated FAST/STANDARD clusters. External, network, third-party, and user-input patterns remain report-only when no code defect is evidenced.
6. The export/confirmation/cleanup sequence is sequential. After clustering, apply the current TEE execution-mode advisory only when multiple substantial clusters are genuinely independent.
7. CRITICAL clusters require normal architecture/final review gates and the database rule where relevant. Changing this command's snapshot, validation, transaction, reference, or deletion implementation is itself CRITICAL.
8. Run targeted checks for each fixed cluster, report fixed/report-only/manual-investigation outcomes, and commit a coherent local set. Resolve any printed monthly follow-up through the established flow. Never push without separate authorization.
