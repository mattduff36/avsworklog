import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));
vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: vi.fn(),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));
vi.mock('@/lib/services/dvla-api', () => ({
  createDVLAApiService: vi.fn(),
}));
vi.mock('@/lib/services/mot-history-api', () => ({
  createMotHistoryService: vi.fn(),
}));
vi.mock('@/lib/services/fleet-dvla-sync', () => ({
  isRoadEligibleRegistration: vi.fn(() => false),
  runFleetDvlaSync: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { PUT as updateVan } from '@/app/api/admin/vans/[id]/route';
import { PUT as updateHgv } from '@/app/api/admin/hgvs/[id]/route';

function buildUpdateClient(
  tableName: 'vans' | 'hgvs',
  data: Record<string, unknown> | null,
) {
  const state = {
    updates: [] as Array<Record<string, unknown>>,
  };
  const client = {
    from(table: string) {
      if (table !== tableName) throw new Error(`Unexpected table ${table}`);
      return {
        update(updates: Record<string, unknown>) {
          state.updates.push(updates);
          return {
            eq() {
              return {
                select() {
                  return {
                    async maybeSingle() {
                      return { data, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, state };
}

function buildRequest(assetType: 'vans' | 'hgvs') {
  return new NextRequest(`http://localhost/api/admin/${assetType}/asset-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'Updated nickname' }),
  });
}

describe('admin fleet update routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'user-1',
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
  });

  it.each([
    ['van', 'vans', updateVan],
    ['HGV', 'hgvs', updateHgv],
  ] as const)('updates a %s through the authorized admin client', async (_label, table, handler) => {
    const { client, state } = buildUpdateClient(table, {
      id: 'asset-1',
      nickname: 'Updated nickname',
    });
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const response = await handler(
      buildRequest(table),
      { params: Promise.resolve({ id: 'asset-1' }) },
    );

    expect(response.status).toBe(200);
    expect(state.updates).toEqual([{ nickname: 'Updated nickname' }]);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('returns 404 instead of a single-row coercion error when a van is missing', async () => {
    const { client } = buildUpdateClient('vans', null);
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const response = await updateVan(
      buildRequest('vans'),
      { params: Promise.resolve({ id: 'missing-van' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Van not found' });
  });

  it('does not create an admin client when fleet access is denied', async () => {
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(false);

    const response = await updateVan(
      buildRequest('vans'),
      { params: Promise.resolve({ id: 'asset-1' }) },
    );

    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
