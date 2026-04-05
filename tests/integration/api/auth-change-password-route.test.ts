import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateUserById = vi.fn();
const profileEq = vi.fn();
const profileUpdate = vi.fn(() => ({ eq: profileEq }));
const from = vi.fn(() => ({ update: profileUpdate }));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        updateUserById,
      },
    },
    from,
  })),
}));

import { POST as changePasswordPost } from '@/app/api/auth/change-password/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

describe('auth change-password route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileEq.mockResolvedValue({ error: null });
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
      },
      validation: {
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    updateUserById.mockResolvedValue({ error: null });
  });

  it('preserves leading and trailing whitespace when updating the password', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: '  padded-secret  ',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(updateUserById).toHaveBeenCalledWith('user-1', {
      password: '  padded-secret  ',
    });
  });

  it('rejects passwords that are only whitespace', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: '   ',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Password is required');
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
