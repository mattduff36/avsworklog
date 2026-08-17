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

  it.each(['approved', 'processed', 'adjusted'])(
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
