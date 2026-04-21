import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { POST } from '@/app/api/errors/log/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

describe('POST /api/errors/log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes client error logs using the current app-session user identity', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const insert = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
        email: 'user-1@example.com',
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'error_logs') {
          return { insert };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/errors/log', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
          'user-agent': 'Vitest',
        },
        body: JSON.stringify({
          logs: [
            {
              error_message: 'Client logger smoke test',
              error_type: 'Error',
              page_url: 'http://localhost/dashboard',
              user_agent: 'Browser UA',
              component_name: 'Console Error',
              additional_data: { source: 'test' },
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        error_message: 'Client logger smoke test',
        error_type: 'Error',
        user_id: 'user-1',
        user_email: 'user-1@example.com',
        component_name: 'Console Error',
      }),
    ]);
  });

  it('allows anonymous error logs when no session can be resolved', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const insert = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'error_logs') {
          return { insert };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/errors/log', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          error_message: 'Anonymous auth-edge failure',
          error_type: 'Error',
          page_url: 'http://localhost/login',
          user_agent: 'Browser UA',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        error_message: 'Anonymous auth-edge failure',
        user_id: null,
        user_email: null,
      }),
    ]);
  });

  it('rejects cross-origin error log submissions', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/errors/log', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example.com',
        },
        body: JSON.stringify({
          error_message: 'Blocked',
        }),
      })
    );

    expect(response.status).toBe(403);
  });
});
