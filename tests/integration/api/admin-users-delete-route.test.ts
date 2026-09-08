import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  revokeAllAppSessionsForProfile,
  revokeWebAuthnCredentialsForProfile,
  removeOpenYearAnnualLeaveBookingsForProfile,
  updateUserById,
} = vi.hoisted(() => ({
  revokeAllAppSessionsForProfile: vi.fn(),
  revokeWebAuthnCredentialsForProfile: vi.fn(),
  removeOpenYearAnnualLeaveBookingsForProfile: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
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

vi.mock('@/lib/server/app-auth/session', () => ({
  revokeAllAppSessionsForProfile,
}));

vi.mock('@/lib/server/webauthn/credentials', () => ({
  revokeWebAuthnCredentialsForProfile,
}));

vi.mock('@/lib/server/delete-user-annual-leave', () => ({
  removeOpenYearAnnualLeaveBookingsForProfile,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { DELETE } from '@/app/api/admin/users/[id]/route';

const profileUpdates: Array<Record<string, unknown>> = [];
const keepDataCallOrder: string[] = [];

function createKeepDataAdmin() {
  return {
    auth: {
      admin: {
        updateUserById,
      },
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return {
                      data: {
                        full_name: 'Tim Wilson',
                        is_system_account: false,
                        role_id: 'role-employee',
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            profileUpdates.push(payload);
            if (typeof payload.deleted_at === 'string') {
              keepDataCallOrder.push('tombstone');
            }
            return {
              eq() {
                return { error: null };
              },
            };
          },
        };
      }

      return {
        update() {
          return {
            eq() {
              return { error: null };
            },
          };
        },
      };
    },
  };
}

describe('DELETE /api/admin/users/[id] keep-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue(createKeepDataAdmin() as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'admin-1',
      role: { name: 'admin' },
    } as never);
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(null);
    vi.mocked(canEffectiveRoleAssignRole).mockResolvedValue(true);
    profileUpdates.length = 0;
    keepDataCallOrder.length = 0;
    updateUserById.mockResolvedValue({ error: null });
    revokeAllAppSessionsForProfile.mockResolvedValue(2);
    revokeWebAuthnCredentialsForProfile.mockResolvedValue(1);
    removeOpenYearAnnualLeaveBookingsForProfile.mockImplementation(async () => {
      keepDataCallOrder.push('cleanup');
      return 3;
    });
  });

  it('DEL-AL-02: keep-data writes deleted_at, revokes access, and keeps company data', async () => {
    const request = new Request(
      'http://localhost/api/admin/users/user-tim?mode=keep-data',
      { method: 'DELETE' }
    );

    const response = await DELETE(request as never, {
      params: Promise.resolve({ id: 'user-tim' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe('keep-data');
    expect(revokeAllAppSessionsForProfile).toHaveBeenCalledWith('user-tim', 'account_deleted');
    expect(revokeWebAuthnCredentialsForProfile).toHaveBeenCalledWith('user-tim');
    expect(updateUserById).toHaveBeenCalled();
    expect(profileUpdates[0]).toMatchObject({
      full_name: 'Tim Wilson (Deleted User)',
    });
    expect(typeof profileUpdates[0]?.deleted_at).toBe('string');
    expect(removeOpenYearAnnualLeaveBookingsForProfile).toHaveBeenCalled();
  });

  it('DEL-AL-01: keep-data calls leave cleanup after the tombstone', async () => {
    const request = new Request(
      'http://localhost/api/admin/users/user-tim?mode=keep-data',
      { method: 'DELETE' }
    );

    const success = await DELETE(request as never, {
      params: Promise.resolve({ id: 'user-tim' }),
    });
    expect(success.status).toBe(200);
    expect(removeOpenYearAnnualLeaveBookingsForProfile).toHaveBeenCalledWith(
      expect.anything(),
      'user-tim'
    );
    expect(keepDataCallOrder).toEqual(['tombstone', 'cleanup']);
  });

  it('DEL-AL-07: failed cleanup after tombstone is not reported as success', async () => {
    removeOpenYearAnnualLeaveBookingsForProfile.mockRejectedValueOnce(
      new Error('Annual leave reason is missing or ambiguous')
    );
    const request = new Request(
      'http://localhost/api/admin/users/user-tim?mode=keep-data',
      { method: 'DELETE' }
    );
    const failure = await DELETE(request as never, {
      params: Promise.resolve({ id: 'user-tim' }),
    });
    const failurePayload = await failure.json();
    expect(failure.status).toBe(500);
    expect(failurePayload.error).toBe('Failed to remove booked annual leave');
    expect(failurePayload.success).toBeUndefined();
    expect(profileUpdates.length).toBeGreaterThan(0);
  });
});
