import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

const { getEffectiveRole, getEffectiveRoleForUser, getPermissionLevelsForUser, createAdminClient, adminClient } =
  vi.hoisted(() => {
    const adminClient = { kind: 'training-auth-admin-sentinel' };
    return {
      getEffectiveRole: vi.fn(),
      getEffectiveRoleForUser: vi.fn(),
      getPermissionLevelsForUser: vi.fn(),
      createAdminClient: vi.fn(() => adminClient),
      adminClient,
    };
  });

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole,
  getEffectiveRoleForUser,
}));

vi.mock('@/lib/server/team-permissions', () => ({
  getPermissionLevelsForUser,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient,
}));

import { getModuleAccessLevelForEffectiveRole } from '@/lib/server/effective-module-access';
import { requireTrainingAccess, requireTrainingAdminAccess } from '@/lib/server/training-auth';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';

function role(overrides: Partial<EffectiveRoleInfo> = {}): EffectiveRoleInfo {
  return {
    role_id: 'role-employee',
    role_name: 'employee',
    display_name: 'Employee',
    role_class: 'employee',
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    user_id: 'user-1',
    team_id: 'team-home',
    team_name: 'Home',
    ...overrides,
  };
}

const unauthenticated: EffectiveRoleInfo = {
  role_id: null,
  role_name: null,
  display_name: null,
  role_class: null,
  is_manager_admin: false,
  is_super_admin: false,
  is_viewing_as: false,
  is_actual_super_admin: false,
  user_id: null,
  team_id: null,
  team_name: null,
};

function trainingLevels(level: PermissionAccessLevel): Record<ModuleName, PermissionAccessLevel> {
  return { training: level } as Record<ModuleName, PermissionAccessLevel>;
}

function permissionArgs(
  userId: string,
  roleId: string,
  teamId: string | null,
  includeUserOverrides: boolean
) {
  return [userId, roleId, adminClient, teamId, { includeUserOverrides }] as const;
}

