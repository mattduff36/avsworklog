import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/server/user-analytics', () => ({
  insertClientUsageEvents: vi.fn(),
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { POST } from '@/app/api/me/usage-events/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { insertClientUsageEvents } from '@/lib/server/user-analytics';
import { logServerError } from '@/lib/utils/server-error-logger';

const FAILURE_MESSAGE = 'Failed to record usage analytics';

function request(origin?: string, body: unknown = { events: [] }) {
  return new NextRequest('http://localhost/api/me/usage-events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

function authenticate() {
  vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
    profile: { id: 'user-1' },
    validation: { session: { id: 'app-session-1' } },
  } as never);
}

describe('POST /api/me/usage-events empty failure logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without logging when the caller is unauthenticated', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(logServerError).not.toHaveBeenCalled();
  });

  it('returns 403 without logging when the origin does not match', async () => {
    const response = await POST(request('https://example.invalid'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(getCurrentAuthenticatedProfile).not.toHaveBeenCalled();
    expect(logServerError).not.toHaveBeenCalled();
  });

  it('returns 400 without logging when no valid usage events are supplied', async () => {
    authenticate();
    vi.mocked(insertClientUsageEvents).mockResolvedValue(0);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'No valid usage events supplied' });
    expect(logServerError).not.toHaveBeenCalled();
  });

  it('keeps transient fetch failures as 202 without a production error log', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockRejectedValue(new TypeError('fetch failed'));

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: false,
      inserted: 0,
      transient: true,
      error: 'Usage analytics temporarily unavailable',
    });
    expect(logServerError).not.toHaveBeenCalled();
  });

  it.each(['', '   ', '\n\t'])(
    'logs a blank Error and returns a non-empty 500 message for %j',
    async (message) => {
      const error = new Error(message);
      const stack = error.stack;
      vi.mocked(getCurrentAuthenticatedProfile).mockRejectedValue(error);

      const response = await POST(request());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: FAILURE_MESSAGE });
      expect(logServerError).toHaveBeenCalledTimes(1);
      expect(logServerError).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          componentName: '/api/me/usage-events',
        })
      );
      expect(error.message).toBe(FAILURE_MESSAGE);
      expect(error.stack).toBe(stack);
    }
  );

  it('preserves a non-empty Error message on the retained 500 response', async () => {
    const error = new Error('usage store rejected the batch');
    vi.mocked(getCurrentAuthenticatedProfile).mockRejectedValue(error);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'usage store rejected the batch' });
    expect(logServerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        componentName: '/api/me/usage-events',
      })
    );
  });
});
