import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/daily-allocation/deployment-identity/route';
import { isPublicRequestPath } from '@/lib/routes/public-routes';

describe('deployment identity', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns only the immutable Vercel commit SHA without caching', async () => {
    const commitSha = 'a'.repeat(40);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', commitSha);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({ commit_sha: commitSha });
  });

  it('fails closed when deployment identity is unavailable or malformed', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'not-a-commit');
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Deployment commit identity is unavailable.',
    });
  });

  it('exposes only the exact read-only identity path through middleware', () => {
    expect(isPublicRequestPath('/api/daily-allocation/deployment-identity')).toBe(true);
    expect(isPublicRequestPath('/api/daily-allocation/deployment-identity-extra')).toBe(false);
    expect(isPublicRequestPath('/api/daily-allocation/runtime')).toBe(false);
  });
});
