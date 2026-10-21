import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTimesheetReportScopedProfileIds, filterTimesheetRowsForReportScope } from '@/lib/server/reports-timesheet-scope';
import { getEntryJobNumbers, type TimesheetJobCodeSource } from '@/lib/utils/timesheet-job-codes';
import { calculateStandardTimesheetHours } from '@/lib/utils/time-calculations';
import { JOB_LABOUR_INCLUDED_STATUSES, type JobLabourReportFilters, type JobLabourReport, type JobLabourDetailRow } from '@/types/job-labour-report';
import type { ExcelWorksheetData } from '@/lib/utils/excel';

export interface LabourSourceEntry extends TimesheetJobCodeSource {
  id: string; day_of_week: number; daily_total: number | null;
  time_started?: string | null; time_finished?: string | null;
  did_not_work?: boolean | null; working_in_yard?: boolean | null;
}
export interface LabourSourceTimesheet {
  id: string; user_id: string; week_ending: string; status: string;
  timesheet_type?: string | null; template_version?: number | null;
  employee?: { full_name?: string | null } | null;
  timesheet_entries: LabourSourceEntry[];
}

export function aggregateJobLabour(rows: LabourSourceTimesheet[], filters: JobLabourReportFilters): JobLabourReport {
  const detail: JobLabourDetailRow[] = [];
  const selected = new Set(filters.jobCodes);
  const seen = new Set<string>();
  for (const sheet of rows) {
    if (sheet.status !== 'approved' && sheet.status !== 'processed') continue;
    for (const entry of sheet.timesheet_entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      if (entry.did_not_work || entry.working_in_yard || entry.day_of_week < 1 || entry.day_of_week > 7) continue;
      const day = new Date(`${sheet.week_ending}T00:00:00Z`);
      if (!Number.isFinite(day.getTime())) continue;
      day.setUTCDate(day.getUTCDate() - (7 - entry.day_of_week));
      const date = day.toISOString().slice(0, 10);
      if (date < filters.dateFrom || date > filters.dateTo) continue;
      const hours = sheet.timesheet_type === 'plant' && sheet.template_version === 2
        ? calculateStandardTimesheetHours(entry.time_started ?? null, entry.time_finished ?? null)
        : entry.daily_total;
      if (hours === null || !Number.isFinite(hours) || hours <= 0) continue;
      const codes = getEntryJobNumbers(entry);
      for (const code of codes) {
        if (selected.size && !selected.has(code)) continue;
        const allocatedHours = hours / codes.length;
        detail.push({ date, employeeLabel: sheet.employee?.full_name || 'Employee', jobCode: code,
          allocatedHours, manDays: allocatedHours / filters.hoursPerDay, dailyHours: hours,
          jobCodes: codes, split: codes.length > 1, status: sheet.status });
      }
    }
  }
  detail.sort((a, b) => a.date.localeCompare(b.date) || a.jobCode.localeCompare(b.jobCode) || a.employeeLabel.localeCompare(b.employeeLabel));
  const summaries = new Map<string, JobLabourReport['summary'][number]>();
  for (const row of detail) {
    const summary = summaries.get(row.jobCode) || { jobCode: row.jobCode, allocatedHours: 0, manDays: 0, entryCount: 0 };
    summary.allocatedHours += row.allocatedHours;
    summary.manDays += row.manDays;
    summary.entryCount++;
    summaries.set(row.jobCode, summary);
  }
  const summary = [...summaries.values()].sort((a, b) => a.jobCode.localeCompare(b.jobCode));
  return { filters, summary, detail,
    totals: { allocatedHours: detail.reduce((sum, row) => sum + row.allocatedHours, 0),
      manDays: detail.reduce((sum, row) => sum + row.manDays, 0), entryCount: detail.length },
    unmatchedJobCodes: filters.jobCodes.filter(code => !summaries.has(code)),
    methodology: { dateFrom: filters.dateFrom, dateTo: filters.dateTo, hoursPerDay: filters.hoursPerDay,
      includedStatuses: JOB_LABOUR_INCLUDED_STATUSES,
      splitRule: 'Hours are divided equally across all job codes on each worked entry. Multi-job allocations are estimates, not measured job hours.',
      plantHoursRule: 'Plant V2 uses worked start/finish hours with the standard lunch deduction, excluding paid leave hours. Other sheets use recorded daily worked hours.',
      exclusions: 'Only approved/processed timesheets within current Reports visibility. Draft, submitted, rejected, did-not-work, yard, hidden, deleted and system accounts are excluded. Entries without job codes or positive worked hours are excluded.',
      weekSelection: 'Inclusive actual work dates, not week-ending dates. Man-day equivalents = allocated worked hours / hours per man-day; not a headcount or count of attendance days.',
      rounding: 'Calculations and Excel numeric cells retain full precision; preview figures are rounded to 2 decimal places.' } };
}

