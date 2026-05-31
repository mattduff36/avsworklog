import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { POST } from '@/app/api/me/usage-events/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { logServerError } from '@/lib/utils/server-error-logger';

function createAdminClientMock(options: { upsertError?: { message: string } | null } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const selectExistingSession = vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle })),
  }));
  const singleCreatedSession = vi.fn().mockResolvedValue({ data: { id: 'usage-session-1' }, error: null });
  const insertSession = vi.fn(() => ({
    select: vi.fn(() => ({ single: singleCreatedSession })),
  }));
  const upsertEvents = vi.fn().mockResolvedValue({ error: options.upsertError || null });

  return {
    maybeSingle,
    insertSession,
    upsertEvents,
    client: {
      from: vi.fn((table: string) => {
        if (table === 'user_usage_sessions') {
          return {
            select: selectExistingSession,
            insert: insertSession,
          };
        }
        if (table === 'user_usage_events') {
          return {
            upsert: upsertEvents,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    },
  };
}

describe('POST /api/me/usage-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const response = await POST(new NextRequest('http://localhost/api/me/usage-events', { method: 'POST' }));

    expect(response.status).toBe(401);
  });

  it('normalizes and inserts authenticated usage events', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminMock = createAdminClientMock();

    vi.mocked(createAdminClient).mockReturnValue(adminMock.client as never);
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'user-1' },
      validation: {
        session: { id: 'app-session-1' },
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/me/usage-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
          'user-agent': 'Mozilla/5.0 Chrome/120.0',
        },
        body: JSON.stringify({
          clientSessionId: 'client-session-1',
          device: {
            userAgent: 'Mozilla/5.0 Chrome/120.0',
            deviceType: 'desktop',
          },
          events: [
            {
              eventName: 'page_view',
              clientEventId: 'event-1',
              clientSessionId: 'client-session-1',
              occurredAt: '2026-05-28T08:00:00.000Z',
              path: '/timesheets/new?tab=current',
              metadata: {
                safe: 'value',
                password: 'should-not-store',
              },
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.inserted).toBe(1);
    expect(adminMock.insertSession).toHaveBeenCalled();
    expect(adminMock.upsertEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: 'user-1',
          app_session_id: 'app-session-1',
          event_name: 'page_view',
          event_category: 'navigation',
          module: 'timesheets',
          normalized_path: '/timesheets/new?tab=current',
          metadata: expect.objectContaining({
            safe: 'value',
            password: '[redacted]',
          }),
        }),
      ],
      {
        onConflict: 'client_event_id',
        ignoreDuplicates: true,
      }
    );
  });

  it('treats transient upstream telemetry failures as accepted without logging a production error', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminMock = createAdminClientMock({
      upsertError: {
        message: `<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>cloudflare</center>
</body>
</html>`,
      },
    });

    vi.mocked(createAdminClient).mockReturnValue(adminMock.client as never);
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: { id: 'user-1' },
      validation: {
        session: { id: 'app-session-1' },
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/me/usage-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          clientSessionId: 'client-session-1',
          events: [
            {
              eventName: 'page_view',
              clientEventId: 'event-1',
              clientSessionId: 'client-session-1',
              occurredAt: '2026-05-28T08:00:00.000Z',
              path: '/quotes',
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      success: false,
      inserted: 0,
      transient: true,
      error: 'Usage analytics temporarily unavailable',
    });
    expect(logServerError).not.toHaveBeenCalled();
  });
});
