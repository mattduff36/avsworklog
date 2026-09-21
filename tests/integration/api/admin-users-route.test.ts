import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { POST } from '@/app/api/admin/users/route';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/utils/password', () => ({
  generateSecurePassword: vi.fn(() => 'TempPass123!'),
}));
vi.mock('@/lib/utils/email', () => ({
  sendPasswordEmail: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: vi.fn(),
  canEffectiveRoleAssignRole: vi.fn(),
}));
vi.mock('@/lib/server/admin-users-module-access', () => ({
  requireAdminUsersModuleAccess: vi.fn(),
}));
vi.mock('@/lib/server/team-managers', () => ({
  reconcileProfileHierarchy: vi.fn(),
  isMissingTeamManagerSchemaError: vi.fn(() => false),
}));
vi.mock('@/lib/server/work-shifts', () => ({
  applyTemplateToProfiles: vi.fn(),
}));
vi.mock('@/lib/services/absence-bank-holiday-sync', () => ({
  buildFinancialYearBounds: vi.fn(() => ({
    start: new Date('2025-04-01T00:00:00Z'),
    end: new Date('2026-03-31T00:00:00Z'),
    label: '2025/26',
  })),
  getFinancialYearStartYear: vi.fn(() => 2025),
  seedRemainingFinancialYearBankHolidaysForProfiles: vi.fn(),
  replayBulkAbsenceBatchesForProfile: vi.fn(),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

type AdminRouteOptions = {
  employeeIdOwner?: { id: string } | null;
  employeeIdLookupError?: { message: string } | null;
  profileUpsertError?: { code?: string; message: string; details?: string } | null;
  createUserError?: { code?: string; message: string } | null;
  deleteUserError?: { message: string } | null;
  roleId?: string;
  roleName?: string;
  roleDisplayName?: string;
};

function createMockSupabaseAdmin(options: AdminRouteOptions = {}) {
  const createUser = vi.fn().mockResolvedValue(
    options.createUserError
      ? { data: { user: null }, error: options.createUserError }
      : {
          data: { user: { id: 'new-user-1', email: 'new.user@example.com' } },
          error: null,
        }
  );
  const deleteUser = vi.fn().mockResolvedValue({ error: options.deleteUserError ?? null });

  return {
    auth: {
      admin: {
        createUser,
        deleteUser,
      },
    },
    from(table: string) {
      if (table === 'roles') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return {
                      data: {
                        id: options.roleId || 'role-employee',
                        name: options.roleName || 'employee',
                        display_name: options.roleDisplayName || 'Employee',
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'org_teams') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return {
                      data: {
                        id: 'team-civils',
                        manager_1_profile_id: 'manager-1',
                        manager_2_profile_id: null,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'work_shift_templates') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { id: 'template-standard' }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'profiles') {
        return {
          select() {
            return {
              eq(column: string) {
                if (column === 'employee_id') {
                  return {
                    async maybeSingle() {
                      return {
                        data: options.employeeIdOwner ?? null,
                        error: options.employeeIdLookupError ?? null,
                      };
                    },
                    neq() {
                      return {
                        async maybeSingle() {
                          return {
                            data: options.employeeIdOwner ?? null,
                            error: options.employeeIdLookupError ?? null,
                          };
                        },
                      };
                    },
                  };
                }
                return {
                  async single() {
                    return { data: { id: 'manager-1', role: { role_class: 'manager' } }, error: null };
                  },
                };
              },
            };
          },
          async upsert() {
            return { error: options.profileUpsertError ?? null };
          },
        };
      }

      if (table === 'absence_allowance_carryovers') {
        return {
          async upsert() {
            return { error: null };
          },
        };
      }

      if (table === 'absence_bulk_batches') {
        return {
          select() {
            return {
              async in() {
                return { data: [], error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    email: 'new.user@example.com',
    full_name: 'New User',
    phone_number: '07000 000000',
    employee_id: 'E123',
    role_id: 'role-employee',
    team_id: 'team-civils',
    work_shift_template_id: 'template-standard',
    annual_allowance_days: 28,
    remaining_leave_days: 10,
    auto_book_bank_holidays: true,
    auto_apply_bulk_bookings: false,
    selected_bulk_batch_ids: [],
    ...overrides,
  };
}

describe('POST /api/admin/users', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createClient } = await import('@supabase/supabase-js');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule, canEffectiveRoleAssignRole } = await import('@/lib/utils/rbac');
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    const { reconcileProfileHierarchy } = await import('@/lib/server/team-managers');
    const { sendPasswordEmail } = await import('@/lib/utils/email');
    const { applyTemplateToProfiles } = await import('@/lib/server/work-shifts');
    const { seedRemainingFinancialYearBankHolidaysForProfiles, replayBulkAbsenceBatchesForProfile } =
      await import('@/lib/services/absence-bank-holiday-sync');

    vi.mocked(createClient).mockReturnValue(createMockSupabaseAdmin() as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'admin-1',
      role_name: 'admin',
      is_super_admin: true,
    } as never);
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(null);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(canEffectiveRoleAssignRole).mockResolvedValue(true);
    vi.mocked(reconcileProfileHierarchy).mockResolvedValue({ affected_team_ids: [] });
    vi.mocked(sendPasswordEmail).mockResolvedValue({ success: true });
    vi.mocked(applyTemplateToProfiles).mockResolvedValue({ affectedProfiles: 1, recalculatedAbsences: 0 });
    vi.mocked(seedRemainingFinancialYearBankHolidaysForProfiles).mockResolvedValue({
      financialYearStartYear: 2025,
      financialYearLabel: '2025/26',
      bankHolidayCount: 5,
      employeeCount: 1,
      created: 2,
      skippedExisting: 0,
    });
    vi.mocked(replayBulkAbsenceBatchesForProfile).mockResolvedValue({
      selectedBatchCount: 0,
      appliedBatchCount: 0,
      skippedOutOfRangeCount: 0,
      totalCreatedCount: 0,
      totalDuplicateCount: 0,
      totalConflictingWorkingDaysSkipped: 0,
      warningCount: 0,
      warnings: [],
      conflicts: [],
      appliedBatchIds: [],
    });
  });

  it('returns 400 when team is missing from onboarding payload', async () => {
    const request = new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'new.user@example.com',
        full_name: 'New User',
        role_id: 'role-employee',
        work_shift_template_id: 'template-standard',
        annual_allowance_days: 28,
        remaining_leave_days: 12,
        auto_book_bank_holidays: true,
        auto_apply_bulk_bookings: false,
        selected_bulk_batch_ids: [],
      }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Team is required');
  });

  it('requires unlocked admin-users sensitive access before creating a user', async () => {
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(
      NextResponse.json(
        { error: 'Sensitive access PIN required for protected modules.', code: 'SENSITIVE_PIN_REQUIRED' },
        { status: 428 }
      )
    );

    const request = new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(428);
    expect(payload.code).toBe('SENSITIVE_PIN_REQUIRED');
  });

  it('creates a user when all mandatory onboarding fields are provided', async () => {
    const request = new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'new.user@example.com',
        full_name: 'New User',
        phone_number: '07000 000000',
        employee_id: 'E123',
        role_id: 'role-employee',
        team_id: 'team-civils',
        work_shift_template_id: 'template-standard',
        annual_allowance_days: 28,
        remaining_leave_days: 10,
        auto_book_bank_holidays: true,
        auto_apply_bulk_bookings: false,
        selected_bulk_batch_ids: [],
      }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();
    const { seedRemainingFinancialYearBankHolidaysForProfiles } = await import(
      '@/lib/services/absence-bank-holiday-sync'
    );

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user.team_id).toBe('team-civils');
    expect(payload.user.work_shift_template_id).toBe('template-standard');
    expect(seedRemainingFinancialYearBankHolidaysForProfiles).toHaveBeenCalled();
  });

  it('EMP-AUTH-001 keeps unauthenticated and forbidden create paths fail-closed', async () => {
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: null,
    } as never);

    const unauthorized = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(validCreateBody()),
    }) as NextRequest);
    expect(unauthorized.status).toBe(401);

    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'admin-1',
      role_name: 'admin',
      is_super_admin: true,
    } as never);
    const { canEffectiveRoleAssignRole } = await import('@/lib/utils/rbac');
    vi.mocked(canEffectiveRoleAssignRole).mockResolvedValue(false);

    const forbidden = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(validCreateBody()),
    }) as NextRequest);
    expect(forbidden.status).toBe(403);
  });

  it('EMP-ID-001 rejects active and soft-deleted owners before Auth creation', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createMockSupabaseAdmin({ employeeIdOwner: { id: 'deleted-owner' } });
    vi.mocked(createClient).mockReturnValue(admin as never);

    const response = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(validCreateBody({ employee_id: ' E123 ' })),
    }) as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('DUPLICATE_EMPLOYEE_ID');
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('EMP-ID-002 maps Auth-trigger and profile-write employee-ID races to 409 after rollback', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const authConflict = createMockSupabaseAdmin({
      createUserError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_employee_id_key"',
      },
    });
    vi.mocked(createClient).mockReturnValue(authConflict as never);

    const authResponse = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(validCreateBody()),
    }) as NextRequest);
    expect(authResponse.status).toBe(409);
    expect((await authResponse.json()).code).toBe('DUPLICATE_EMPLOYEE_ID');

    const profileConflict = createMockSupabaseAdmin({
      profileUpsertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_employee_id_key"',
      },
    });
    vi.mocked(createClient).mockReturnValue(profileConflict as never);

    const profileResponse = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(validCreateBody()),
    }) as NextRequest);
    const profilePayload = await profileResponse.json();

    expect(profileResponse.status).toBe(409);
    expect(profilePayload.code).toBe('DUPLICATE_EMPLOYEE_ID');
    expect(profileConflict.auth.admin.deleteUser).toHaveBeenCalledWith('new-user-1');
  });

  it('rejects contractor onboarding unless allowance and automation are zeroed', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createMockSupabaseAdmin({
      roleId: 'role-contractor',
      roleName: 'contractor',
      roleDisplayName: 'Contractor',
    });
    vi.mocked(createClient).mockReturnValue(admin as never);

    const denied = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(validCreateBody({
        role_id: 'role-contractor',
        annual_allowance_days: 28,
        remaining_leave_days: 15,
        auto_book_bank_holidays: true,
      })),
    }) as NextRequest);
    const deniedPayload = await denied.json();

    expect(denied.status).toBe(400);
    expect(deniedPayload.error).toContain('Contractor accounts');
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('creates a contractor with 0/0/no/no and does not seed bank holidays', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createMockSupabaseAdmin({
      roleId: 'role-contractor',
      roleName: 'contractor',
      roleDisplayName: 'Contractor',
    });
    vi.mocked(createClient).mockReturnValue(admin as never);

    const response = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(validCreateBody({
        role_id: 'role-contractor',
        annual_allowance_days: 0,
        remaining_leave_days: 0,
        auto_book_bank_holidays: false,
        auto_apply_bulk_bookings: false,
        selected_bulk_batch_ids: [],
      })),
    }) as NextRequest);
    const payload = await response.json();
    const { seedRemainingFinancialYearBankHolidaysForProfiles } = await import(
      '@/lib/services/absence-bank-holiday-sync'
    );

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(seedRemainingFinancialYearBankHolidaysForProfiles).not.toHaveBeenCalled();
  });
});