export async function loadJobLabourReport(filters: JobLabourReportFilters): Promise<JobLabourReport> {
  const scope = await getTimesheetReportScopedProfileIds();
  if (scope?.size === 0) return aggregateJobLabour([], filters);
  const admin = createAdminClient();
  const end = new Date(`${filters.dateTo}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const rows: LabourSourceTimesheet[] = [];
  // Small pages stay below PostgREST's row cap. A stable unique order prevents ambiguous page boundaries.
  for (let offset = 0; ; offset += 500) {
    let query = admin.from('timesheets').select(`id,user_id,week_ending,status,timesheet_type,template_version,
      employee:profiles!timesheets_user_id_fkey(full_name),
      timesheet_entries(id,day_of_week,daily_total,time_started,time_finished,did_not_work,working_in_yard,job_number,
        timesheet_entry_job_codes(job_number,display_order))`)
      .in('status', ['approved', 'processed']).gte('week_ending', filters.dateFrom)
      .lte('week_ending', end.toISOString().slice(0, 10)).order('id', { ascending: true });
    if (scope) query = query.in('user_id', [...scope]);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw new Error('Unable to read complete timesheet report data.');
    const page = (data || []) as unknown as LabourSourceTimesheet[];
    if (page.some(row => !Array.isArray(row.timesheet_entries))) throw new Error('Incomplete timesheet entries.');
    rows.push(...page);
    if (rows.length > 20000) throw new Error('Report is too large. Choose a shorter date range.');
    if (page.length < 500) break;
  }
  const visibleRows = await filterTimesheetRowsForReportScope(rows);
  return aggregateJobLabour(visibleRows, filters);
}

export function jobLabourWorksheets(report: JobLabourReport): ExcelWorksheetData[] {
  return [
    { sheetName: 'Job summary', columns: [
      { header: 'Job', key: 'jobCode' }, { header: 'Allocated hours', key: 'allocatedHours' },
      { header: 'Man-day equivalents', key: 'manDays', width: 24 }, { header: 'Job-day entries', key: 'entryCount', width: 18 }],
      data: [...report.summary.map(row => ({ ...row })), { jobCode: 'TOTAL', ...report.totals }] },
    { sheetName: 'Daily evidence', columns: [
      { header: 'Date', key: 'date' }, { header: 'Employee', key: 'employeeLabel', width: 25 },
      { header: 'Job', key: 'jobCode' }, { header: 'Allocated hours', key: 'allocatedHours', width: 18 },
      { header: 'Man-day equivalents', key: 'manDays', width: 24 }, { header: 'Daily worked hours', key: 'dailyHours', width: 20 },
      { header: 'All entry jobs', key: 'jobCodes', width: 35 }, { header: 'Allocation', key: 'allocation', width: 25 }, { header: 'Status', key: 'status' }],
      data: report.detail.map(row => ({ ...row, jobCodes: row.jobCodes.join(', '), split: undefined,
        allocation: row.split ? 'Estimated equal split' : 'Single job' })).map(({ split: _split, ...row }) => row) },
    { sheetName: 'Methodology', columns: [{ header: 'Setting', key: 'setting', width: 25 }, { header: 'Value', key: 'value', width: 100 }],
      data: [...Object.entries(report.methodology).map(([setting, value]) => ({ setting, value: Array.isArray(value) ? value.join(', ') : value })),
        { setting: 'Requested jobs', value: report.filters.jobCodes.join(', ') || 'All jobs' },
        { setting: 'No matching worked entries', value: report.unmatchedJobCodes.join(', ') || 'None' }] },
  ];
}