describe('training request context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClient.mockImplementation(() => adminClient);
  });

  it('returns 401 without resolving a training level when the validated actor is missing', async () => {
    getEffectiveRole.mockResolvedValue(unauthenticated);

    await expect(requireTrainingAccess()).resolves.toEqual({
      allowed: false,
      status: 401,
      error: 'Unauthorized',
    });

    expect(getEffectiveRole).toHaveBeenCalledTimes(1);
    expect(getEffectiveRoleForUser).not.toHaveBeenCalled();
    expect(getPermissionLevelsForUser).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [0, 403, false],
    [1, 200, false],
    [4, 200, false],
    [5, 200, true],
  ] as const)(
    'derives training access from one numeric level %s',
    async (level, status, isAdminLevel) => {
      getEffectiveRole.mockResolvedValue(role());
      getPermissionLevelsForUser.mockResolvedValue(trainingLevels(level));

      const result = await requireTrainingAccess();

      expect(getEffectiveRole).toHaveBeenCalledTimes(1);
      expect(getEffectiveRoleForUser).not.toHaveBeenCalled();
      expect(getPermissionLevelsForUser).toHaveBeenCalledTimes(1);
      expect(getPermissionLevelsForUser).toHaveBeenCalledWith(
        ...permissionArgs('user-1', 'role-employee', 'team-home', true)
      );

      if (status === 403) {
        expect(result).toEqual({ allowed: false, status: 403, error: 'Forbidden' });
        return;
      }

      expect(result).toEqual({
        allowed: true,
        status: 200,
        userId: 'user-1',
        accessLevel: level,
        isAdminLevel,
      });
    }
  );

  it('forbids a profile that has no role without reading the permission matrix', async () => {
    getEffectiveRole.mockResolvedValue(role({ role_id: null }));

    await expect(requireTrainingAccess()).resolves.toEqual({
      allowed: false,
      status: 403,
      error: 'Forbidden',
    });
    expect(getEffectiveRole).toHaveBeenCalledTimes(1);
    expect(getPermissionLevelsForUser).not.toHaveBeenCalled();
  });

  it('grants level 5 to an actual admin and an actual superadmin without a matrix read', async () => {
    getEffectiveRole.mockResolvedValue(
      role({
        role_id: 'role-admin',
        role_name: 'regional-admin',
        role_class: 'admin',
        is_manager_admin: true,
      })
    );

    await expect(requireTrainingAccess()).resolves.toMatchObject({
      allowed: true,
      status: 200,
      userId: 'user-1',
      accessLevel: 5,
      isAdminLevel: true,
    });

    getEffectiveRole.mockResolvedValue(
      role({
        role_id: 'role-super',
        role_name: 'super-admin',
        role_class: 'admin',
        is_super_admin: true,
        is_actual_super_admin: true,
        is_viewing_as: false,
      })
    );

    await expect(requireTrainingAdminAccess()).resolves.toMatchObject({
      allowed: true,
      status: 200,
      accessLevel: 5,
      isAdminLevel: true,
    });

    expect(getEffectiveRole).toHaveBeenCalledTimes(2);
    expect(getPermissionLevelsForUser).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('keeps View As employee on the viewed team and suppresses personal overrides', async () => {
    const viewed = role({
      user_id: 'actual-super',
      role_id: 'role-viewed-employee',
      role_name: 'employee',
      role_class: 'employee',
      is_super_admin: false,
      is_actual_super_admin: true,
      is_viewing_as: true,
      team_id: 'team-other',
      team_name: 'Other team',
    });
    getEffectiveRole.mockResolvedValue(viewed);
    getPermissionLevelsForUser.mockResolvedValue(trainingLevels(4));

    await expect(requireTrainingAccess()).resolves.toEqual({
      allowed: true,
      status: 200,
      userId: 'actual-super',
      accessLevel: 4,
      isAdminLevel: false,
    });
    await expect(requireTrainingAdminAccess()).resolves.toMatchObject({
      allowed: false,
      status: 403,
      error: 'Admin Training access required',
    });

    expect(getPermissionLevelsForUser).toHaveBeenCalledTimes(2);
    expect(getPermissionLevelsForUser).toHaveBeenNthCalledWith(
      1,
      ...permissionArgs('actual-super', 'role-viewed-employee', 'team-other', false)
    );
    expect(getPermissionLevelsForUser).toHaveBeenNthCalledWith(
      2,
      ...permissionArgs('actual-super', 'role-viewed-employee', 'team-other', false)
    );
  });

  it('still short-circuits when View As lands on an effective admin role', async () => {
    const level = await getModuleAccessLevelForEffectiveRole(
      role({
        role_id: 'role-viewed-admin',
        role_name: 'admin',
        role_class: 'admin',
        is_super_admin: false,
        is_actual_super_admin: true,
        is_viewing_as: true,
        team_id: 'team-other',
      }),
      'training'
    );

    expect(level).toBe(5);
    expect(getEffectiveRole).not.toHaveBeenCalled();
    expect(getPermissionLevelsForUser).not.toHaveBeenCalled();
  });

  it('passes the same validated role through the shared helper used by getEffectiveModuleAccessLevel', async () => {
    getEffectiveRole.mockResolvedValue(
      role({
        is_actual_super_admin: true,
        is_viewing_as: true,
        is_super_admin: false,
        team_id: 'team-other',
      })
    );
    getPermissionLevelsForUser.mockResolvedValue(trainingLevels(1));

    await expect(getEffectiveModuleAccessLevel('training')).resolves.toBe(1);
    expect(getEffectiveRole).toHaveBeenCalledTimes(1);
    expect(getEffectiveRoleForUser).not.toHaveBeenCalled();
    expect(getPermissionLevelsForUser).toHaveBeenCalledTimes(1);
    expect(getPermissionLevelsForUser).toHaveBeenCalledWith(
      ...permissionArgs('user-1', 'role-employee', 'team-other', false)
    );

    getEffectiveRoleForUser.mockResolvedValue(role({ user_id: 'actor-2', role_id: 'role-2', team_id: 'team-2' }));
    getPermissionLevelsForUser.mockResolvedValue(trainingLevels(4));

    await expect(
      getEffectiveModuleAccessLevel('training', { userId: 'actor-2', email: 'actor@example.com' })
    ).resolves.toBe(4);
    expect(getEffectiveRole).toHaveBeenCalledTimes(1);
    expect(getEffectiveRoleForUser).toHaveBeenCalledTimes(1);
    expect(getEffectiveRoleForUser).toHaveBeenCalledWith('actor-2', 'actor@example.com');
    expect(getPermissionLevelsForUser).toHaveBeenLastCalledWith(
      ...permissionArgs('actor-2', 'role-2', 'team-2', true)
    );
  });

  it('does not reuse another in-flight user context', async () => {
    const roleA = role({ user_id: 'user-a', role_id: 'role-a', team_id: 'team-a' });
    const roleB = role({ user_id: 'user-b', role_id: 'role-b', team_id: 'team-b' });
    let roleCalls = 0;
    getEffectiveRole.mockImplementation(async () => {
      const index = roleCalls;
      roleCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 0));
      return index === 0 ? roleA : roleB;
    });
    getPermissionLevelsForUser.mockImplementation(async (userId: string) => {
      await new Promise((resolve) => setTimeout(resolve, userId === 'user-b' ? 20 : 0));
      return trainingLevels(userId === 'user-a' ? 1 : 4);
    });

    const [first, second] = await Promise.all([requireTrainingAccess(), requireTrainingAccess()]);

    expect(first).toMatchObject({ status: 200, userId: 'user-a', accessLevel: 1, isAdminLevel: false });
    expect(second).toMatchObject({ status: 200, userId: 'user-b', accessLevel: 4, isAdminLevel: false });
    expect(getEffectiveRole).toHaveBeenCalledTimes(2);
    expect(getPermissionLevelsForUser).toHaveBeenCalledTimes(2);
    expect(getPermissionLevelsForUser.mock.calls).toEqual([
      [...permissionArgs('user-b', 'role-b', 'team-b', true)],
      [...permissionArgs('user-a', 'role-a', 'team-a', true)],
    ]);
  });

  it('observes a changed role and a later revocation on a fresh invocation', async () => {
    getEffectiveRole
      .mockResolvedValueOnce(role({ role_id: 'role-before', team_id: 'team-before' }))
      .mockResolvedValueOnce(role({ role_id: 'role-after', team_id: 'team-after', role_name: 'supervisor' }))
      .mockResolvedValueOnce(unauthenticated);
    getPermissionLevelsForUser
      .mockResolvedValueOnce(trainingLevels(1))
      .mockResolvedValueOnce(trainingLevels(5));

    await expect(requireTrainingAccess()).resolves.toMatchObject({
      status: 200,
      accessLevel: 1,
      isAdminLevel: false,
    });
    await expect(requireTrainingAccess()).resolves.toMatchObject({
      status: 200,
      accessLevel: 5,
      isAdminLevel: true,
    });
    await expect(requireTrainingAccess()).resolves.toEqual({
      allowed: false,
      status: 401,
      error: 'Unauthorized',
    });

    expect(getEffectiveRole).toHaveBeenCalledTimes(3);
    expect(getPermissionLevelsForUser).toHaveBeenCalledTimes(2);
    expect(getPermissionLevelsForUser).toHaveBeenNthCalledWith(
      1,
      ...permissionArgs('user-1', 'role-before', 'team-before', true)
    );
    expect(getPermissionLevelsForUser).toHaveBeenNthCalledWith(
      2,
      ...permissionArgs('user-1', 'role-after', 'team-after', true)
    );
  });
});
