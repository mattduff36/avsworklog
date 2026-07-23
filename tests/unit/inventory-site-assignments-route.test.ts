import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventorySupervisorAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/utils/permissions', () => ({
  getUsersWithPermission: vi.fn(),
}));

import { requireInventorySupervisorAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { DELETE, POST } from '@/app/api/inventory/site-assignments/route';

function buildRequest(method: 'POST' | 'DELETE', body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/inventory/site-assignments', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface LocationQuery {
  select: () => LocationQuery;
  eq: () => LocationQuery;
  in: () => LocationQuery;
  maybeSingle: () => Promise<{
    data: {
      id: string;
      name: string;
      location_type: 'site' | 'manual';
      is_active: boolean;
    };
    error: null;
  }>;
}

function buildAdmin(locationType: 'site' | 'manual' = 'site') {
  const state = {
    upserts: [] as Array<Record<string, unknown>>,
    deletes: [] as Array<Record<string, unknown>>,
  };
  const locationQuery = {} as LocationQuery;
  locationQuery.select = () => locationQuery;
  locationQuery.eq = () => locationQuery;
  locationQuery.in = () => locationQuery;
  locationQuery.maybeSingle = async () => ({
    data: {
      id: `${locationType}-location`,
      name: locationType === 'site' ? 'Site - 12345' : 'Storage Container',
      location_type: locationType,
      is_active: true,
    },
    error: null,
  });

  const admin = {
    from(table: string) {
      if (table === 'inventory_locations') return locationQuery;

      if (table === 'inventory_user_site_locations') {
        return {
          upsert(payload: Record<string, unknown>) {
            state.upserts.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return { data: payload, error: null };
                  },
                };
              },
            };
          },
          delete() {
            return {
              eq(column: string, value: string) {
                state.deletes.push({ [column]: value });
                return {
                  async eq(nextColumn: string, nextValue: string) {
                    state.deletes.push({ [nextColumn]: nextValue });
                    return { error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };

  return { admin, state };
}

describe('inventory location assignments route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks employees from assigning their own Site locations', async () => {
    vi.mocked(requireInventorySupervisorAccess).mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Supervisor or higher access required',
    });

    const response = await POST(buildRequest('POST', {
      user_id: 'user-1',
      location_id: 'site-location',
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Supervisor or higher access required',
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('allows supervisors to assign active Site locations', async () => {
    vi.mocked(requireInventorySupervisorAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'supervisor-1',
      roleName: 'supervisor',
    });
    const { admin, state } = buildAdmin();
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await POST(buildRequest('POST', {
      user_id: 'user-1',
      location_id: 'site-location',
    }));

    expect(response.status).toBe(200);
    expect(state.upserts).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        location_id: 'site-location',
        assigned_by: 'supervisor-1',
      }),
    ]);
  });

  it('allows supervisors to assign active Manual locations', async () => {
    vi.mocked(requireInventorySupervisorAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'supervisor-1',
      roleName: 'supervisor',
    });
    const { admin, state } = buildAdmin('manual');
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await POST(buildRequest('POST', {
      user_id: 'user-1',
      location_id: 'manual-location',
    }));

    expect(response.status).toBe(200);
    expect(state.upserts).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        location_id: 'manual-location',
        assigned_by: 'supervisor-1',
      }),
    ]);
  });

  it('allows supervisors to remove Site assignments', async () => {
    vi.mocked(requireInventorySupervisorAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'supervisor-1',
      roleName: 'supervisor',
    });
    const { admin, state } = buildAdmin();
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await DELETE(buildRequest('DELETE', {
      user_id: 'user-1',
      location_id: 'site-location',
    }));

    expect(response.status).toBe(200);
    expect(state.deletes).toEqual([
      { user_id: 'user-1' },
      { location_id: 'site-location' },
    ]);
  });
});
