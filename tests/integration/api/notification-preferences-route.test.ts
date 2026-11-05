import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';
import type { NotificationModuleKey } from '@/types/notifications';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

const {
  mockCreateClient,
  mockGetEffectiveRole,
  mockGetEffectiveModuleAccessLevel,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetEffectiveRole: vi.fn(),
  mockGetEffectiveModuleAccessLevel: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockGetEffectiveRole,
}));

vi.mock('@/lib/utils/rbac', () => ({
  getEffectiveModuleAccessLevel: mockGetEffectiveModuleAccessLevel,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

import { PUT } from '@/app/api/notification-preferences/route';

const EMPLOYEE_ROLE: EffectiveRoleInfo = {
  user_id: 'user-1',
  role_id: 'employee-role',
  role_name: 'employee',
  display_name: 'Employee',
  role_class: 'employee',
  is_manager_admin: false,
  is_super_admin: false,
  is_actual_super_admin: false,
  is_viewing_as: false,
  team_id: 'team-1',
  team_name: 'Team 1',
};

const SUPERVISOR_ROLE: EffectiveRoleInfo = {
  ...EMPLOYEE_ROLE,
  role_id: 'supervisor-role',
  role_name: 'supervisor',
  display_name: 'Supervisor',
};

const PERMISSION_BOUNDARIES: Array<{
  moduleKey: NotificationModuleKey;
  moduleName: ModuleName;
  minimumLevel: PermissionAccessLevel;
}> = [
  { moduleKey: 'errors', moduleName: 'error-reports', minimumLevel: 1 },
  { moduleKey: 'rams', moduleName: 'rams', minimumLevel: 3 },
  { moduleKey: 'approvals', moduleName: 'approvals', minimumLevel: 3 },
  { moduleKey: 'sensitive_pin_security', moduleName: 'admin-settings', minimumLevel: 4 },
  { moduleKey: 'daily_allocation', moduleName: 'daily-allocation', minimumLevel: 2 },
];

const ROLE_RESTRICTED_MODULES: NotificationModuleKey[] = [
  'errors', 'rams', 'approvals', 'sensitive_pin_security',
];

const DISABLE_FIELDS = ['enabled', 'notify_in_app', 'notify_email'] as const;

function mockPreferenceClient(moduleKey: NotificationModuleKey = 'general_notifications') {
  const preference = {
    id: 'pref-1',
    user_id: 'user-1',
    module_key: moduleKey,
    enabled: true,
    notify_in_app: true,
    notify_email: true,
    created_at: '2026-11-05T00:00:00.000Z',
    updated_at: '2026-11-05T00:00:00.000Z',
  };
  const single = vi.fn().mockResolvedValue({ data: preference, error: null });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const getUser = vi.fn().mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  const from = vi.fn((table: string) => {
    if (table === 'notification_preferences') return { upsert };
    throw new Error(`Unexpected table: ${table}`);
  });

  mockCreateClient.mockResolvedValue({ auth: { getUser }, from });
  return { preference, single, upsert, getUser, from };
}

function putPreference(body: object) {
  return PUT(new NextRequest('http://localhost/api/notification-preferences', {
    method: 'PUT',
    body: JSON.stringify(body),
  }));
}

describe('/api/notification-preferences', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetEffectiveRole.mockResolvedValue(SUPERVISOR_ROLE);
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(0);
  });

  it('re-enables a preference row when saving visible channel toggles', async () => {
    const { preference, single, upsert } = mockPreferenceClient();
    single.mockResolvedValue({
      data: { ...preference, notify_in_app: false },
      error: null,
    });

    const response = await putPreference({
      module_key: 'general_notifications',
      notify_in_app: false,
      notify_email: true,
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      preference: { ...preference, notify_in_app: false },
    });
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        module_key: 'general_notifications',
        enabled: true,
        notify_in_app: false,
        notify_email: true,
      },
      { onConflict: 'user_id,module_key' }
    );
    expect(mockGetEffectiveRole).toHaveBeenCalledTimes(1);
    expect(mockGetEffectiveModuleAccessLevel).not.toHaveBeenCalled();
  });

  it.each(PERMISSION_BOUNDARIES)(
    'allows an employee to enable $moduleKey at Level $minimumLevel',
    async ({ moduleKey, moduleName, minimumLevel }) => {
      const { preference, upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveRole.mockResolvedValue(EMPLOYEE_ROLE);
      mockGetEffectiveModuleAccessLevel.mockResolvedValue(minimumLevel);

      const response = await putPreference({ module_key: moduleKey, notify_in_app: true });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, preference });
      expect(mockGetEffectiveModuleAccessLevel).toHaveBeenCalledExactlyOnceWith(moduleName);
      expect(upsert).toHaveBeenCalledWith(
        { user_id: 'user-1', module_key: moduleKey, enabled: true, notify_in_app: true },
        { onConflict: 'user_id,module_key' }
      );
    }
  );

  it.each(PERMISSION_BOUNDARIES)(
    'allows a supervisor with module access to disable $moduleKey channels',
    async ({ moduleKey, moduleName, minimumLevel }) => {
      const { upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveModuleAccessLevel.mockResolvedValue(minimumLevel);

      const response = await putPreference({ module_key: moduleKey, notify_email: false });

      expect(response.status).toBe(200);
      expect(mockGetEffectiveModuleAccessLevel).toHaveBeenCalledExactlyOnceWith(moduleName);
      expect(upsert).toHaveBeenCalledWith(
        { user_id: 'user-1', module_key: moduleKey, enabled: true, notify_email: false },
        { onConflict: 'user_id,module_key' }
      );
    }
  );

  it.each(PERMISSION_BOUNDARIES)(
    'denies $moduleKey immediately below Level $minimumLevel',
    async ({ moduleKey, moduleName, minimumLevel }) => {
      const { upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveModuleAccessLevel.mockResolvedValue(minimumLevel - 1);

      const response = await putPreference({ module_key: moduleKey, notify_in_app: true });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Forbidden for this notification module' });
      expect(mockGetEffectiveModuleAccessLevel).toHaveBeenCalledExactlyOnceWith(moduleName);
      expect(upsert).not.toHaveBeenCalled();
    }
  );

  it.each(PERMISSION_BOUNDARIES)(
    'denies $moduleKey without a module grant',
    async ({ moduleKey }) => {
      const { upsert } = mockPreferenceClient(moduleKey);

      const response = await putPreference({ module_key: moduleKey, notify_email: true });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Forbidden for this notification module' });
      expect(upsert).not.toHaveBeenCalled();
    }
  );

  it.each<NotificationModuleKey>([
    'maintenance', 'inspections', 'absence', 'timesheets', 'inventory', 'processed_absence',
    'training', 'suggestions', 'toolbox_talks', 'reminders', 'quotes', 'general_notifications',
  ])('allows employee-safe %s preferences without a module grant', async (moduleKey) => {
    const { upsert } = mockPreferenceClient(moduleKey);
    mockGetEffectiveRole.mockResolvedValue(EMPLOYEE_ROLE);

    const response = await putPreference({ module_key: moduleKey, notify_email: true });

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(mockGetEffectiveModuleAccessLevel).not.toHaveBeenCalled();
  });

  it.each<NotificationModuleKey>(['rams', 'approvals'])(
    'preserves manager-role access to %s without a module grant',
    async (moduleKey) => {
      const { upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveRole.mockResolvedValue({
        ...EMPLOYEE_ROLE,
        role_name: 'manager',
        role_class: 'manager',
      });

      const response = await putPreference({ module_key: moduleKey, notify_email: false });

      expect(response.status).toBe(200);
      expect(upsert).toHaveBeenCalledTimes(1);
    }
  );

  it.each<NotificationModuleKey>(['errors', 'sensitive_pin_security'])(
    'does not grant a manager access to %s without module permission',
    async (moduleKey) => {
      const { upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveRole.mockResolvedValue({
        ...EMPLOYEE_ROLE,
        role_name: 'manager',
        role_class: 'manager',
        is_manager_admin: true,
      });

      const response = await putPreference({ module_key: moduleKey, notify_email: true });

      expect(response.status).toBe(403);
      expect(upsert).not.toHaveBeenCalled();
    }
  );

  it.each(ROLE_RESTRICTED_MODULES)(
    'preserves effective admin access to %s without an explicit grant',
    async (moduleKey) => {
      const { upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveRole.mockResolvedValue({
        ...EMPLOYEE_ROLE,
        role_name: 'admin',
        role_class: 'admin',
      });

      const response = await putPreference({ module_key: moduleKey, notify_email: true });

      expect(response.status).toBe(200);
      expect(upsert).toHaveBeenCalledTimes(1);
    }
  );

  it.each(PERMISSION_BOUNDARIES)(
    'does not restore actual admin access to $moduleKey while viewing as an employee',
    async ({ moduleKey }) => {
      const { upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveRole.mockResolvedValue({
        ...EMPLOYEE_ROLE,
        is_actual_super_admin: true,
        is_viewing_as: true,
      });

      const response = await putPreference({ module_key: moduleKey, notify_email: true });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Forbidden for this notification module' });
      expect(upsert).not.toHaveBeenCalled();
    }
  );

  it.each(PERMISSION_BOUNDARIES)(
    'honors effective $moduleKey grants while an actual admin views as an employee',
    async ({ moduleKey, minimumLevel }) => {
      const { upsert } = mockPreferenceClient(moduleKey);
      mockGetEffectiveRole.mockResolvedValue({
        ...EMPLOYEE_ROLE,
        is_actual_super_admin: true,
        is_viewing_as: true,
      });
      mockGetEffectiveModuleAccessLevel.mockResolvedValue(minimumLevel);

      const response = await putPreference({ module_key: moduleKey, notify_email: true });

      expect(response.status).toBe(200);
      expect(upsert).toHaveBeenCalledTimes(1);
    }
  );

  it.each(DISABLE_FIELDS)(
    'blocks below-supervisor users from disabling %s even with a module grant',
    async (field) => {
      const { upsert } = mockPreferenceClient('errors');
      mockGetEffectiveRole.mockResolvedValue(EMPLOYEE_ROLE);
      mockGetEffectiveModuleAccessLevel.mockResolvedValue(5);

      const response = await putPreference({ module_key: 'errors', [field]: false });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Only supervisors and above can disable notifications' });
      expect(upsert).not.toHaveBeenCalled();
      expect(mockGetEffectiveModuleAccessLevel).not.toHaveBeenCalled();
    }
  );

  it('does not restore the actual admin disable privilege while viewing as an employee', async () => {
    const { upsert } = mockPreferenceClient('reminders');
    mockGetEffectiveRole.mockResolvedValue({
      ...EMPLOYEE_ROLE,
      is_actual_super_admin: true,
      is_viewing_as: true,
    });

    const response = await putPreference({ module_key: 'reminders', notify_in_app: false });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only supervisors and above can disable notifications' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(DISABLE_FIELDS)('keeps Toolbox Talks mandatory when disabling %s', async (field) => {
    const { upsert } = mockPreferenceClient('toolbox_talks');
    mockGetEffectiveRole.mockResolvedValue({
      ...EMPLOYEE_ROLE,
      role_name: 'admin',
      role_class: 'admin',
      is_super_admin: true,
      is_actual_super_admin: true,
    });

    const response = await putPreference({ module_key: 'toolbox_talks', [field]: false });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Toolbox Talk notifications cannot be disabled' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['missing user', 'authentication error'])('rejects %s before authorization or writes', async (failure) => {
    const { getUser, from } = mockPreferenceClient();
    getUser.mockResolvedValue(failure === 'missing user'
      ? { data: { user: null }, error: null }
      : { data: { user: { id: 'user-1' } }, error: new Error('Invalid session') });

    const response = await putPreference({ module_key: 'general_notifications', notify_email: true });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockGetEffectiveRole).not.toHaveBeenCalled();
    expect(mockGetEffectiveModuleAccessLevel).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each([undefined, 'unknown_module'])('rejects invalid module key %s before writes', async (moduleKey) => {
    const { upsert } = mockPreferenceClient();

    const response = await putPreference({ module_key: moduleKey, notify_email: true });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid module_key');
    expect(upsert).not.toHaveBeenCalled();
    expect(mockGetEffectiveRole).not.toHaveBeenCalled();
  });

  it('scopes the upsert to the authenticated user, not a supplied user id or permission context', async () => {
    const { upsert } = mockPreferenceClient();

    const response = await putPreference({
      module_key: 'general_notifications',
      notify_email: true,
      user_id: 'another-user',
      is_super_admin: true,
      permissionLevels: { 'error-reports': 5 },
    });

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', module_key: 'general_notifications', enabled: true, notify_email: true },
      { onConflict: 'user_id,module_key' }
    );
  });

  it('does not trust client-supplied role or permission grants for a restricted module', async () => {
    const { upsert } = mockPreferenceClient('errors');

    const response = await putPreference({
      module_key: 'errors',
      notify_email: true,
      is_super_admin: true,
      permissionLevels: { 'error-reports': 5 },
    });

    expect(response.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('logs and exposes module permission lookup failures without writing', async () => {
    const { upsert } = mockPreferenceClient('errors');
    const error = new Error('Permission lookup failed');
    mockGetEffectiveModuleAccessLevel.mockRejectedValue(error);

    const response = await putPreference({ module_key: 'errors', notify_email: true });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: error.message });
    expect(mockLogServerError).toHaveBeenCalledWith(expect.objectContaining({
      error,
      additionalData: { endpoint: '/api/notification-preferences', method: 'PUT' },
    }));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('logs and exposes upsert errors rather than returning success', async () => {
    const { single } = mockPreferenceClient();
    const error = new Error('Preference save failed');
    single.mockResolvedValue({ data: null, error });

    const response = await putPreference({ module_key: 'general_notifications', notify_email: true });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: error.message });
    expect(mockLogServerError).toHaveBeenCalledWith(expect.objectContaining({ error }));
  });

  it('does not return empty success when an upsert returns no preference', async () => {
    const { single } = mockPreferenceClient();
    single.mockResolvedValue({ data: null, error: null });

    const response = await putPreference({ module_key: 'general_notifications', notify_email: true });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Notification preference was not saved' });
    expect(mockLogServerError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(Error),
    }));
  });

  it('normalizes nullable saved preference fields in a successful response', async () => {
    const { preference, single } = mockPreferenceClient();
    single.mockResolvedValue({
      data: {
        ...preference,
        enabled: null,
        notify_in_app: null,
        notify_email: null,
        created_at: null,
        updated_at: null,
      },
      error: null,
    });

    const response = await putPreference({ module_key: 'general_notifications', notify_in_app: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      preference: {
        ...preference,
        enabled: true,
        notify_in_app: true,
        notify_email: false,
        created_at: '',
        updated_at: '',
      },
    });
  });
});
