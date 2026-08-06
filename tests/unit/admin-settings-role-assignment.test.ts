import { describe, expect, it } from 'vitest';
import {
  AdminSettingsRoleAssignmentError,
  canAdminSettingsActorAssignRole,
  updateUserRoleForAdminSettings,
  type RoleAccessRow,
  type RoleAssignmentPgClient,
} from '@/lib/server/admin-settings-role-assignment';

class FakeRoleAssignmentClient implements RoleAssignmentPgClient {
  readonly calls: string[] = [];

  async connect() {}

  async query<Row = Record<string, unknown>>(
    text: string
  ): Promise<{ rows: Row[] }> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.calls.push(normalized);

    if (normalized.includes('FROM public.profiles profile')) {
      return {
        rows: [{
          profile_id: 'user-1',
          role_id: 'admin',
          ...adminRole,
        }] as Row[],
      };
    }
    if (normalized.includes('FROM public.roles')) {
      return { rows: [employeeRole] as Row[] };
    }
    if (normalized.startsWith('UPDATE public.profiles')) {
      return { rows: [] };
    }
    return { rows: [] };
  }

  async end() {}
}

const employeeRole: RoleAccessRow = {
  id: 'employee',
  name: 'employee',
  role_class: 'employee',
  is_super_admin: false,
};

const managerRole: RoleAccessRow = {
  id: 'manager',
  name: 'manager',
  role_class: 'manager',
  is_super_admin: false,
};

const adminRole: RoleAccessRow = {
  id: 'admin',
  name: 'admin',
  role_class: 'admin',
  is_super_admin: false,
};

const superAdminRole: RoleAccessRow = {
  id: 'super-admin',
  name: 'super-admin',
  role_class: 'admin',
  is_super_admin: true,
};

describe('Admin Settings delegated role assignment', () => {
  it('AUTH-ROLE-BOUNDARY-01 lets level-5 delegates assign non-admin roles', () => {
    expect(canAdminSettingsActorAssignRole(false, employeeRole, managerRole)).toBe(true);
  });

  it('AUTH-ROLE-BOUNDARY-01 prevents delegates from altering Admin users', () => {
    expect(canAdminSettingsActorAssignRole(false, adminRole, employeeRole)).toBe(false);
  });

  it('AUTH-ROLE-BOUNDARY-01 prevents delegates from assigning Admin or Super Admin', () => {
    expect(canAdminSettingsActorAssignRole(false, employeeRole, adminRole)).toBe(false);
    expect(canAdminSettingsActorAssignRole(false, employeeRole, superAdminRole)).toBe(false);
  });

  it('preserves full-role admin assignment authority', () => {
    expect(canAdminSettingsActorAssignRole(true, superAdminRole, employeeRole)).toBe(true);
    expect(canAdminSettingsActorAssignRole(true, employeeRole, superAdminRole)).toBe(true);
  });

  it('AUTH-ROLE-BOUNDARY-01 rolls back permission cleanup when role CAS fails', async () => {
    const client = new FakeRoleAssignmentClient();

    await expect(updateUserRoleForAdminSettings({
      userId: 'user-1',
      roleId: 'employee',
      actorHasFullAccess: true,
    }, () => client)).rejects.toMatchObject<Partial<AdminSettingsRoleAssignmentError>>({
      status: 409,
    });

    expect(client.calls.some((call) => (
      call.startsWith('DELETE FROM public.user_module_permissions')
    ))).toBe(true);
    expect(client.calls.at(-1)).toBe('ROLLBACK');
    expect(client.calls).not.toContain('COMMIT');
  });
});
