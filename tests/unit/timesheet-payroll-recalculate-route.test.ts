import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/timesheets/[id]/payroll-recalculate/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { applyTimesheetPayrollRecalculate } from '@/lib/server/timesheet-payroll-recalculate';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole, type EffectiveRoleInfo } from '@/lib/utils/view-as';
import {
  createNullAbsenceSecondaryOverrideRecord,
  getAbsenceSecondaryDefaultMap,
} from '@/types/absence-permissions';
import { mockSupabaseAuthUser, resetAllMocks } from '../utils/test-helpers';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/server/absence-secondary-permissions', () => ({
  getActorAbsenceSecondaryPermissions: vi.fn(),
}));
vi.mock('@/lib/utils/rbac', () => ({
  getEffectiveModuleAccessLevel: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/server/timesheet-payroll-recalculate', () => ({
  applyTimesheetPayrollRecalculate: vi.fn(),
  TimesheetPayrollRecalculateError: class TimesheetPayrollRecalculateError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'TimesheetPayrollRecalculateError';
    }
  },
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));

const TIMESHEET_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

function role(overrides: Partial<EffectiveRoleInfo> = {}): EffectiveRoleInfo {
  return {
    user_id: ACTOR_ID,
    role_id: 'role-1',
    role_name: 'manager',
    role_class: 'manager',
    display_name: 'Manager',
    is_manager_admin: true,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    team_id: 'team-ops',
    team_name: 'Operations',
    ...overrides,
  };
}

function mockAuth(userId: string) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue(mockSupabaseAuthUser({ id: userId })),
    },
  } as unknown as SupabaseClient);
}

function mockTimesheet(ownerId = EMPLOYEE_ID) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: TIMESHEET_ID,
              user_id: ownerId,
              employee: { team_id: 'team-ops' },
            },
            error: null,
          }),
        }),
      }),
    })),
  } as never);
}

function recalculateRequest(overrides: Record<string, unknown> = {}) {
  return new Request(`http://localhost/api/timesheets/${TIMESHEET_ID}/payroll-recalculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: 'Apply Plant override from rollout',
      idempotency_key: IDEMPOTENCY_KEY,
      expected_status: 'processed',
      expected_updated_at: '2026-09-03T12:00:00.000Z',
      expected_snapshot_id: SNAPSHOT_ID,
      ...overrides,
    }),
  }) as NextRequest;
}

describe('POST /api/timesheets/[id]/payroll-recalculate', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.mocked(getEffectiveModuleAccessLevel).mockResolvedValue(3);
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: ACTOR_ID,
      team_id: 'team-ops',
      team_name: 'Operations',
      role_name: 'manager',
      role_display_name: 'Manager',
      role_tier: 'manager',
      defaults: getAbsenceSecondaryDefaultMap('manager'),
      effective: getAbsenceSecondaryDefaultMap('manager'),
      overrides: createNullAbsenceSecondaryOverrideRecord(),
      has_exception_row: false,
    });
    vi.mocked(applyTimesheetPayrollRecalculate).mockResolvedValue({
      status: 'approved',
      payImpact: true,
      noop: false,
      beforeHash: 'a',
      afterHash: 'b',
      snapshotId: SNAPSHOT_ID,
      notificationUserIds: [],
    });
  });

  it('PAY-RECALC-AUTH-001 returns 403 for team manager, View As, and self; 200 for Accounts and Admin', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet();

    vi.mocked(getEffectiveRole).mockResolvedValue(role());
    let response = await POST(recalculateRequest(), { params: Promise.resolve({ id: TIMESHEET_ID }) });
    expect(response.status).toBe(403);
    expect(applyTimesheetPayrollRecalculate).not.toHaveBeenCalled();

    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        is_viewing_as: true,
        is_actual_super_admin: true,
        role_name: 'manager',
        team_name: 'Operations',
      })
    );
    response = await POST(recalculateRequest(), { params: Promise.resolve({ id: TIMESHEET_ID }) });
    expect(response.status).toBe(403);

    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        is_viewing_as: true,
        is_actual_super_admin: true,
        role_name: 'manager',
        team_name: 'Accounts',
      })
    );
    response = await POST(recalculateRequest(), { params: Promise.resolve({ id: TIMESHEET_ID }) });
    expect(response.status).toBe(403);

    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        is_viewing_as: true,
        is_actual_super_admin: true,
        is_super_admin: true,
        role_name: 'admin',
        team_name: 'Office',
      })
    );
    response = await POST(recalculateRequest(), { params: Promise.resolve({ id: TIMESHEET_ID }) });
    expect(response.status).toBe(403);

    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        user_id: EMPLOYEE_ID,
        role_name: 'manager',
        team_name: 'Accounts',
      })
    );
    mockAuth(EMPLOYEE_ID);
    mockTimesheet(EMPLOYEE_ID);
    response = await POST(recalculateRequest(), { params: Promise.resolve({ id: TIMESHEET_ID }) });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('own timesheet');

    mockAuth(ACTOR_ID);
    mockTimesheet();
    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        role_name: 'manager',
        team_name: 'Accounts',
      })
    );
    response = await POST(recalculateRequest(), { params: Promise.resolve({ id: TIMESHEET_ID }) });
    expect(response.status).toBe(200);
    expect(applyTimesheetPayrollRecalculate).toHaveBeenCalledTimes(1);

    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        is_super_admin: true,
        is_actual_super_admin: true,
        role_name: 'admin',
        team_name: 'Office',
      })
    );
    response = await POST(recalculateRequest(), { params: Promise.resolve({ id: TIMESHEET_ID }) });
    expect(response.status).toBe(200);
    expect(applyTimesheetPayrollRecalculate).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed expected_updated_at before any write', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet();
    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        role_name: 'manager',
        team_name: 'Accounts',
      })
    );
    const response = await POST(
      recalculateRequest({ expected_updated_at: 'next Tuesday' }),
      { params: Promise.resolve({ id: TIMESHEET_ID }) }
    );
    expect(response.status).toBe(400);
    expect(applyTimesheetPayrollRecalculate).not.toHaveBeenCalled();
  });

  it('rejects unknown request fields', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet();
    vi.mocked(getEffectiveRole).mockResolvedValue(
      role({
        role_name: 'manager',
        team_name: 'Accounts',
      })
    );
    const response = await POST(
      recalculateRequest({ client_pay_impact: true }),
      { params: Promise.resolve({ id: TIMESHEET_ID }) }
    );
    expect(response.status).toBe(400);
    expect(applyTimesheetPayrollRecalculate).not.toHaveBeenCalled();
  });
});
