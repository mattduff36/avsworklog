import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateJobLabour, loadJobLabourReport, type LabourSourceTimesheet } from '@/lib/server/job-labour-report';
import { parseJobLabourFilters } from '@/lib/validation/job-labour-report';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTimesheetReportScopedProfileIds, filterTimesheetRowsForReportScope } from '@/lib/server/reports-timesheet-scope';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/server/reports-timesheet-scope', () => ({ getTimesheetReportScopedProfileIds: vi.fn(), filterTimesheetRowsForReportScope: vi.fn() }));
const filters = { dateFrom: '2026-06-01', dateTo: '2026-06-30', hoursPerDay: 8, jobCodes: [] as string[] };
function sheet(id = '1', overrides: Partial<LabourSourceTimesheet> = {}): LabourSourceTimesheet {
  return { id, user_id: `user-${id}`, week_ending: '2026-06-07', status: 'approved', employee: { full_name: 'Fixture Employee' },
    timesheet_entries: [{ id: `entry-${id}`, day_of_week: 1, daily_total: 8, job_number: '40065-GH' }], ...overrides };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTimesheetReportScopedProfileIds).mockResolvedValue(null);
  vi.mocked(filterTimesheetRowsForReportScope).mockImplementation(async rows => rows.filter(row => row.user_id !== 'hidden'));
});

describe('Job labour calculations', () => {
  it('uses inclusive work dates, including a final partial week and a DST boundary', () => {
    const rows = [sheet('1', { week_ending: '2026-07-05', timesheet_entries: [
      { id: 'mon', day_of_week: 1, daily_total: 4, job_number: '40065-GH' },
      { id: 'tue', day_of_week: 2, daily_total: 8, job_number: '40065-GH' },
      { id: 'wed', day_of_week: 3, daily_total: 8, job_number: '40065-GH' },
    ] })];
    const result = aggregateJobLabour(rows, filters);
    expect(result.detail.map(row => row.date)).toEqual(['2026-06-29', '2026-06-30']);
    expect(result.totals.manDays).toBe(1.5);
    expect(aggregateJobLabour([sheet('dst', { week_ending: '2026-10-25' })], { ...filters, dateFrom: '2026-10-19', dateTo: '2026-10-19' }).detail[0].date).toBe('2026-10-19');
  });
  it('splits across the complete deduplicated code list before the selected job filter', () => {
    const row = sheet();
    row.timesheet_entries[0].timesheet_entry_job_codes = [
      { job_number: '40065-GH' }, { job_number: '40053-gh' }, { job_number: '40065-GH' },
    ];
    const result = aggregateJobLabour([row], { ...filters, jobCodes: ['40053-GH'] });
    expect(result.totals).toMatchObject({ allocatedHours: 4, manDays: 0.5 });
    expect(result.detail[0]).toMatchObject({ split: true, dailyHours: 8, jobCodes: ['40065-GH', '40053-GH'] });
    expect(aggregateJobLabour([row], filters).totals.allocatedHours).toBe(8);
  });
  it('excludes unapproved, DNW, yard, nonpositive and uncoded work and deduplicates entries', () => {
    const rows = ['draft', 'submitted', 'rejected', 'approved', 'processed'].map((status, i) => sheet(String(i), { status }));
    const off = sheet('off'); off.timesheet_entries[0].did_not_work = true;
    const yard = sheet('yard'); yard.timesheet_entries[0].working_in_yard = true;
    const noJob = sheet('noJob'); noJob.timesheet_entries[0].job_number = null;
    const negative = sheet('negative'); negative.timesheet_entries[0].daily_total = -1;
    expect(aggregateJobLabour([...rows, rows[3], off, yard, noJob, negative], filters).totals.allocatedHours).toBe(16);
  });
  it('uses Plant V2 worked hours, excluding leave hours in daily_total', () => {
    const row = sheet('plant', { timesheet_type: 'plant', template_version: 2 });
    Object.assign(row.timesheet_entries[0], { time_started: '08:00', time_finished: '12:00', daily_total: 8 });
    expect(aggregateJobLabour([row], filters).totals).toMatchObject({ allocatedHours: 4, manDays: 0.5 });
    Object.assign(row.timesheet_entries[0], { time_started: '08:00', time_finished: '17:00' });
    expect(aggregateJobLabour([row], filters).totals.allocatedHours).toBe(8.5);
  });
  it('preserves precision across splits and supports a different day length', () => {
    const row = sheet(); row.timesheet_entries[0].timesheet_entry_job_codes = ['40065-GH', '40053-GH', '40001-GH'].map(job_number => ({ job_number }));
    const result = aggregateJobLabour([row], { ...filters, hoursPerDay: 4 });
    expect(result.totals.allocatedHours).toBeCloseTo(8, 12);
    expect(result.totals.manDays).toBeCloseTo(2, 12);
  });
  it('reports unmatched job codes and empty results without claiming no work occurred', () => {
    const result = aggregateJobLabour([], { ...filters, jobCodes: ['40065-GH'] });
    expect(result.unmatchedJobCodes).toEqual(['40065-GH']);
    expect(result.summary).toEqual([]);
    expect(result.totals.allocatedHours).toBe(0);
  });
  it.each([
    'dateFrom=2026-02-30&dateTo=2026-06-30', 'dateFrom=2026-07-01&dateTo=2026-06-01',
    'dateFrom=2025-01-01&dateTo=2026-06-01', 'dateFrom=2026-06-01&dateTo=2026-06-30&hoursPerDay=0',
    'dateFrom=2026-06-01&dateTo=2026-06-30&hoursPerDay=Infinity',
    'dateFrom=2026-06-01&dateTo=2026-06-30&jobCodes=%3Cscript%3E',
  ])('rejects invalid filters: %s', query => expect(() => parseJobLabourFilters(new URLSearchParams(query))).toThrow());
  it('normalizes requested codes and validates the code count', () => {
    expect(parseJobLabourFilters(new URLSearchParams('dateFrom=2026-06-01&dateTo=2026-06-30&jobCodes=40065-gh,40065-GH')).jobCodes).toEqual(['40065-GH']);
    expect(() => parseJobLabourFilters(new URLSearchParams(`dateFrom=2026-06-01&dateTo=2026-06-30&jobCodes=${Array(21).fill('40065-GH').join(',')}`))).toThrow();
  });
});

