# Workshop Attachments V2 Cutover Checklist

## Scope

This runbook covers the V2-only cutover for workshop attachments:

- migrate legacy attachment responses into V2 field responses,
- enforce strict readiness validation,
- switch runtime to V2-only API/UI/PDF paths,
- remove legacy database objects.

## Migration Runbook Commands

Run from the project root:

```bash
# 1) Validate V2 attachment integrity (fails if blockers exist)
npx tsx scripts/validate-workshop-attachments-v2-readiness.ts

# 2) Execute destructive legacy-table removal (one-time cutover)
npx tsx scripts/run-workshop-attachments-v2-cutover-migration.ts

# 3) Mandatory post-migration trigger/schema validation
npm run db:validate
```

## Zero-Blocker Acceptance Criteria

Cutover is accepted only when all conditions pass:

- `reports/workshop-attachments/v2-cutover-readiness-report.json`
  - `summary.attachments_without_snapshot = 0`
  - `summary.blocker_count = 0`
- V2 PDF route renders from snapshot + field responses only.
- No runtime usage of legacy response/question API routes.
- `npm run db:validate` exits successfully after destructive migration.

## Go / No-Go Checks

### Go

- readiness report shows zero blockers,
- smoke test passes:
  - open task attachment modal,
  - save draft response,
  - complete attachment,
  - open from history,
  - download PDF.

### No-Go

- any non-zero blocker count in readiness/migration reports,
- missing snapshot for any attachment,
- schema validation failure in `db:validate`,
- runtime errors on attachment list/detail/fill/PDF paths.

## Rollback Steps (Phase 2 Runtime Rollback)

These rollback steps are for runtime code rollback only:

1. Revert to the last pre-cutover commit/branch for attachment runtime.
2. Redeploy application code.
3. Keep V2 snapshot/field-response data intact (no data deletion).
4. Re-run readiness scripts before attempting cutover again.

## Post-Destructive Migration Note

After running `run-workshop-attachments-v2-cutover-migration.ts`, legacy tables are removed:

- `workshop_attachment_questions`
- `workshop_attachment_responses`

At this point, rollback is no longer a simple code-only operation. Recovery requires a forward-fix migration that recreates legacy structures and repopulates them from backups.
