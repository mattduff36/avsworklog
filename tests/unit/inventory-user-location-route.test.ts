import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryAccess: vi.fn(),
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));
vi.mock('@/lib/server/inventory-locations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/inventory-locations')>(
    '@/lib/server/inventory-locations',
  );
  return {
    ...actual,
    withEnrichedInventoryLocation: vi.fn(async (_admin, item) => {
      const location = item?.location
        ? (Array.isArray(item.location) ? item.location[0] : item.location)
        : null;
      return {
        ...item,
        location: location
          ? {
            ...location,
            assigned_user_names: location.assigned_user_names || [],
            linked_asset_type: location.linked_asset_type ?? null,
            linked_asset_label: location.linked_asset_label ?? null,
            linked_asset_nickname: location.linked_asset_nickname ?? null,
            item_count: location.item_count ?? 0,
          }
          : null,
      };
    }),
  };
});

import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { logServerError } from '@/lib/utils/server-error-logger';
import { PATCH } from '@/app/api/inventory/me/location/route';

interface LocationRow {
  id: string;
  name: string;
  is_active: boolean;
  location_type?: 'yard' | 'unknown' | 'van' | 'hgv' | 'plant' | 'site' | 'manual';
  linked_van_id?: string | null;
  linked_hgv_id?: string | null;
  linked_plant_id?: string | null;
}

interface BuildAdminOptions {
  location: LocationRow;
  conflictingAssignments?: Array<{ user_id: string }>;
  conflictingFleetAssignments?: Array<{ user_id: string }>;
  existingUserLocation?: { location_id: string | null; location?: { is_active: boolean | null } | null } | null;
  rpcError?: { code?: string; message: string } | null;
}

function buildRequest(locationId: string) {
  return new NextRequest('http://localhost/api/inventory/me/location', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_id: locationId }),
  });
}

function buildAdmin({
  location,
  conflictingAssignments = [],
  conflictingFleetAssignments = [],
  existingUserLocation = null,
  rpcError = null,
}: BuildAdminOptions) {
  const state = {
    conflictQueryCount: 0,
    fleetConflictQueryCount: 0,
    upserts: [] as Array<Record<string, unknown>>,
    rpcs: [] as Array<{ name: string; payload: Record<string, unknown> }>,
  };

  const admin = {
    async rpc(name: string, payload: Record<string, unknown>) {
      state.rpcs.push({ name, payload });
      return { data: null, error: rpcError };
    },
    from(table: string) {
      if (table === 'inventory_locations') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: location, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'inventory_user_locations') {
        return {
          select(columns: string) {
            if (columns.trim() === 'user_id') {
              return {
                eq() {
                  return {
                    neq() {
                      return {
                        async limit() {
                          state.conflictQueryCount += 1;
                          return { data: conflictingAssignments, error: null };
                        },
                      };
                    },
                  };
                },
              };
            }

            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: existingUserLocation, error: null };
                  },
                  async single() {
                    return {
                      data: {
                        user_id: 'user-1',
                        location_id: location.id,
                        location,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          upsert(payload: Record<string, unknown>) {
            state.upserts.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: {
                        user_id: payload.user_id,
                        location_id: payload.location_id,
                        location,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'profile_fleet_assignments') {
        return {
          select(columns: string) {
            if (columns.trim() === 'user_id') {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        neq() {
                          return {
                            async limit() {
                              state.fleetConflictQueryCount += 1;
                              return { data: conflictingFleetAssignments, error: null };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            }

            return {
              eq() {
                return {
                  is() {
                    return {
                      async maybeSingle() {
                        return { data: null, error: null };
                      },
                    };
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

describe('inventory user location route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
      teamId: 'transport',
      teamName: 'Transport',
    });
  });

  it('rejects a non-workshop user selecting an assigned Yard location', async () => {
    const { admin, state } = buildAdmin({
      location: { id: 'yard-location', name: 'Yard', is_active: true },
      conflictingAssignments: [{ user_id: 'user-2' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(buildRequest('yard-location'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Location is already assigned to another user' });
    expect(state.conflictQueryCount).toBe(1);
    expect(state.upserts).toHaveLength(0);
  });

  it('allows a workshop user to share Yard as their primary location', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
      teamId: 'workshop_yard',
      teamName: 'Workshop and Yard',
    });
    const { admin, state } = buildAdmin({
      location: { id: 'yard-location', name: 'Yard', is_active: true },
      conflictingAssignments: [{ user_id: 'user-2' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(buildRequest('yard-location'));

    expect(response.status).toBe(200);
    expect(state.conflictQueryCount).toBe(0);
    expect(state.rpcs).toEqual([
      {
        name: 'inventory_set_user_location_with_assignment',
        payload: expect.objectContaining({
          p_user_id: 'user-1',
          p_location_id: 'yard-location',
          p_actor_user_id: 'user-1',
        }),
      },
    ]);
    expect(state.upserts).toHaveLength(0);
  });

  it('still rejects assigned non-Yard locations for workshop users', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
      teamId: 'workshop_yard',
      teamName: 'Workshop and Yard',
    });
    const { admin, state } = buildAdmin({
      location: { id: 'stores-location', name: 'Stores', is_active: true },
      conflictingAssignments: [{ user_id: 'user-2' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(buildRequest('stores-location'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Location is already assigned to another user' });
    expect(state.conflictQueryCount).toBe(1);
    expect(state.upserts).toHaveLength(0);
  });

  it('rejects Site locations as primary user locations', async () => {
    const { admin, state } = buildAdmin({
      location: {
        id: 'site-location',
        name: 'Site - 12345',
        is_active: true,
        location_type: 'site',
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(buildRequest('site-location'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Site locations can only be assigned as secondary locations by a supervisor or higher',
    });
    expect(state.conflictQueryCount).toBe(0);
    expect(state.upserts).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);
  });

  it('rejects a fleet location when its linked asset is already assigned', async () => {
    const { admin, state } = buildAdmin({
      location: {
        id: 'van-location',
        name: 'Van - AB12 CDE',
        is_active: true,
        location_type: 'van',
        linked_van_id: 'van-1',
      },
      conflictingFleetAssignments: [{ user_id: 'user-2' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(buildRequest('van-location'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'This fleet asset is already assigned to another user',
    });
    expect(state.fleetConflictQueryCount).toBe(1);
    expect(state.rpcs).toHaveLength(0);
  });

  it('maps message-only duplicate assignment errors to a controlled conflict response', async () => {
    const { admin } = buildAdmin({
      location: {
        id: 'manual-location',
        name: 'Manual location',
        is_active: true,
        location_type: 'manual',
      },
      rpcError: {
        message: 'duplicate key value violates unique constraint profile_fleet_assignments_current_van_uidx',
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(buildRequest('manual-location'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'This fleet asset is already assigned to another user',
    });
    expect(logServerError).not.toHaveBeenCalled();
  });

  it('records unexpected assignment failures for server-side investigation', async () => {
    const rpcError = { code: 'XX000', message: 'Unexpected assignment failure' };
    const { admin } = buildAdmin({
      location: {
        id: 'manual-location',
        name: 'Manual location',
        is_active: true,
        location_type: 'manual',
      },
      rpcError,
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(buildRequest('manual-location'));

    expect(response.status).toBe(500);
    expect(logServerError).toHaveBeenCalledWith(expect.objectContaining({
      error: rpcError,
      componentName: '/api/inventory/me/location',
      additionalData: {
        endpoint: '/api/inventory/me/location',
        method: 'PATCH',
      },
    }));
  });
});
