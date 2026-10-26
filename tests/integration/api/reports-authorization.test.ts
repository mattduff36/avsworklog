import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as timesheetSummary } from '@/app/api/reports/timesheets/summary/route';
import { GET as payroll } from '@/app/api/reports/timesheets/payroll/route';
import { GET as bookings } from '@/app/api/reports/absence-leave/bookings/route';
import { GET as allowance } from '@/app/api/reports/absence-leave/allowance-totals/route';
import { GET as weeklyRoute } from '@/app/api/reports/absence-leave/weekly-print-pdf/route';
import { GET as compliance } from '@/app/api/reports/inspections/compliance/route';
import { GET as defects } from '@/app/api/reports/inspections/defects/route';
import { POST as bulkPdf } from '@/app/api/reports/inspections/bulk-pdf/route';
import { GET as plantUsage } from '@/app/api/reports/daily-allocation/plant-usage/route';
import { getPrintableAbsenceWeeklyReportData } from '@/lib/server/absence-weekly-print-report';

const api = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  canAccess: vi.fn(),
  canLevel: vi.fn(),
  scopeContext: vi.fn(),
  scopedProfiles: vi.fn(),
  timesheetScope: vi.fn(),
  plantRows: vi.fn(),
  hiddenIds: vi.fn(),
  secondary: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: api.getUser }, from: api.from })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => { throw new Error('admin read'); }),
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: api.canAccess,
  canEffectiveRoleUseModuleLevel: api.canLevel,
}));
vi.mock('@/lib/server/report-scope', () => ({
  getReportScopeContext: api.scopeContext,
  getScopedProfileIdsForModule: api.scopedProfiles,
}));
vi.mock('@/lib/server/reports-timesheet-scope', () => ({
  getTimesheetReportScopedProfileIds: api.timesheetScope,
  filterTimesheetRowsForReportScope: vi.fn(),
}));
vi.mock('@/lib/server/plant-usage-report', () => ({
  buildPlantUsageRows: api.plantRows,
  summarizePlantUsage: vi.fn(),
}));
vi.mock('@/lib/server/system-accounts', () => ({
  getReportHiddenProfileIds: api.hiddenIds,
  filterHiddenReportSubjects: (rows: unknown[]) => rows,
}));
vi.mock('@/lib/server/absence-secondary-permissions', () => ({
  getActorAbsenceSecondaryPermissions: api.secondary,
  canActorUseScopedAbsencePermission: vi.fn(),
}));
vi.mock('@/lib/server/work-shifts', () => ({ loadEmployeeWorkShiftPatternMap: vi.fn() }));
vi.mock('@/lib/utils/excel', () => ({
  generateExcelFile: vi.fn(),
  formatExcelDate: (value: unknown) => value,
  formatExcelHours: (value: unknown) => value,
  formatExcelStatus: (value: unknown) => value,
}));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: vi.fn() }));
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn(),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@/lib/pdf/van-inspection-pdf', () => ({ VanInspectionPDF: () => null }));
vi.mock('@/lib/pdf/plant-inspection-pdf', () => ({ PlantInspectionPDF: () => null }));
vi.mock('@/lib/pdf/hgv-inspection-pdf', () => ({ HgvInspectionPDF: () => null }));
vi.mock('pdf-lib', () => ({ PDFDocument: {} }));
vi.mock('jszip', () => ({ default: class JSZip {} }));

const range = 'dateFrom=2026-10-01&dateTo=2026-10-07';
const get = (path: string) => new NextRequest(`http://localhost${path}?${range}`);

function expectNoDataReads() {
  expect(api.from).not.toHaveBeenCalled();
  expect(api.scopeContext).not.toHaveBeenCalled();
  expect(api.scopedProfiles).not.toHaveBeenCalled();
  expect(api.timesheetScope).not.toHaveBeenCalled();
  expect(api.plantRows).not.toHaveBeenCalled();
  expect(api.hiddenIds).not.toHaveBeenCalled();
  expect(api.secondary).not.toHaveBeenCalled();
}

describe('report route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
    api.from.mockImplementation(() => { throw new Error('report data read'); });
    api.canAccess.mockResolvedValue(false);
    api.canLevel.mockResolvedValue(false);
    api.scopeContext.mockRejectedValue(new Error('scope read'));
    api.timesheetScope.mockRejectedValue(new Error('timesheet read'));
    api.plantRows.mockRejectedValue(new Error('plant read'));
    api.hiddenIds.mockRejectedValue(new Error('hidden profile read'));
    api.secondary.mockRejectedValue(new Error('secondary permission read'));
  });

  it.each([
    ['timesheet summary', 'reports', timesheetSummary, '/api/reports/timesheets/summary'],
    ['timesheet summary', 'timesheets', timesheetSummary, '/api/reports/timesheets/summary'],
    ['payroll', 'reports', payroll, '/api/reports/timesheets/payroll'],
    ['payroll', 'timesheets', payroll, '/api/reports/timesheets/payroll'],
    ['absence bookings', 'reports', bookings, '/api/reports/absence-leave/bookings'],
    ['absence bookings', 'absence', bookings, '/api/reports/absence-leave/bookings'],
    ['allowance totals', 'reports', allowance, '/api/reports/absence-leave/allowance-totals'],
    ['allowance totals', 'absence', allowance, '/api/reports/absence-leave/allowance-totals'],
  ])('denies %s before reading data when %s is closed', async (_label, denied, route, path) => {
    api.canAccess.mockImplementation(async (module: string) => module !== denied);
    const response = await route(get(path));
    expect(response.status).toBe(403);
    expectNoDataReads();
  });

  it('denies the weekly helper and route before absence data reads', async () => {
    api.canAccess.mockImplementation(async (module: string) => module !== 'absence');
    await expect(getPrintableAbsenceWeeklyReportData({ dateFrom: '2026-10-01', dateTo: '2026-10-07' })).rejects.toThrow('Forbidden');
    const response = await weeklyRoute(get('/api/reports/absence-leave/weekly-print-pdf'));
    expect(response.status).toBe(403);
    expectNoDataReads();

    api.canAccess.mockImplementation(async (module: string) => module !== 'reports');
    expect((await weeklyRoute(get('/api/reports/absence-leave/weekly-print-pdf'))).status).toBe(403);
    expectNoDataReads();
  });

  it('denies every daily-check report when none of the inspection modules are open', async () => {
    api.canAccess.mockImplementation(async (module: string) => module === 'reports');
    expect((await compliance(get('/api/reports/inspections/compliance'))).status).toBe(403);
    expect((await defects(get('/api/reports/inspections/defects'))).status).toBe(403);
    const bulk = await bulkPdf(new NextRequest('http://localhost/api/reports/inspections/bulk-pdf', {
      method: 'POST',
      body: JSON.stringify({ dateFrom: '2026-10-01', dateTo: '2026-10-07' }),
    }));
    expect(await bulk.text()).toContain('Forbidden');
    expectNoDataReads();
  });

  it('denies plant usage below Daily Allocation level 4 before reading rows', async () => {
    api.canAccess.mockImplementation(async (module: string) => module === 'reports');
    api.canLevel.mockImplementation(async (module: string, level: number) => !(module === 'daily-allocation' && level === 4));
    const response = await plantUsage(get('/api/reports/daily-allocation/plant-usage'));
    expect(response.status).toBe(403);
    expect(api.canLevel).toHaveBeenCalledWith('daily-allocation', 4);
    expectNoDataReads();
  });
});
