import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';

const { getEffectiveRole, getEffectiveRoleForUser } = vi.hoisted(() => ({
  getEffectiveRole: vi.fn(),
  getEffectiveRoleForUser: vi.fn(),
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole,
  getEffectiveRoleForUser,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/team-permissions', () => ({
  getPermissionLevelsForUser: vi.fn(),
}));

import { isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';

function role(overrides: Partial<EffectiveRoleInfo> = {}): EffectiveRoleInfo {
  return {
    role_id: 'role-1',
    role_name: 'Plant Operator',
    display_name: 'Plant Operator',
    role_class: 'employee',
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: true,
    is_actual_super_admin: true,
    user_id: 'actor',
    team_id: 'team-1',
    team_name: 'Viewed team',
    ...overrides,
  };
}

describe('effective-role manager checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('WT-CORR-VIEWAS-001 denies a View-As employee and allows a View-As manager', async () => {
    getEffectiveRoleForUser.mockResolvedValue(role());
    await expect(
      isEffectiveRoleManagerOrHigher({ userId: 'actor', email: 'actor@example.com' })
    ).resolves.toBe(false);
    expect(getEffectiveRole).not.toHaveBeenCalled();
    expect(getEffectiveRoleForUser).toHaveBeenCalledWith('actor', 'actor@example.com');

    getEffectiveRoleForUser.mockResolvedValue(
      role({
        role_name: 'Workshop Manager',
        display_name: 'Workshop Manager',
        role_class: 'manager',
        is_manager_admin: true,
      })
    );
    await expect(
      isEffectiveRoleManagerOrHigher({ userId: 'actor', email: 'actor@example.com' })
    ).resolves.toBe(true);
  });
});
