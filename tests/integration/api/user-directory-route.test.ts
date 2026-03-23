import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/users/directory/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/utils/permissions');

describe('GET /api/users/directory', () => {
  function createDirectoryQuery(rows: Array<Record<string, unknown>>) {
    const order = vi.fn().mockResolvedValue({
      data: rows,
      error: null,
    });
    const query = {
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order,
    };

    return { query, order };
  }

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

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'user-2', full_name: 'Blake Blocked', employee_id: 'E002' },
    ]);
    const select = vi.fn().mockReturnValue(query);
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
    expect(query.not).toHaveBeenCalledWith('full_name', 'ilike', '%(Deleted User)%');
  });

  it('filters deleted users out by default', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { isEffectiveRoleManagerOrHigher } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(isEffectiveRoleManagerOrHigher).mockResolvedValue(true);

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'user-2', full_name: 'Pat Placeholder (Deleted User)', employee_id: 'E002' },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(new NextRequest('http://localhost/api/users/directory'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1', full_name: 'Alex Able' }),
    ]);
    expect(query.not).toHaveBeenCalledWith('full_name', 'ilike', '%(Deleted User)%');
  });

  it('can include deleted users when explicitly requested', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { isEffectiveRoleManagerOrHigher } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'manager-1' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(isEffectiveRoleManagerOrHigher).mockResolvedValue(true);

    const { query } = createDirectoryQuery([
      { id: 'user-1', full_name: 'Alex Able', employee_id: 'E001' },
      { id: 'user-2', full_name: 'Pat Placeholder (Deleted User)', employee_id: 'E002' },
    ]);
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/users/directory?includeDeleted=true')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.users).toEqual([
      expect.objectContaining({ id: 'user-1', full_name: 'Alex Able' }),
      expect.objectContaining({ id: 'user-2', full_name: 'Pat Placeholder (Deleted User)' }),
    ]);
    expect(query.not).not.toHaveBeenCalled();
  });
});
