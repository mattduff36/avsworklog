import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { GET } from '@/app/api/debug/user-analytics/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

function createAnalyticsAdminMock() {
  const eventLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'event-1',
        occurred_at: '2026-05-28T08:00:00.000Z',
        event_name: 'page_view',
        event_category: 'navigation',
        module: 'timesheets',
        path: '/timesheets',
        normalized_path: '/timesheets',
        user_id: 'user-1',
        session_id: 'session-1',
        duration_ms: 120,
        metadata: { source: 'test' },
        profile: {
          full_name: 'User One',
          team: [{ name: 'Civils' }],
          role: [{ display_name: 'Employee' }],
        },
        session: { device_type: 'desktop' },
      },
    ],
    error: null,
  });
  const eventOrder = vi.fn(() => ({ limit: eventLimit }));
  const eventLte = vi.fn(() => ({ order: eventOrder }));
  const eventGte = vi.fn(() => ({ lte: eventLte }));
  const eventSelect = vi.fn(() => ({ gte: eventGte }));

  const sessionLimit = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'session-1',
        user_id: 'user-1',
        last_seen_at: '2026-05-28T08:01:00.000Z',
        entry_path: '/dashboard',
        exit_path: '/timesheets',
        device_type: 'desktop',
        browser_name: 'Chrome',
        event_count: 3,
        page_view_count: 1,
        profile: {
          full_name: 'User One',
          team: [{ name: 'Civils' }],
          role: [{ display_name: 'Employee' }],
        },
      },
    ],
    error: null,
  });
  const sessionOrder = vi.fn(() => ({ limit: sessionLimit }));
  const sessionGte = vi.fn(() => ({ order: sessionOrder }));
  const sessionSelect = vi.fn(() => ({ gte: sessionGte }));

  return {
    from: vi.fn((table: string) => {
      if (table === 'user_usage_events') {
        return { select: eventSelect };
      }
      if (table === 'user_usage_sessions') {
        return { select: sessionSelect };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe('GET /api/debug/user-analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when the caller is not authenticated', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/debug/user-analytics'));

    expect(response.status).toBe(401);
  });

  it('returns usage analytics for a debug-console user', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'admin-1', email: 'admin@example.com' },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'role-1',
      role_name: 'super_admin',
      display_name: 'Super Admin',
      role_class: 'admin',
      is_manager_admin: true,
      is_super_admin: true,
      is_viewing_as: false,
      is_actual_super_admin: true,
      user_id: 'admin-1',
      team_id: null,
      team_name: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(createAnalyticsAdminMock() as never);

    const response = await GET(new NextRequest('http://localhost/api/debug/user-analytics?range=7d'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual(
      expect.objectContaining({
        totalEvents: 1,
        uniqueUsers: 1,
        pageViews: 1,
        activeSessions: 1,
      })
    );
    expect(payload.topModules).toEqual([
      expect.objectContaining({
        module: 'timesheets',
        events: 1,
      }),
    ]);
    expect(payload.recentEvents[0]).toEqual(
      expect.objectContaining({
        eventName: 'page_view',
        userName: 'User One',
        sessionId: 'session-1',
      })
    );
  });
});
