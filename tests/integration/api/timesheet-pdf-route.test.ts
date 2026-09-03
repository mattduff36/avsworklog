import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  renderToStream: vi.fn(),
  timesheetPdf: vi.fn(),
  plantTimesheetPdf: vi.fn(),
  shouldUsePlantTemplate: vi.fn(),
  canAccessModule: vi.fn(),
  filterReportScope: vi.fn(),
  loadShiftPatterns: vi.fn(),
  logServerError: vi.fn(),
  previewTimesheetPayroll: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@react-pdf/renderer', () => ({
  renderToStream: mocks.renderToStream,
}));
vi.mock('@/lib/pdf/timesheet-pdf', () => ({
  TimesheetPDF: mocks.timesheetPdf,
}));
vi.mock('@/lib/pdf/plant-timesheet-v2-pdf', () => ({
  PlantTimesheetV2PDF: mocks.plantTimesheetPdf,
}));
vi.mock('@/lib/pdf/timesheet-template-selector', () => ({
  shouldUsePlantTimesheetV2Template: mocks.shouldUsePlantTemplate,
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mocks.canAccessModule,
}));
vi.mock('@/lib/server/reports-timesheet-scope', () => ({
  filterTimesheetRowsForReportScope: mocks.filterReportScope,
}));
vi.mock('@/lib/server/work-shifts', () => ({
  loadEmployeeWorkShiftPatternMap: mocks.loadShiftPatterns,
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mocks.logServerError,
}));
vi.mock('@/lib/server/timesheet-payroll', () => ({
  previewTimesheetPayroll: mocks.previewTimesheetPayroll,
}));

import { GET } from '@/app/api/timesheets/[id]/pdf/route';

const TIMESHEET_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

interface RouteFixture {
  status?: string;
  weekEnding?: string;
  rolloutApplies?: boolean;
  rolloutError?: Error | null;
  snapshot?: Record<string, unknown> | null;
  snapshotId?: string | null;
  actorId?: string;
  canAccess?: boolean;
}

function singleResult(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  };
}

function setupRoute(fixture: RouteFixture = {}) {
  const status = fixture.status ?? 'submitted';
  const weekEnding = fixture.weekEnding ?? '2026-08-16';
  const actorId = fixture.actorId ?? EMPLOYEE_ID;
  const snapshotId = fixture.snapshotId === undefined
    ? (fixture.snapshot ? SNAPSHOT_ID : null)
    : fixture.snapshotId;
  const target = {
    id: TIMESHEET_ID,
    user_id: EMPLOYEE_ID,
    week_ending: weekEnding,
    employee: { team_id: 'transport' },
  };
  const hydrated = {
    id: TIMESHEET_ID,
    user_id: EMPLOYEE_ID,
    week_ending: weekEnding,
    status,
    current_payroll_snapshot_id: snapshotId,
    current_payroll_snapshot: fixture.snapshot ?? null,
    entries: [],
  };

  const authenticatedFrom = vi.fn((table: string) => {
    if (table === 'timesheets') return singleResult(target);
    if (table === 'profiles') return singleResult({ full_name: 'Test Employee' });
    if (table === 'absences') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              lte: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected authenticated table: ${table}`);
  });
  const rolloutLimit = vi.fn().mockResolvedValue({
    data: fixture.rolloutApplies === false ? [] : [{ id: 'rollout-id' }],
    error: fixture.rolloutError ?? null,
  });
  const adminFrom = vi.fn((table: string) => {
    if (table === 'timesheets') return singleResult(hydrated);
    if (table === 'payroll_rollout_activations') {
      return {
        select: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            limit: rolloutLimit,
          }),
        }),
      };
    }
    if (table === 'timesheet_payroll_edits') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected admin table: ${table}`);
  });

  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: actorId } },
        error: null,
      }),
    },
    from: authenticatedFrom,
  });
  mocks.createAdminClient.mockReturnValue({ from: adminFrom });
  mocks.canAccessModule.mockResolvedValue(fixture.canAccess ?? false);

  return { adminFrom, rolloutLimit };
}

async function requestPdf() {
  return GET(
    new NextRequest(`http://localhost/api/timesheets/${TIMESHEET_ID}/pdf`),
    { params: Promise.resolve({ id: TIMESHEET_ID }) }
  );
}

