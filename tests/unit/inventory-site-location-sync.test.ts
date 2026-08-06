import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncProjectNumberSiteLocation, syncSiteLocation } from '@/lib/server/inventory-site-location-sync';
import type { InventoryAdminClient } from '@/lib/server/inventory-locations';

function createAdminMock(existing: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const limit = vi.fn(() => ({ maybeSingle }));
  const order = vi.fn(() => ({ limit }));
  const eqExternal = vi.fn(() => ({ order }));
  const eqType = vi.fn(() => ({ eq: eqExternal }));
  const select = vi.fn(() => ({ eq: eqType }));

  const updateSingle = vi.fn().mockResolvedValue({ data: { id: existing?.id || 'loc-1' }, error: null });
  const updateSelect = vi.fn(() => ({ single: updateSingle }));
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn(() => ({ eq: updateEq }));

  const insertSingle = vi.fn().mockResolvedValue({ data: { id: 'loc-new' }, error: null });
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  return {
    admin: {
      from: vi.fn(() => ({ select, update, insert })),
    } as unknown as InventoryAdminClient,
    update,
    insert,
  };
}

describe('inventory site location sync (project-owned)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an active project site for open project numbers', async () => {
    const { admin, insert } = createAdminMock(null);
    const result = await syncProjectNumberSiteLocation(admin, {
      id: 'project-1',
      project_reference: '80010-md',
      status: 'open',
      title: 'Site A',
      description: null,
    }, 'user-1');

    expect(result.action).toBe('created');
    expect(insert).toHaveBeenCalled();
  });

  it('skips converted and merged projects so quote DB ownership wins', async () => {
    const { admin, insert, update } = createAdminMock({
      id: 'loc-1',
      name: 'Site - 80010-MD - Site A',
      description: null,
      is_active: true,
      location_type: 'site',
      source_type: 'quote',
      source_id: 'quote-1',
      external_reference: '80010-MD',
      sync_status: 'synced',
    });

    const converted = await syncProjectNumberSiteLocation(admin, {
      id: 'project-1',
      project_reference: '80010-MD',
      status: 'converted',
      title: 'Site A',
      description: null,
    }, 'user-1');

    expect(converted.action).toBe('skipped');
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to archive a quote-owned site from project sync', async () => {
    const { admin } = createAdminMock({
      id: 'loc-1',
      name: 'Site - 80010-MD',
      description: null,
      is_active: true,
      location_type: 'site',
      source_type: 'quote',
      source_id: 'quote-1',
      external_reference: '80010-MD',
      sync_status: 'synced',
    });

    await expect(syncSiteLocation(admin, {
      sourceType: 'project_number',
      sourceId: 'project-1',
      externalReference: '80010-MD',
      name: 'Site - 80010-MD',
      description: null,
      isActive: false,
      actorUserId: 'user-1',
    })).rejects.toThrow(/own locations/i);
  });
});