describe('Job labour source completeness and scope', () => {
  function source(rows: LabourSourceTimesheet[], failAt = -1) {
    const calls: Array<[string, unknown[]]> = [];
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'gte', 'lte', 'order']) query[method] = (...args: unknown[]) => { calls.push([method, args]); return query; };
    query.range = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: from === failAt ? new Error('private database detail') : null }));
    vi.mocked(createAdminClient).mockReturnValue({ from: () => query } as never);
    return { query, calls };
  }
  it('reads beyond 1000 rows, bounds overlapping weeks and applies scope before aggregation', async () => {
    vi.mocked(getTimesheetReportScopedProfileIds).mockResolvedValue(new Set(['allowed']));
    const rows = Array.from({ length: 1001 }, (_, i) => sheet(String(i)));
    rows[0].user_id = 'hidden';
    const fake = source(rows);
    const result = await loadJobLabourReport(filters);
    expect(fake.query.range).toHaveBeenCalledTimes(3);
    expect(fake.calls).toContainEqual(['in', ['user_id', ['allowed']]]);
    expect(fake.calls).toContainEqual(['lte', ['week_ending', '2026-07-06']]);
    expect(result.totals.allocatedHours).toBe(8000);
    expect(filterTimesheetRowsForReportScope).toHaveBeenCalledWith(rows);
  });
  it('does not create a privileged client for an empty permission scope', async () => {
    vi.mocked(getTimesheetReportScopedProfileIds).mockResolvedValue(new Set());
    expect((await loadJobLabourReport(filters)).detail).toEqual([]);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it('fails rather than reporting partial totals if a later page fails', async () => {
    source(Array.from({ length: 501 }, (_, i) => sheet(String(i))), 500);
    await expect(loadJobLabourReport(filters)).rejects.toThrow('Unable to read complete');
  });
});