describe('GET /api/timesheets/[id]/pdf payroll snapshot policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shouldUsePlantTemplate.mockReturnValue(false);
    mocks.timesheetPdf.mockReturnValue({ type: 'mock-pdf' });
    mocks.loadShiftPatterns.mockResolvedValue(new Map());
    mocks.filterReportScope.mockResolvedValue([]);
    mocks.logServerError.mockResolvedValue(undefined);
    mocks.renderToStream.mockResolvedValue((async function* () {
      yield Buffer.from('%PDF-test');
    })());
    mocks.previewTimesheetPayroll.mockResolvedValue({ legacy: true, breakdown: null });
  });

  it('PAY-PDF-SUBMITTED-001 prints a submitted post-cutover sheet without a snapshot', async () => {
    setupRoute({ status: 'submitted' });

    const response = await requestPdf();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(mocks.timesheetPdf).toHaveBeenCalledWith(
      expect.objectContaining({ payrollSnapshot: null })
    );
    expect(mocks.renderToStream).toHaveBeenCalledOnce();
  });

  it.each(['approved', 'processed'])(
    'PAY-PDF-PROTECTED-001 blocks a post-cutover %s sheet without a snapshot',
    async (status) => {
      setupRoute({ status });

      const response = await requestPdf();

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'This post-cutover timesheet has no payroll snapshot. PDF generation is blocked.',
      });
      expect(mocks.renderToStream).not.toHaveBeenCalled();
    }
  );

  it.each(['draft', 'rejected'])(
    'PAY-PDF-NONPRINTABLE-001 keeps post-cutover %s sheets blocked',
    async (status) => {
      setupRoute({ status });

      const response = await requestPdf();

      expect(response.status).toBe(409);
      expect(mocks.renderToStream).not.toHaveBeenCalled();
    }
  );

  it('PAY-PDF-PRECUTOVER-001 preserves snapshotless pre-cutover PDF generation', async () => {
    setupRoute({ status: 'approved', weekEnding: '2026-08-09', rolloutApplies: false });

    const response = await requestPdf();

    expect(response.status).toBe(200);
    expect(mocks.timesheetPdf).toHaveBeenCalledWith(
      expect.objectContaining({ payrollSnapshot: null })
    );
  });

  it('PAY-PDF-ROLLOUT-FAIL-001 fails closed when rollout lookup fails', async () => {
    setupRoute({ rolloutError: new Error('rollout unavailable') });

    const response = await requestPdf();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to verify payroll rollout configuration',
    });
    expect(mocks.renderToStream).not.toHaveBeenCalled();
  });

  it('PAY-PDF-PREVIEW-001 prints the on-screen provisional breakdown for submitted sheets', async () => {
    mocks.previewTimesheetPayroll.mockResolvedValue({
      legacy: false,
      breakdown: {
        ruleSetKey: 'civils',
        weekEnding: '2026-08-16',
        basicMinutes: 2400,
        overtimeMinutes: 120,
        doubleTimeMinutes: 0,
        payableMinutes: 2520,
        paidLeaveUnits: 0,
        unpaidLeaveUnits: 0,
        operatorTravelMinutes: 0,
        iprUnits: 0,
        subsistenceDays: 0,
        subsistenceDayNames: [],
        days: [],
      },
    });
    setupRoute({ status: 'submitted' });

    const response = await requestPdf();

    expect(response.status).toBe(200);
    expect(mocks.previewTimesheetPayroll).toHaveBeenCalledOnce();
    expect(mocks.timesheetPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        payrollSnapshot: expect.objectContaining({
          kind: 'provisional',
          basic_minutes: 2400,
          overtime_minutes: 120,
          rule_set: { name: 'Civils' },
        }),
      })
    );
  });

  it('PAY-PDF-REAPPROVAL-001 prints the on-screen reapproval breakdown for adjusted sheets', async () => {
    mocks.previewTimesheetPayroll.mockResolvedValue({
      legacy: false,
      breakdown: {
        ruleSetKey: 'plant',
        weekEnding: '2026-08-16',
        basicMinutes: 1920,
        overtimeMinutes: 180,
        doubleTimeMinutes: 60,
        payableMinutes: 2160,
        paidLeaveUnits: 0,
        unpaidLeaveUnits: 0,
        operatorTravelMinutes: 90,
        iprUnits: 0.8,
        subsistenceDays: 0,
        subsistenceDayNames: [],
        days: [],
      },
    });
    setupRoute({ status: 'adjusted' });

    const response = await requestPdf();

    expect(response.status).toBe(200);
    expect(mocks.previewTimesheetPayroll).toHaveBeenCalledOnce();
    expect(mocks.timesheetPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        payrollSnapshot: expect.objectContaining({
          kind: 'reapproval',
          basic_minutes: 1920,
          overtime_minutes: 180,
          operator_travel_minutes: 90,
          rule_set: { name: 'Plant' },
        }),
      })
    );
  });

  it('PAY-PDF-REAPPROVAL-002 prefers the live reapproval preview over a retained snapshot', async () => {
    mocks.previewTimesheetPayroll.mockResolvedValue({
      legacy: false,
      breakdown: {
        ruleSetKey: 'plant',
        weekEnding: '2026-08-16',
        basicMinutes: 1980,
        overtimeMinutes: 240,
        doubleTimeMinutes: 0,
        payableMinutes: 2220,
        paidLeaveUnits: 0,
        unpaidLeaveUnits: 0,
        operatorTravelMinutes: 120,
        iprUnits: 1,
        subsistenceDays: 1,
        subsistenceDayNames: ['Mon'],
        days: [],
      },
    });
    const snapshot = {
      id: SNAPSHOT_ID,
      timesheet_id: TIMESHEET_ID,
      revision: 1,
      basic_minutes: 2400,
      overtime_minutes: 0,
      double_time_minutes: 0,
      paid_leave_units: 0,
      unpaid_leave_units: 0,
      operator_travel_minutes: 0,
      ipr_units: 0,
      subsistence_days: 0,
      subsistence_day_names: [],
      rule_set: { name: 'Plant' },
    };
    setupRoute({ status: 'adjusted', snapshot });

    const response = await requestPdf();

    expect(response.status).toBe(200);
    expect(mocks.previewTimesheetPayroll).toHaveBeenCalledOnce();
    expect(mocks.timesheetPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        payrollSnapshot: expect.objectContaining({
          kind: 'reapproval',
          basic_minutes: 1980,
          overtime_minutes: 240,
          operator_travel_minutes: 120,
          rule_set: { name: 'Plant' },
        }),
      })
    );
  });

  it('PAY-PDF-SNAPSHOT-001 passes a valid immutable snapshot to the renderer', async () => {
    const snapshot = {
      id: SNAPSHOT_ID,
      timesheet_id: TIMESHEET_ID,
      revision: 1,
      basic_minutes: 2400,
      overtime_minutes: 120,
      double_time_minutes: 0,
      paid_leave_units: 0,
      unpaid_leave_units: 0,
      operator_travel_minutes: 0,
      ipr_units: 0,
      subsistence_days: 0,
      subsistence_day_names: [],
      rule_set: { name: 'Lorries' },
    };
    const { adminFrom, rolloutLimit } = setupRoute({ status: 'approved', snapshot });

    const response = await requestPdf();

    expect(response.status).toBe(200);
    expect(mocks.timesheetPdf).toHaveBeenCalledWith(
      expect.objectContaining({ payrollSnapshot: snapshot })
    );
    expect(mocks.previewTimesheetPayroll).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalledWith('payroll_rollout_activations');
    expect(rolloutLimit).not.toHaveBeenCalled();
  });

  it('PAY-PDF-SNAPSHOT-OWNERSHIP-001 rejects a snapshot belonging to another timesheet', async () => {
    setupRoute({
      status: 'approved',
      snapshot: {
        id: SNAPSHOT_ID,
        timesheet_id: '44444444-4444-4444-8444-444444444444',
      },
    });

    const response = await requestPdf();

    expect(response.status).toBe(409);
    expect(mocks.renderToStream).not.toHaveBeenCalled();
  });

  it('PAY-PDF-AUTH-SCOPE-001 denies scope before elevated timesheet hydration', async () => {
    const { adminFrom } = setupRoute({
      actorId: '55555555-5555-4555-8555-555555555555',
      canAccess: false,
    });

    const response = await requestPdf();

    expect(response.status).toBe(403);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(mocks.renderToStream).not.toHaveBeenCalled();
  });
});
