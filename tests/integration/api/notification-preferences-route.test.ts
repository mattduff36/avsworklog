import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockCreateClient, mockGetProfileWithRole } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetProfileWithRole: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/permissions', () => ({
  getProfileWithRole: mockGetProfileWithRole,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

describe('/api/notification-preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProfileWithRole.mockResolvedValue({
      role: { role_class: 'employee', is_super_admin: false, is_manager_admin: false },
      is_super_admin: false,
    });
  });

  it('re-enables a preference row when saving visible channel toggles', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'pref-1',
        user_id: 'user-1',
        module_key: 'general_notifications',
        enabled: true,
        notify_in_app: false,
        notify_email: true,
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select }));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'notification_preferences') {
          return { upsert };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { PUT } = await import('@/app/api/notification-preferences/route');

    const response = await PUT(
      new NextRequest('http://localhost/api/notification-preferences', {
        method: 'PUT',
        body: JSON.stringify({
          module_key: 'general_notifications',
          notify_in_app: false,
          notify_email: true,
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
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
  });
});
