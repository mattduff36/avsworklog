import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  getEffectiveRole: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mocks.getCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mocks.getEffectiveRole,
}));

import { requireDebugConsoleAccess } from '@/lib/server/debug-console-access';

describe('requireDebugConsoleAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: {
        id: 'superadmin-profile',
        email: 'admin@example.com',
      },
    });
    mocks.getEffectiveRole.mockResolvedValue({
      is_actual_super_admin: true,
      is_viewing_as: false,
    });
  });

  it('allows eligible users without checking a sensitive PIN', async () => {
    const access = await requireDebugConsoleAccess();

    expect(access).toMatchObject({
      ok: true,
      status: 200,
      error: null,
      profileId: 'superadmin-profile',
    });
  });

  it('rejects users who are not on the debug allow-list', async () => {
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: {
        id: 'employee-profile',
        email: 'employee@example.com',
      },
    });
    mocks.getEffectiveRole.mockResolvedValue({
      is_actual_super_admin: false,
      is_viewing_as: false,
    });

    const access = await requireDebugConsoleAccess();

    expect(access).toMatchObject({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });
  });
});
