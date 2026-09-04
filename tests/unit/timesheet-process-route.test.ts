import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/timesheets/[id]/process/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { applyTimesheetManagerApproved } from '@/lib/server/timesheet-gate-mutations';
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
vi.mock('@/lib/server/timesheet-gate-mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/timesheet-gate-mutations')>();
  return {
    ...actual,
    applyTimesheetManagerApproved: vi.fn(),
  };
});
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));

const TIMESHEET_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';

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

function mockAuth(userId: string | null, authError: Error | null = null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue(
        userId
          ? mockSupabaseAuthUser({ id: userId })
          : { data: { user: null }, error: authError ?? new Error('Auth session missing') }
      ),
    },
  } as unknown as SupabaseClient);
}

function mockTimesheet(ownerId = EMPLOYEE_ID, teamId = 'team-ops', status = 'submitted') {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: TIMESHEET_ID,
              user_id: ownerId,
              status,
              employee: { team_id: teamId },
            },
            error: null,
          }),
        }),
      }),
    })),
  } as never);
}

function mockPermissions(actor: EffectiveRoleInfo, effective = getAbsenceSecondaryDefaultMap(
  actor.role_name === 'admin'
    ? 'admin'
    : actor.role_name === 'manager'
      ? 'manager'
      : actor.role_name === 'supervisor'
        ? 'supervisor'
        : 'employee'
)) {
  vi.mocked(getEffectiveRole).mockResolvedValue(actor);
  vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
    user_id: actor.user_id!,
    team_id: actor.team_id,
    team_name: actor.team_name,
    role_name: actor.role_name,
    role_display_name: actor.display_name,
    role_tier:
      actor.role_name === 'admin'
        ? 'admin'
        : actor.role_name === 'manager'
          ? 'manager'
          : actor.role_name === 'supervisor'
            ? 'supervisor'
            : 'employee',
    defaults: getAbsenceSecondaryDefaultMap('employee'),
    effective,
    overrides: createNullAbsenceSecondaryOverrideRecord(),
    has_exception_row: false,
  });
}

