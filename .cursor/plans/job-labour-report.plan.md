# Job labour report

## Scope and recovered state
- Checked every local branch and committed history, six stash file inventories, registered worktrees (one current checkout), repository and user Cursor plans. No existing job man-day report found. Preserve all stashes and branches.
- Implement locally on current main. No schema/data mutation, new permission grants, push or deployment in this task.

## Report contract
- Reports > Timesheets: Job Labour report, dates plus optional comma-separated exact job codes (blank = all), hours per man-day (explicit default 8, configurable 0.25-24).
- Source: approved/processed timesheet worked entries; exclude draft/submitted/rejected, did-not-work and yard rows. Compute actual work date from Sunday week ending + weekday; select overlapping weeks then filter each work date inclusively. Maximum 366 days.
- Use canonical multi-job normalizer, relation codes preferred over legacy job_number; deduplicate codes. Divide daily worked hours equally across all codes before filtering selected codes; visibly label estimates, never duplicate the full day per code. Plant V2 worked hours use existing start/end lunch calculation rather than leave-inclusive daily_total.
- Man-day equivalents = allocated worked hours / selected hours per day, not unique employee count or calendar days. Sum unrounded values; round only presentation. Surface unmatched requested jobs and empty results explicitly.
- Preview totals by job, daily/employee evidence and Excel workbook containing summary, detail, methodology (dates, status, hours/day, split rule). Both formats use identical scoped service results.
- Require current app session and effective Reports + Timesheets access; preserve existing report team/self scopes, hidden/deleted profile filtering and View As. Never expose service role or bypass scope. Paginate all source rows; fail closed on source errors and unsafe limits, never partial-success totals. Private no-store responses.

## Packages
1. Server types, input validation, paginated read/aggregation, JSON/XLSX route and focused fixture tests (Cursor worker, <=6 files).
2. Existing Reports integration, isolated report UI and UI tests (Cursor worker, <=3 files). Preserve existing page chrome and other reports.
3. Parent review of authorization, query completeness, arithmetic and UI; targeted tests + TypeScript, independent risk review, desktop/mobile browser check on actual port 4000. Local commit after passing checks. No production build unless separately authorised.

## Required evidence
- June start/end midweek, crossing DST/months, approved/processed vs other statuses, plant V2 leave exclusion, legacy and relational codes, duplicate codes, multiple jobs without double-counting, partial-day equivalents, no rounding drift, invalid input, unmatched/empty jobs.
- API unauthorized/forbidden/scope-empty/hidden profiles, pagination >1000 rows, database failure, JSON/XLSX parity and privacy headers.
- UI generation/download params, loading/failure/empty states, invalid numeric input and stale requests, readable responsive table.

## Progress
- Discovery complete: no matching local implementation found.
- Cursor server run stopped after a 10-minute startup/planning delay, leaving only shared types; parent completed the implementation directly.
- Server, export, existing Reports integration and UI complete. 28 new tests plus 3 existing visibility tests passed; current TypeScript and targeted ESLint passed. Independent final risk review: no blockers.
- Signed-in port 4000 verification passed for 2026-06-01 through 2026-10-15 and the two requested jobs. Report preview and Excel endpoint both returned HTTP 200. Actual Excel browser download-event capture timed out; the real workbook was separately validated in route integration tests. Desktop proof saved; narrow viewport DOM width and scroll width both 390 (browser screenshot emulation was unreliable).
- 40053-GH is explicitly flagged as having no matching approved/processed entries within current visibility, not as proof of zero work. No push or deployment authorised for this task.
