# Fixerrors

`npm run fixerrors` captures a transaction-consistent production `error_logs` snapshot, writes private analysis and retrieval artifacts, archives the exact captured rows, and purges archived rows older than 12 months. Archive means the row was processed into an immutable snapshot. It does not mean the underlying defect was resolved.

The `/fixerrors` command then diagnoses those clusters, uses the sanitized knowledge in `lib/config/fixerrors-knowledge.json`, validates a snapshot-bound decision, and automatically repairs FAST, STANDARD, and GUARDED code defects. CRITICAL fixes pause for explicit approval. Passing non-critical repairs are locally committed after targeted tests and independent review. The command never pushes.

Raw snapshots, user identities, and review evidence stay in gitignored `docs_private`. The committed knowledge store contains only sanitized fingerprints, diagnoses, outcomes, and file or test references. Legacy `docs_private/error-fix-log.md` is historical tracking, not executable authority.

The safety contract remains `fixerrors-exact-snapshot-v4`.