function processRequest(body: Record<string, unknown> = { expected_status: 'submitted' }) {
  return new Request(`http://localhost/api/timesheets/${TIMESHEET_ID}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

async function postProcess(body?: Record<string, unknown>) {
  return POST(processRequest(body), { params: Promise.resolve({ id: TIMESHEET_ID }) });
}

describe('POST /api/timesheets/[id]/process', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.mocked(getEffectiveModuleAccessLevel).mockResolvedValue(3);
    vi.mocked(applyTimesheetManagerApproved).mockResolvedValue({
      alreadyProcessed: false,
      status: 'manager_approved',
    });
  });

  it('TS-PROC-MANAGER-ALLOW-001 TS-PROC-MUTATE-MANAGER-GATE-001 TS-PROC-AUDIT-001 allows a scoped manager', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet();
    mockPermissions(role());

    const response = await postProcess();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      alreadyProcessed: false,
      status: 'manager_approved',
    });
    expect(applyTimesheetManagerApproved).toHaveBeenCalledTimes(1);
    expect(applyTimesheetManagerApproved).toHaveBeenCalledWith({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      expectedStatus: 'submitted',
    });
  });

  it('TS-PROC-REGRESSION-001 completes when Payroll Received is already set', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet(EMPLOYEE_ID, 'team-ops', 'approved');
    mockPermissions(role());
    vi.mocked(applyTimesheetManagerApproved).mockResolvedValue({
      alreadyProcessed: false,
      status: 'processed',
    });

    const response = await postProcess({ expected_status: 'approved' });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('processed');
    expect(applyTimesheetManagerApproved).toHaveBeenCalledWith(
      expect.objectContaining({ expectedStatus: 'approved', actorId: ACTOR_ID })
    );
  });

  it('TS-PROC-EMPLOYEE-DENY-001 rejects an ordinary employee', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet();
    mockPermissions(
      role({
        role_name: 'employee',
        role_class: 'employee',
        display_name: 'Employee',
        is_manager_admin: false,
      }),
      getAbsenceSecondaryDefaultMap('employee')
    );

    const response = await postProcess();
    expect(response.status).toBe(403);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();
  });

  it('TS-PROC-ACCOUNTS-DENY-001 TS-PROC-UI-BYPASS-001 TS-PROC-REJECT-NO-MUTATE-001 rejects Accounts manager/supervisor', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet();
    mockPermissions(
      role({
        role_name: 'manager',
        team_id: 'team-accounts',
        team_name: 'Accounts',
      })
    );

    let response = await postProcess();
    expect(response.status).toBe(403);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();

    mockPermissions(
      role({
        role_name: 'supervisor',
        role_class: 'employee',
        team_id: 'team-accounts',
        team_name: 'Accounts',
      })
    );
    response = await postProcess();
    expect(response.status).toBe(403);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();
  });

  it('TS-PROC-ADMIN-ALLOW-001 allows admin, including on Accounts', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet(EMPLOYEE_ID, 'team-other');
    mockPermissions(
      role({
        role_name: 'admin',
        role_class: 'admin',
        is_super_admin: true,
        team_name: 'Accounts',
        team_id: 'team-accounts',
      })
    );

    const response = await postProcess();
    expect(response.status).toBe(200);
    expect(applyTimesheetManagerApproved).toHaveBeenCalledTimes(1);
  });

  it('TS-PROC-UNAUTH-001 TS-PROC-SESSION-001 reject missing auth and missing effective user', async () => {
    mockAuth(null);
    mockTimesheet();
    mockPermissions(role());

    let response = await postProcess();
    expect(response.status).toBe(401);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();

    mockAuth(ACTOR_ID);
    vi.mocked(getEffectiveRole).mockResolvedValue(role({ user_id: null }));
    response = await postProcess();
    expect(response.status).toBe(401);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();
  });

  it('TS-PROC-SCOPE-001 rejects self and out-of-team scope', async () => {
    mockAuth(EMPLOYEE_ID);
    mockTimesheet(EMPLOYEE_ID);
    mockPermissions(role({ user_id: EMPLOYEE_ID }));

    let response = await postProcess();
    expect(response.status).toBe(403);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();

    mockAuth(ACTOR_ID);
    mockTimesheet(EMPLOYEE_ID, 'team-b');
    mockPermissions(role());
    response = await postProcess();
    expect(response.status).toBe(403);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();
  });

  it('TS-PROC-CLIENT-IDENTITY-001 ignores client-supplied identity', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet();
    mockPermissions(role());

    const response = await postProcess({
      expected_status: 'submitted',
      user_id: EMPLOYEE_ID,
      role: 'admin',
      is_admin: true,
    });
    expect(response.status).toBe(200);
    expect(applyTimesheetManagerApproved).toHaveBeenCalledWith({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      expectedStatus: 'submitted',
    });
  });

  it('TS-PROC-COMPLETE-001 returns idempotent already-processed without changing the contract', async () => {
    mockAuth(ACTOR_ID);
    mockTimesheet(EMPLOYEE_ID, 'team-ops', 'processed');
    mockPermissions(role());
    vi.mocked(applyTimesheetManagerApproved).mockResolvedValue({
      alreadyProcessed: true,
      status: 'processed',
    });

    const response = await postProcess({ expected_status: 'processed' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      alreadyProcessed: true,
      status: 'processed',
    });
    expect(applyTimesheetManagerApproved).toHaveBeenCalledTimes(1);
  });

  it('TS-PROC-ACCOUNTS-EMPLOYEE-001 matches shipped UI residual for Accounts employees', async () => {
    const accountsEmployee = role({
      role_name: 'employee',
      role_class: 'employee',
      display_name: 'Employee',
      is_manager_admin: false,
      team_id: 'team-accounts',
      team_name: 'Accounts',
    });
    mockAuth(ACTOR_ID);
    mockTimesheet(EMPLOYEE_ID, 'team-accounts');
    mockPermissions(accountsEmployee, {
      ...getAbsenceSecondaryDefaultMap('employee'),
      authorise_bookings_team: true,
    });

    let response = await postProcess();
    expect(response.status).toBe(200);
    expect(applyTimesheetManagerApproved).toHaveBeenCalledTimes(1);

    vi.mocked(applyTimesheetManagerApproved).mockClear();
    mockPermissions(accountsEmployee, getAbsenceSecondaryDefaultMap('employee'));
    response = await postProcess();
    expect(response.status).toBe(403);
    expect(applyTimesheetManagerApproved).not.toHaveBeenCalled();
  });

  it('TS-PROC-PAYROLL-INDEPENDENT-001 keeps Payroll Received on /approve', () => {
    const processRoute = readFileSync(
      resolve(process.cwd(), 'app/api/timesheets/[id]/process/route.ts'),
      'utf8'
    );
    const approveRoute = readFileSync(
      resolve(process.cwd(), 'app/api/timesheets/[id]/approve/route.ts'),
      'utf8'
    );
    expect(processRoute).toContain('canCurrentActorMarkTimesheetManagerApproved');
    expect(processRoute).toContain('applyTimesheetManagerApproved');
    expect(processRoute).not.toContain('canCurrentActorMarkTimesheetPayrollReceived');
    expect(processRoute).not.toContain('approveTimesheetWithPayrollSnapshot');
    expect(approveRoute).toContain('canCurrentActorMarkTimesheetPayrollReceived');
    expect(approveRoute).toContain('canCurrentActorAuthoriseTimesheetTarget');
  });
});
