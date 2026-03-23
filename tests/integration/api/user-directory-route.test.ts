import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/users/directory/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/utils/permissions');

describe('GET /api/users/directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/users/directory'));
    expect(response.status).toBe(401);
  });

  it('returns 403 when caller is not manager or higher', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { isEffectiveRoleManagerOrHigher } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(isEffectiveRoleManagerOrHigher).mockResolvedValue(false);

    const response = await GET(new NextRequest('http://localhost/api/users/directory'));
    expect(response.status).toBe(403);
  });

  it('returns users with module access flags when a module is requested', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { isEffectiveRoleManagerOrHigher } = await import('@/lib/utils/rbac');
    const { getUsersWithPermission } = await import('@/lib/utils/permissions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(isEffectiveRoleManagerOrHigher).mockResolvedValue(true);
    vi.mocked(getUsersWithPermission).mockResolvedValue(['user-1']);

    const order = vi.fn().mockResolvedValue({
      data: [
        { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
        { id: 'user-2', full_name: 'Blake Blocked', employee_id: 'E002' },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/users/directory?module=rams')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getUsersWithPermission).toHaveBeenCalledWith('rams');
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1', has_module_access: true }),
      expect.objectContaining({ id: 'user-2', has_module_access: false }),
    ]);
  });
});
