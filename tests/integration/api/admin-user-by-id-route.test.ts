import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { PUT } from '@/app/api/admin/users/[id]/route';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/utils/email', () => ({
  sendProfileUpdateEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAssignRole: vi.fn(),
}));
vi.mock('@/lib/server/admin-users-module-access', () => ({
  requireAdminUsersModuleAccess: vi.fn(),
}));
vi.mock('@/lib/server/team-managers', () => ({
  reconcileProfileHierarchy: vi.fn(),
  isMissingTeamManagerSchemaError: vi.fn(() => false),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

type PutRouteOptions = {
  existingUser?: Record<string, unknown>;
  employeeIdOwner?: { id: string } | null;
  employeeIdLookupError?: { message: string } | null;
  profileUpdateError?: { code?: string; message: string } | null;
};

function createMockSupabaseAdmin(options: PutRouteOptions = {}) {
  const updateUserById = vi.fn().mockResolvedValue({ error: null });
  const getUserById = vi.fn().mockResolvedValue({
    data: { user: { email: 'existing@example.com' } },
    error: null,
  });
  const profileUpdate = vi.fn().mockResolvedValue({ error: options.profileUpdateError ?? null });
  const permissionDelete = vi.fn().mockResolvedValue({ error: null });

  return {
    auth: {
      admin: {
        updateUserById,
        getUserById,
      },
    },
    profileUpdate,
    permissionDelete,
    updateUserById,
    from(table: string) {
      if (table === 'roles') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        name: 'employee',
                        display_name: 'Employee',
                        role_class: 'employee',
                        is_super_admin: false,
                      },
                      error: null,
                    };
                  },
                  async single() {
                    return { data: { id: 'role-employee', name: 'employee' }, error: null };
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
                    return { data: { id: 'team-civils' }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'user_module_permissions') {
        return {
          delete() {
            return {
              eq: permissionDelete,
            };
          },
        };
      }

      if (table === 'profiles') {
        return {
          select(columns: string) {
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
                    if (columns === '*') {
                      return {
                        data: options.existingUser ?? {
                          id: 'user-1',
                          full_name: 'Existing User',
                          phone_number: null,
                          employee_id: 'E100',
                          role_id: 'role-employee',
                          line_manager_id: null,
                          team_id: 'team-civils',
                          is_system_account: false,
                        },
                        error: null,
                      };
                    }
                    return { data: { id: 'manager-1', role: { role_class: 'manager' } }, error: null };
                  },
                };
              },
            };
          },
          update() {
            return {
              eq: profileUpdate,
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function validPutBody(overrides: Record<string, unknown> = {}) {
  return {
    email: 'existing@example.com',
    full_name: 'Existing User',
    phone_number: null,
    employee_id: 'E200',
    role_id: 'role-employee',
    line_manager_id: null,
    team_id: 'team-civils',
    ...overrides,
  };
}

async function invokePut(body: Record<string, unknown>, userId = 'user-1') {
  return PUT(
    new Request(`http://localhost/api/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }) as NextRequest,
    { params: Promise.resolve({ id: userId }) },
  );
}

describe('PUT /api/admin/users/[id]', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createClient } = await import('@supabase/supabase-js');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAssignRole } = await import('@/lib/utils/rbac');
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    const { reconcileProfileHierarchy } = await import('@/lib/server/team-managers');

    vi.mocked(createClient).mockReturnValue(createMockSupabaseAdmin() as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'admin-1',
      role_name: 'admin',
      is_super_admin: true,
    } as never);
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(null);
    vi.mocked(canEffectiveRoleAssignRole).mockResolvedValue(true);
    vi.mocked(reconcileProfileHierarchy).mockResolvedValue({ affected_team_ids: [] });
  });

  it('EMP-AUTH-001 keeps unauthenticated and sensitive-PIN-locked updates fail-closed', async () => {
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    vi.mocked(getEffectiveRole).mockResolvedValue({ user_id: null } as never);
    const unauthorized = await invokePut(validPutBody());
    expect(unauthorized.status).toBe(401);

    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'admin-1',
      role_name: 'admin',
      is_super_admin: true,
    } as never);
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(
      NextResponse.json(
        { error: 'Sensitive access PIN required for protected modules.', code: 'SENSITIVE_PIN_REQUIRED' },
        { status: 428 }
      )
    );
    const locked = await invokePut(validPutBody());
    expect(locked.status).toBe(428);
  });

  it('EMP-ID-003 allows the current normalized ID and rejects another owner', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const sameIdAdmin = createMockSupabaseAdmin({
      existingUser: {
        id: 'user-1',
        full_name: 'Existing User',
        phone_number: null,
        employee_id: 'E100',
        role_id: 'role-employee',
        line_manager_id: null,
        team_id: 'team-civils',
        is_system_account: false,
      },
    });
    vi.mocked(createClient).mockReturnValue(sameIdAdmin as never);

    const sameId = await invokePut(validPutBody({ employee_id: ' E100 ' }));
    expect(sameId.status).toBe(200);
    expect(sameIdAdmin.updateUserById).toHaveBeenCalled();

    const conflictAdmin = createMockSupabaseAdmin({
      employeeIdOwner: { id: 'deleted-owner' },
    });
    vi.mocked(createClient).mockReturnValue(conflictAdmin as never);
    const conflict = await invokePut(validPutBody({ employee_id: 'E200' }));
    const payload = await conflict.json();
    expect(conflict.status).toBe(409);
    expect(payload.code).toBe('DUPLICATE_EMPLOYEE_ID');
    expect(conflictAdmin.updateUserById).not.toHaveBeenCalled();
    expect(conflictAdmin.profileUpdate).not.toHaveBeenCalled();
    expect(conflictAdmin.permissionDelete).not.toHaveBeenCalled();
  });

  it('EMP-ID-004 returns 409 before Auth email, permission cleanup, profile update, or notification', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { sendProfileUpdateEmail } = await import('@/lib/utils/email');
    const admin = createMockSupabaseAdmin({
      employeeIdOwner: { id: 'other-user' },
    });
    vi.mocked(createClient).mockReturnValue(admin as never);

    const response = await invokePut(validPutBody({ email: 'changed@example.com' }));
    expect(response.status).toBe(409);
    expect(admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.permissionDelete).not.toHaveBeenCalled();
    expect(admin.profileUpdate).not.toHaveBeenCalled();
    expect(sendProfileUpdateEmail).not.toHaveBeenCalled();
  });

  it('EMP-ID-005 fails closed when the precheck query errors', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createMockSupabaseAdmin({
      employeeIdLookupError: { message: 'lookup failed' },
    });
    vi.mocked(createClient).mockReturnValue(admin as never);

    const response = await invokePut(validPutBody());
    expect(response.status).toBe(500);
    expect(admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.profileUpdate).not.toHaveBeenCalled();
  });

  it('EMP-ID-006 treats a race-time profile 23505 as an unexpected 500', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createMockSupabaseAdmin({
      profileUpdateError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_employee_id_key"',
      },
    });
    vi.mocked(createClient).mockReturnValue(admin as never);

    const response = await invokePut(validPutBody());
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.code).toBeUndefined();
    expect(payload.error).toBe('Failed to update user profile');
  });
});
