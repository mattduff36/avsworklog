# Absence Financial-Year Archive Runbook

## Purpose

Keep `absences` fast for daily operations by moving closed financial year rows to `absences_archive`.

Financial year boundaries:
- Start: `1 April`
- End: `31 March`

Closed FY rows are read-only in both app hooks and database guards.

## Rollout Steps

1. Run migration:
   - `npx tsx scripts/run-absence-fy-archive-migration.ts`
2. Validate database objects:
   - `npm run db:validate`
3. Verify status endpoint:
   - `GET /api/absence/archive/status`
4. Run archive manually (single FY or all eligible):
   - `POST /api/absence/archive/run`
5. Validate UI:
   - `/absence/manage?tab=records&archived=1`
   - `/absence/archive-report`

## API Examples

Archive all eligible FYs:

```bash
curl -X POST /api/absence/archive/run \
  -H "Content-Type: application/json" \
  -d '{"allEligible": true}'
```

Archive one FY:

```bash
curl -X POST /api/absence/archive/run \
  -H "Content-Type: application/json" \
  -d '{"financialYearStartYear": 2023}'
```

Fetch report page:

```bash
curl "/api/absence/archive/report?financialYearStartYear=2023&page=1&pageSize=50"
```

## Operational Notes

- Default mode is idempotent. Re-runs on an already archived FY return `skipped`.
- Use `force: true` only for remediation scenarios.
- Archive rows are read-only; do not implement edit/delete paths against `absences_archive`.
- Hooks prevent update/delete/cancel/approve/reject of rows in closed FYs.

## Verification Checklist

- `absences_archive` receives moved rows with `financial_year_start_year` and `archived_at`.
- `absences` row count for archived FY decreases accordingly.
- `absence_financial_year_archives` contains audit entries with `row_count`.
- `/absence/manage` can toggle merged active+archived dataset.
- `/absence/archive-report` displays archived-only rows with pagination.
