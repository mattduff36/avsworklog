import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  revokeAllAppSessionsForProfile,
  revokeWebAuthnCredentialsForProfile,
  updateUserById,
} = vi.hoisted(() => ({
  revokeAllAppSessionsForProfile: vi.fn(),
  revokeWebAuthnCredentialsForProfile: vi.fn(),
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

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { DELETE } from '@/app/api/admin/users/[id]/route';

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
          update() {
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
    updateUserById.mockResolvedValue({ error: null });
    revokeAllAppSessionsForProfile.mockResolvedValue(2);
    revokeWebAuthnCredentialsForProfile.mockResolvedValue(1);
  });

  it('revokes app sessions and WebAuthn credentials when keeping company data', async () => {
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
  });
});
