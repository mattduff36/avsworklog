import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { GET } from '@/app/api/customers/route';

const {
  mockCreateAdminClient,
  mockGetCurrentAuthenticatedProfile,
  mockGetPermissionMapForUser,
  mockGetEffectiveRole,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockGetCurrentAuthenticatedProfile: vi.fn(),
  mockGetPermissionMapForUser: vi.fn(),
  mockGetEffectiveRole: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mockGetCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/server/team-permissions', () => ({
  getPermissionMapForUser: mockGetPermissionMapForUser,
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockGetEffectiveRole,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

function createCustomerListQuery(rows: Array<Record<string, unknown>>) {
  const range = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order = vi.fn().mockReturnValue({ range });
  const select = vi.fn().mockReturnValue({ order });

  return { select, order, range };
}

describe('GET /api/customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the customer directory when the user has customers module access', async () => {
    mockGetCurrentAuthenticatedProfile.mockResolvedValue({
      profile: { id: 'user-1' },
    });
    mockGetEffectiveRole.mockResolvedValue({
      role_id: 'role-1',
      role_name: 'manager',
      role_class: 'manager',
      is_super_admin: false,
      is_actual_super_admin: false,
      is_viewing_as: false,
      team_id: 'team-1',
    });
    mockGetPermissionMapForUser.mockResolvedValue({
      customers: true,
    });

    const { select, range } = createCustomerListQuery([
      { id: 'customer-1', company_name: 'Acme Ltd' },
      { id: 'customer-2', company_name: 'Bravo Ltd' },
    ]);

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select,
      })),
    } as unknown as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/customers?limit=10&offset=5'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetPermissionMapForUser).toHaveBeenCalledWith(
      'user-1',
      'role-1',
      expect.any(Object),
      'team-1'
    );
    expect(range).toHaveBeenCalledWith(5, 14);
    expect(payload.customers).toEqual([
      { id: 'customer-1', company_name: 'Acme Ltd' },
      { id: 'customer-2', company_name: 'Bravo Ltd' },
    ]);
  });

  it('returns 403 when the user does not have customers module access', async () => {
    mockGetCurrentAuthenticatedProfile.mockResolvedValue({
      profile: { id: 'user-2' },
    });
    mockGetEffectiveRole.mockResolvedValue({
      role_id: 'role-2',
      role_name: 'employee',
      role_class: 'employee',
      is_super_admin: false,
      is_actual_super_admin: false,
      is_viewing_as: false,
      team_id: 'team-2',
    });
    mockGetPermissionMapForUser.mockResolvedValue({
      customers: false,
    });
    mockCreateAdminClient.mockReturnValue({} as SupabaseClient);

    const response = await GET(new NextRequest('http://localhost/api/customers'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: 'Forbidden' });
  });
});
