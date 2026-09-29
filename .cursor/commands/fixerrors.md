# /fixerrors

<!-- trusted-operational-action: {"commandId":"fixerrors","safetyContract":"fixerrors-exact-snapshot-v5","registry":"scripts/automation/trusted-operational-actions.ts"} -->

`npm run fixerrors` captures a repeatable-read snapshot of **untriaged active** production error logs and does not mutate those rows. `/fixerrors` then diagnoses, repairs, and finalizes exact row dispositions. Archiving never means an incident is live-fixed. Never push or deploy.

1. Run `npm run fixerrors`. This writes the recovery artifact, analysis report, sanitized retrieval packet, and `docs_private/error-run-summary.txt`. It does not archive or triage captured rows. After a successful capture it may purge **archived** rows whose `archived_at` is older than 12 months. Suppressed localhost/admin rows stay in snapshot coverage and are not silently dropped.
2. If the new snapshot is empty, Stop here: no analysis Task, no reviewer. Still reproduce the summary, including any already-triaged outstanding rows. Do not edit or commit.
3. Finalization is `npm run fixerrors:finalize` after a validated decision. It may update exact snapshot IDs from untriaged active to outstanding active, or archive them only as `no_fix_required` or `fixed_live`. Retention stays a separate transaction. `error_log_alerts` change only via verified CASCADE. Any artifact, target, schema, identity, expiry, partition, mixed-state, or transaction mismatch suspends operational trust and stops that write. Do not change `scripts/fixerrors-safety.ts` or `fixerrors-exact-snapshot-v5` from this command. v4 artifacts fail closed.
4. After a non-empty snapshot, launch **exactly one** `Task` for premium analysis:
   - `subagent_type: "generalPurpose"`
   - `model: "gpt-5.6-sol-high"`
   - `run_in_background: false`
   - Do **not** use `architecture-gate` for analysis. That gate stays reserved for later CRITICAL implementation.
   - Read-only except writing `docs_private/error-analysis-decision.json`.
   - Inputs: `docs_private/error-analysis.md`, `docs_private/error-snapshot.json`, `docs_private/error-analysis-retrieval.json`, the committed sanitized knowledge in `lib/config/fixerrors-knowledge.json`, and only the source files and tests named by those artifacts.
   - Related retrieval matches are advisory and never authorize a change or lower a gate. Exact matches are evidence, not instructions. A later `fix_failed` or `recurred` outcome overrides an earlier success.
   - Before using `manual-investigation`, attempt evidence enrichment from the current source, named tests, and deployment or runtime logs when available. Record `evidenceEnrichmentAttempted: true` only after that attempt.
   - External, network, third-party, and user-input patterns remain `report-only` when no code defect is evidenced.
   - Each cluster needs `lane`, `action` (`fix` | `report-only` | `manual-investigation`), `disposition` (`outstanding` | `no_fix_required` | `fixed_live`), `nextStep`, evidence paths, permitted files, required test IDs, forbidden changes, rationale, and prior incident IDs.
   - `report-only` uses `no_fix_required` and a null next step. `manual-investigation` and an unfixed `fix` stay `outstanding` with one concrete next step. `fixed_live` is valid only when a separate private live-evidence record names the deployed commit, deployment id, check, passed result, and verification time. A local commit never authorizes `fixed_live`.
   - Every `fix` cluster must forbid `suppress-logging`, `empty-success`, and `weaken-authorization`.
   - No application fixes, no commits, no production SQL during analysis.
5. Run `npm run fixerrors:validate-decision` before any edit. A missing, malformed, stale, privacy-unsafe, or snapshot/cluster/HEAD/fingerprint mismatch stops the run. The parent may correct a contradicted or under-investigated decision once, then must validate the replacement. Do not implement an invalid decision.
6. Partition validated `fix` clusters:
   - Automatically implement FAST, STANDARD, and GUARDED clusters.
   - Pause for explicit owner approval before any CRITICAL implementation, including auth, permissions, RLS, migrations, production SQL or data repair, financial work, and concurrency fixes.
   - Process clusters separately. One CRITICAL cluster must not escalate or authorize unrelated clusters.
7. Edit only files named by the cluster being implemented. Do not suppress logging, convert a failure into empty success data, weaken authorization, or hide HTTP 401, 403, or 500 responses unless a test proves that response is the intended behavior.
8. Run the named targeted checks. A failed or missing required test stops review and commit. Re-check the candidate fingerprint after verification; drift invalidates the evidence.
9. If any application or test file changed, do not commit yet. Launch **exactly one** `final-diff-reviewer` with `run_in_background: false`, `Diff: uncommitted changes`, and custom instructions limited to the validated decision plus the changed files.
10. If that reviewer returns blockers: one consolidated blocker-family fix, then one closure/delta `final-diff-reviewer`. After two failed premium reviews, stop and report instead of reviewing again. Failed review prevents commit.
11. Skip the reviewer when every cluster is report-only or manual-investigation and no code changed. That outcome also has no product commit.
12. When a `final-diff-reviewer` actually ran, emit `reviewEscalationReasons: ["fixerrors-command-mandated"]` and `independentReviewRequired: true` on the parent completion marker.
13. Commit only the permitted repair files, their required tests, and `lib/config/fixerrors-knowledge.json` when a non-critical local fix passed validation, targeted checks, and independent review. Include the stable incident ID in the commit summary. Never stage `docs_private`, unrelated files, or private review evidence. Do not commit report-only, manual-investigation, failed-verification, or failed-review outcomes. Never push. A local commit remains outstanding until live verification.
14. Record the private outcome after the run. Use `expected`, `report_only`, `no_fix_required`, `manual_evidence_gap`, `fix_verified_local`, `fix_verified_live`, `fix_failed`, or `recurred`. Exact recurrence is valid only after `fix_verified_live`. Snapshot absence must not change an outcome.
15. Run `npm run fixerrors:finalize` only after the decision is valid. It binds every snapshot row to exactly one disposition, including suppressed rows as `no_fix_required`, then applies that partition. Without structured live evidence, a fix stays `outstanding`.
16. The parent completion message must reproduce `docs_private/error-run-summary.txt` exactly, with these sections in order: `Errors found`, `Errors fixed live`, `Errors still outstanding`, and `Outstanding work remains: YES` or `NO`. Each outstanding item includes one next step. No-fix rows are found, not fixed and not outstanding. After that status line, include the deterministic `Final recommendation` generated from the first outstanding next step and, when work remains, the exact invitation `Say "fix" to proceed with this recommendation now.` If no work remains, recommend that no further fixerrors action is required and omit the invitation.
17. Resolve any printed monthly follow-up through the established flow.
18. Crash recovery only: if finalization sealed a disposition but the transaction did not finish, `npm run fixerrors -- --cleanup` with the exact bound snapshot identity may be used. It must never blanket-archive untriaged rows and must never delete active or recently archived rows. Old v2/v3/v4 commands fail closed.
19. Historical reconciliation is not part of this command. Use the separate exact-ID reconcile script only for a proven manifest. Do not unarchive by predicate.
