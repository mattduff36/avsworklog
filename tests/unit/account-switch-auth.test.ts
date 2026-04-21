import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

describe('account switch actor access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts Supabase-authenticated users without an app session row', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      validation: {
        status: 'active',
        session: null,
        profileId: 'user-1',
        email: 'user-1@example.com',
        cookieValue: null,
        cookieExpiresAt: null,
      },
      profile: {
        id: 'user-1',
        email: 'user-1@example.com',
      },
    } as never);

    const result = await getAccountSwitchActorAccess('/api/account-switch/settings');

    expect(result.errorResponse).toBeNull();
    expect(result.access).toEqual({
      userId: 'user-1',
      email: 'user-1@example.com',
    });
    expect(result.hasUser).toBe(true);
  });
});
