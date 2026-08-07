import { describe, expect, it } from 'vitest';
import { buildInventoryItemDetailsUpdatePayload } from '@/lib/inventory/check-update-payload';

describe('INV-CHECK-PATCH-001 inventory detail update payload', () => {
  it('omits last_checked_at when check history exists', () => {
    const payload = buildInventoryItemDetailsUpdatePayload({
      item_number: 'AVS1',
      name: 'Drill',
      category: 'tools',
      location_id: 'loc-1',
      last_checked_at: '2026-05-01',
      check_interval_days: 30,
      hasCheckHistory: true,
    });

    expect(payload).toEqual({
      item_number: 'AVS1',
      name: 'Drill',
      category: 'tools',
      location_id: 'loc-1',
      check_interval_days: 30,
    });
    expect(payload).not.toHaveProperty('last_checked_at');
  });

  it('includes last_checked_at for legacy items without history', () => {
    const payload = buildInventoryItemDetailsUpdatePayload({
      item_number: 'AVS1',
      name: 'Drill',
      category: 'tools',
      location_id: 'loc-1',
      last_checked_at: '2026-05-01',
      check_interval_days: 30,
      hasCheckHistory: false,
    });

    expect(payload).toMatchObject({
      last_checked_at: '2026-05-01',
    });
  });
});
