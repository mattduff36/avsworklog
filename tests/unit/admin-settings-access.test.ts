import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { requireAdminSettingsAccess } from '@/lib/server/admin-settings-access';
import { getModuleEnforcedMinimumAccessLevel } from '@/lib/config/permission-access-rules';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/server/sensitive-module-access');

describe('requireAdminSettingsAccess', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createClient } = await import('@/lib/supabase/server');
    const { canEffectiveRoleUseModuleLevel } = await import('@/lib/utils/rbac');
    const { requireSensitiveModuleAccess } = await import('@/lib/server/sensitive-module-access');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'delegate-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleUseModuleLevel).mockResolvedValue(true);
    vi.mocked(requireSensitiveModuleAccess).mockResolvedValue(null);
  });

  it('AUTH-ADMINSET-LEVEL-01 returns 401 when unauthenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Unauthorized'),
        }),
      },
    } as never);

    const access = await requireAdminSettingsAccess();
    expect(access.response?.status).toBe(401);
  });

  it('AUTH-ADMINSET-LEVEL-01 exposes Admin Settings only at effective level 5', () => {
    expect(getModuleEnforcedMinimumAccessLevel('admin-settings', 0)).toBe(5);
    expect(getModuleEnforcedMinimumAccessLevel('admin-settings', 4)).toBe(5);
  });

  it('AUTH-ADMINSET-LEVEL-01 rejects effective levels below 5', async () => {
    const { canEffectiveRoleUseModuleLevel } = await import('@/lib/utils/rbac');
    vi.mocked(canEffectiveRoleUseModuleLevel).mockResolvedValue(false);

    const access = await requireAdminSettingsAccess();
    expect(canEffectiveRoleUseModuleLevel).toHaveBeenCalledWith('admin-settings', 5);
    expect(access.response?.status).toBe(403);
  });

  it('AUTH-ADMINSET-PIN-01 forwards sensitive PIN challenges', async () => {
    const { requireSensitiveModuleAccess } = await import('@/lib/server/sensitive-module-access');
    vi.mocked(requireSensitiveModuleAccess).mockResolvedValue(
      NextResponse.json({ code: 'SENSITIVE_PIN_REQUIRED' }, { status: 428 })
    );

    const access = await requireAdminSettingsAccess();
    expect(requireSensitiveModuleAccess).toHaveBeenCalledWith('admin-settings');
    expect(access.response?.status).toBe(428);
  });

  it('AUTH-ADMINSET-ROLE-01 allows authenticated effective level-5 delegates', async () => {
    const access = await requireAdminSettingsAccess();
    expect(access).toEqual({ userId: 'delegate-1', response: null });
  });
});
