import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { GET } from '@/app/api/reports/timesheets/job-labour/route';
import { validateAppSession } from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { aggregateJobLabour, loadJobLabourReport } from '@/lib/server/job-labour-report';
vi.mock('@/lib/server/app-auth/session', () => ({ validateAppSession: vi.fn() }));
vi.mock('@/lib/server/app-auth/response', () => ({ applyValidationCookieIfNeeded: vi.fn() }));
vi.mock('@/lib/utils/rbac', () => ({ canEffectiveRoleAccessModule: vi.fn() }));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/server/job-labour-report', async original => ({ ...await original<typeof import('@/lib/server/job-labour-report')>(), loadJobLabourReport: vi.fn() }));
const query = 'dateFrom=2026-06-01&dateTo=2026-06-30&jobCodes=40065-GH&hoursPerDay=8';
const request = (extra = '') => new NextRequest(`http://localhost/api/reports/timesheets/job-labour?${query}${extra}`);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateAppSession).mockResolvedValue({ status: 'active', profileId: 'fixture' } as never);
  vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
  vi.mocked(loadJobLabourReport).mockImplementation(async filters => aggregateJobLabour([{
    id: 'sheet', user_id: 'fixture', week_ending: '2026-06-07', status: 'approved', employee: { full_name: 'Fixture Employee' },
    timesheet_entries: [{ id: 'entry', day_of_week: 1, daily_total: 4, job_number: '40065-GH' }],
  }], filters));
});
describe('Job labour route', () => {
  it('rejects unauthenticated callers before reading report data and prevents caching', async () => {
    vi.mocked(validateAppSession).mockResolvedValue({ status: 'missing' } as never);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(loadJobLabourReport).not.toHaveBeenCalled();
  });
  it.each(['reports', 'timesheets'])('denies missing effective %s access', async denied => {
    vi.mocked(canEffectiveRoleAccessModule).mockImplementation(async module => module !== denied);
    expect((await GET(request())).status).toBe(403);
    expect(loadJobLabourReport).not.toHaveBeenCalled();
  });
  it('validates input before reading data', async () => {
    expect((await GET(new NextRequest('http://localhost/api/reports/timesheets/job-labour?dateFrom=bad'))).status).toBe(400);
    expect((await GET(request('&format=csv'))).status).toBe(400);
    expect(loadJobLabourReport).not.toHaveBeenCalled();
  });
  it('uses the same filters and numeric totals in JSON and a real Excel workbook', async () => {
    const json = await (await GET(request())).json();
    expect(json.totals.manDays).toBe(0.5);
    const response = await GET(request('&format=xlsx'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).toContain('Job_Labour_2026-06-01_to_2026-06-30.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Job summary', 'Daily evidence', 'Methodology']);
    expect(workbook.worksheets[0].getCell('B2').value).toBe(json.summary[0].allocatedHours);
    expect(workbook.worksheets[0].getCell('C2').value).toBe(json.summary[0].manDays);
    expect(workbook.worksheets[1].getCell('D2').value).toBe(4);
    expect(vi.mocked(loadJobLabourReport).mock.calls[0][0]).toEqual(vi.mocked(loadJobLabourReport).mock.calls[1][0]);
  });
  it('fails closed without returning raw server errors', async () => {
    vi.mocked(loadJobLabourReport).mockRejectedValue(new Error('private connection data'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private connection data');
  });
});
