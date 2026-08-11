import { describe, expect, it } from 'vitest';
import {
  INVENTORY_PAT_CHECKLIST_ITEMS,
  INVENTORY_PAT_CHECKLIST_VERSION,
  INVENTORY_SERVICE_CHECKLIST_ITEMS,
  INVENTORY_SERVICE_CHECKLIST_ITEMS_V1,
  INVENTORY_SERVICE_CHECKLIST_VERSION,
  INVENTORY_SERVICE_CHECKLIST_VERSION_V1,
  getInventoryChecklistDefinition,
  getInventoryChecklistLabel,
  getInventoryCheckOverallStatus,
  getInventoryChecklistSummary,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';

describe('inventory service checklist', () => {
  it('defines the sequential v2 Regular Check items', () => {
    expect(INVENTORY_SERVICE_CHECKLIST_VERSION).toBe('minor-plant-equipment-service-record-v2');
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS).toEqual([
      { item_number: 1, label: 'Spark Plug' },
      { item_number: 2, label: 'HT Lead and Plug Cover' },
      { item_number: 3, label: 'Main Filter' },
      { item_number: 4, label: 'Pull cord' },
      { item_number: 5, label: 'Fuel System' },
      { item_number: 6, label: 'Vibration Suppression' },
      { item_number: 7, label: 'Fuel Cap' },
      { item_number: 8, label: 'Carrying Handles' },
      { item_number: 9, label: 'Safety Shields' },
      { item_number: 10, label: 'Base Plate Condition' },
      { item_number: 11, label: 'Couplings' },
      { item_number: 12, label: 'Throttle Cable' },
      { item_number: 13, label: 'Water Hose & Unions' },
      { item_number: 14, label: 'Plant Tag Fitted and Complete' },
      { item_number: 15, label: 'Blade Cover Debris Free' },
      { item_number: 16, label: 'Oil Level' },
      { item_number: 17, label: 'Breaker Hose' },
      { item_number: 18, label: 'Fittings' },
      { item_number: 19, label: 'Grease' },
      { item_number: 20, label: 'Point Condition' },
    ]);
  });

  it('keeps the legacy v1 Regular Check definition resolvable', () => {
    const v1Definition = getInventoryChecklistDefinition(INVENTORY_SERVICE_CHECKLIST_VERSION_V1);
    expect(v1Definition).not.toBeNull();
    expect(v1Definition?.items).toEqual(INVENTORY_SERVICE_CHECKLIST_ITEMS_V1);
    expect(INVENTORY_SERVICE_CHECKLIST_ITEMS_V1).toHaveLength(27);
    expect(getInventoryChecklistLabel(INVENTORY_SERVICE_CHECKLIST_VERSION_V1)).toBe('Regular Check');
  });

  it('defines the PAT checklist items and label', () => {
    expect(INVENTORY_PAT_CHECKLIST_ITEMS).toEqual([
      { item_number: 1, label: 'Cable' },
      { item_number: 2, label: 'Appliance' },
      { item_number: 3, label: 'Plug (Ext/Int)' },
      { item_number: 4, label: 'Earth' },
      { item_number: 5, label: 'Insulation' },
      { item_number: 6, label: 'Polarity' },
    ]);
    expect(getInventoryChecklistLabel(INVENTORY_PAT_CHECKLIST_VERSION)).toBe('PAT Test');
  });

  it('summarises checklist results and derives an overall result', () => {
    const results: InventoryChecklistItemResult[] = INVENTORY_SERVICE_CHECKLIST_ITEMS.map((item, index) => ({
      ...item,
      status: index === 0 ? 'attention' : index === 1 ? 'na' : 'ok',
      comment: index === 0 ? 'Needs replacement' : null,
    }));

    expect(getInventoryChecklistSummary(results)).toEqual({
      pass: 18,
      fail: 1,
      na: 1,
      total: 20,
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

  it('derives PAT checklist status using the PAT definition length', () => {
    const patDefinition = getInventoryChecklistDefinition(INVENTORY_PAT_CHECKLIST_VERSION);
    if (!patDefinition) throw new Error('PAT checklist definition missing');

    const results: InventoryChecklistItemResult[] = INVENTORY_PAT_CHECKLIST_ITEMS.map((item, index) => ({
      ...item,
      status: index === 0 ? 'attention' : 'ok',
      comment: index === 0 ? 'Cable damaged' : null,
    }));

    expect(getInventoryCheckOverallStatus(results, patDefinition)).toBe('fail');
  });
});
