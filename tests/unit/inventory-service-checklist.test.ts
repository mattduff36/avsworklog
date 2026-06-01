import { describe, expect, it } from 'vitest';
import {
  INVENTORY_SERVICE_CHECKLIST_ITEMS,
  getInventoryCheckOverallStatus,
  getInventoryChecklistSummary,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';

describe('inventory service checklist', () => {
  it('preserves the scanned form item numbering and omits the blank row', () => {
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS).toHaveLength(27);
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS.map((item) => item.item_number)).not.toContain(27);
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS.at(0)).toEqual({ item_number: 1, label: 'Spark Plug' });
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS.at(-1)).toEqual({ item_number: 28, label: 'Oil Level' });
  });

  it('summarises checklist results and derives an overall result', () => {
    const results: InventoryChecklistItemResult[] = INVENTORY_SERVICE_CHECKLIST_ITEMS.map((item, index) => ({
      ...item,
      status: index === 0 ? 'attention' : index === 1 ? 'na' : 'ok',
      comment: index === 0 ? 'Needs replacement' : null,
    }));

    expect(getInventoryChecklistSummary(results)).toEqual({
      pass: 25,
      fail: 1,
      na: 1,
      total: 27,
    });
    expect(getInventoryCheckOverallStatus(results)).toBe('fail');
  });

  it('marks complete all-pass or not-applicable checklists as pass', () => {
    const results: InventoryChecklistItemResult[] = INVENTORY_SERVICE_CHECKLIST_ITEMS.map((item, index) => ({
      ...item,
      status: index % 3 === 0 ? 'na' : 'ok',
      comment: null,
    }));

    expect(getInventoryCheckOverallStatus(results)).toBe('pass');
  });
});
