import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/admin/users/list-with-emails/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/server/admin-users-module-access');

describe('protected Admin Users listing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies access before querying retained profiles', async () => {
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    expect((await GET()).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('includes a retained tombstone without a deleted-name suffix', async () => {
    vi.mocked(requireAdminUsersModuleAccess).mockResolvedValue(null);
    const retainedProfile = {
      id: 'deleted-profile',
      full_name: 'Former Employee',
      deleted_at: '2026-11-25T09:00:00Z',
    };
    const query = {
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [retainedProfile], error: null }),
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => query) })),
      auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }) } },
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).profiles).toEqual([retainedProfile]);
  });
});
