# /fixerrors

1. Run `npm run fixerrors` and wait for `docs_private/error-analysis.md`.
2. Read the report's root-cause clusters. Each cluster already includes a proposed TEE lane/action; verify that classification independently.
3. Process clusters separately. One CRITICAL database/RLS/auth/security cluster must not escalate unrelated FAST/STANDARD clusters.
4. For each code-defect cluster, inspect only its listed source files and apply the matching TEE lane. External, network, third-party, and user-input patterns remain report-only when no code defect is evidenced.
5. CRITICAL clusters require the normal independent architecture/final review gates and database rule where relevant. Do not mix them into routine repair.
6. Run targeted checks for each fixed cluster, report fixed/report-only/manual-investigation outcomes, and commit a coherent local set. Keep unrelated cluster evidence distinct.
7. Resolve any printed pending monthly follow-up through the established approve/reject/skip flow. Never push without separate authorization.
