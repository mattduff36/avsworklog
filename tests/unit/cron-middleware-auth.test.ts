import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

describe('cron middleware auth', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows authorized scheduled cron requests without an app session', async () => {
    const response = await updateSession(
      new NextRequest('http://localhost/api/maintenance/sync-dvla-scheduled', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('rejects unauthorized scheduled cron requests', async () => {
    const response = await updateSession(
      new NextRequest('http://localhost/api/maintenance/sync-dvla-scheduled')
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('does not bypass unrelated API routes with the cron bearer token', async () => {
    const response = await updateSession(
      new NextRequest('http://localhost/api/maintenance/sync-dvla', {
        headers: {
          authorization: 'Bearer cron-secret',
        },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});
