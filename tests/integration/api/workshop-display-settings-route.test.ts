import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/workshop-tasks/settings/display-board/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/server/display-board');

describe('Workshop Display settings authorization', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createClient } = await import('@/lib/supabase/server');
    const {
      canEffectiveRoleAccessModule,
      isEffectiveRoleManagerOrHigher,
    } = await import('@/lib/utils/rbac');
    const { getDisplayBoardAdminState } = await import('@/lib/server/display-board');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(isEffectiveRoleManagerOrHigher).mockResolvedValue(true);
    vi.mocked(getDisplayBoardAdminState).mockResolvedValue({
      config: {},
      active_pairing: null,
      devices: [],
    } as never);
  });

  it('AUTH-WORKSHOP-DISPLAY-01 allows Manager/Admin actors with Workshop access', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it('AUTH-WORKSHOP-DISPLAY-01 rejects employees with Workshop access', async () => {
    const { isEffectiveRoleManagerOrHigher } = await import('@/lib/utils/rbac');
    vi.mocked(isEffectiveRoleManagerOrHigher).mockResolvedValue(false);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('AUTH-WORKSHOP-DISPLAY-01 rejects managers without Workshop access', async () => {
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(false);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Unauthorized'),
        }),
      },
    } as never);

    const response = await GET();
    expect(response.status).toBe(401);
  });
});
