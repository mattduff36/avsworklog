import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '@/app/api/admin/users/[id]/contractor-transition/route';

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAssignRole: vi.fn(),
}));
vi.mock('@/lib/server/admin-users-module-access', () => ({
  requireAdminUsersModuleAccess: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/server/contractor-role-transition', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/contractor-role-transition')>(
    '@/lib/server/contractor-role-transition'
  );
  return {
    ...actual,
    transitionProfileToContractor: vi.fn(),
  };
});
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

function createAdminClientMock(options: {
  profile?: Record<string, unknown> | null;
  role?: Record<string, unknown> | null;
} = {}) {
  return {
    from(table: string) {
      const data = table === 'profiles'
        ? options.profile ?? {
          id: 'user-1',
          role_id: 'role-employee',
          deleted_at: null,
          is_system_account: false,
        }
        : options.role ?? {
          id: 'role-contractor',
          name: 'contractor',
          display_name: 'Contractor',
        };
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

async function invoke(body: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/admin/users/user-1/contractor-transition', {
      method: 'POST',
      body: JSON.stringify({
        expected_role_id: 'role-employee',
        contractor_role_id: 'role-contractor',
        ...body,
      }),
    }) as NextRequest,
    { params: Promise.resolve({ id: 'user-1' }) }
  );
}

describe('POST /api/admin/users/[id]/contractor-transition', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAssignRole } = await import('@/lib/utils/rbac');
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { transitionProfileToContractor } = await import('@/lib/server/contractor-role-transition');

    vi.mocked(getEffectiveRole).mockResolvedValue({ user_id: 'admin-1' } as never);
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(null);
    vi.mocked(canEffectiveRoleAssignRole).mockResolvedValue(true);
    vi.mocked(createAdminClient).mockReturnValue(createAdminClientMock() as never);
    vi.mocked(transitionProfileToContractor).mockResolvedValue({
      profileId: 'user-1',
      previousRoleId: 'role-employee',
      contractorRoleId: 'role-contractor',
      removedAbsenceCount: 2,
      zeroedCarryoverCount: 1,
      clearedPermissionCount: 3,
    });
  });

  it('keeps unauthenticated and sensitive-PIN-locked requests fail-closed', async () => {
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    vi.mocked(getEffectiveRole).mockResolvedValue({ user_id: null } as never);
    expect((await invoke()).status).toBe(401);

    vi.mocked(getEffectiveRole).mockResolvedValue({ user_id: 'admin-1' } as never);
    const { requireAdminUsersModuleAccess } = await import('@/lib/server/admin-users-module-access');
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(
      NextResponse.json({ error: 'Sensitive PIN required' }, { status: 428 })
    );
    expect((await invoke()).status).toBe(428);
  });

  it('checks authority over both roles before invoking the atomic transition', async () => {
    const { canEffectiveRoleAssignRole } = await import('@/lib/utils/rbac');
    const { transitionProfileToContractor } = await import('@/lib/server/contractor-role-transition');
    vi.mocked(canEffectiveRoleAssignRole).mockImplementation(
      async (roleId) => roleId !== 'role-employee'
    );

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(canEffectiveRoleAssignRole).toHaveBeenCalledWith('role-employee');
    expect(canEffectiveRoleAssignRole).toHaveBeenCalledWith('role-contractor');
    expect(transitionProfileToContractor).not.toHaveBeenCalled();
  });

  it('passes the expected role guard to the RPC wrapper and returns cleanup counts', async () => {
    const { transitionProfileToContractor } = await import('@/lib/server/contractor-role-transition');

    const response = await invoke();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.transition.removedAbsenceCount).toBe(2);
    expect(transitionProfileToContractor).toHaveBeenCalledWith(
      expect.anything(),
      {
        profileId: 'user-1',
        expectedRoleId: 'role-employee',
        contractorRoleId: 'role-contractor',
      }
    );
  });

  it('returns a conflict for stale roles before calling the transition', async () => {
    const { transitionProfileToContractor } = await import('@/lib/server/contractor-role-transition');

    const response = await invoke({ expected_role_id: 'stale-role' });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('STALE_ROLE');
    expect(transitionProfileToContractor).not.toHaveBeenCalled();
  });

  it('surfaces database preflight conflicts without converting the profile', async () => {
    const {
      ContractorTransitionConflictError,
      transitionProfileToContractor,
    } = await import('@/lib/server/contractor-role-transition');
    vi.mocked(transitionProfileToContractor).mockRejectedValue(
      new ContractorTransitionConflictError(
        'Contractor transition blocked: Annual Leave requires manual review',
        'AMBIGUOUS_ANNUAL_LEAVE'
      )
    );

    const response = await invoke();
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('AMBIGUOUS_ANNUAL_LEAVE');
  });
});
