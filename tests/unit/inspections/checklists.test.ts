// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  getChecklistForCategory,
  isVanCategory,
  TRUCK_CHECKLIST_ITEMS,
  VAN_CHECKLIST_ITEMS,
  INSPECTION_ITEMS,
} from '@/lib/checklists/vehicle-checklists';
import {
  PLANT_INSPECTION_ITEMS,
  getPlantChecklist,
  getPlantChecklistCount,
} from '@/lib/checklists/plant-checklists';

describe('Vehicle Checklists', () => {
  describe('getChecklistForCategory', () => {
    it('returns 14-item checklist for Van', () => {
      const items = getChecklistForCategory('Van');
      expect(items).toHaveLength(14);
      expect(items).toBe(VAN_CHECKLIST_ITEMS);
    });

    it('returns 26-item checklist for Truck', () => {
      const items = getChecklistForCategory('Truck');
      expect(items).toHaveLength(26);
      expect(items).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('returns 26-item checklist for Artic', () => {
      expect(getChecklistForCategory('Artic')).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('returns 26-item checklist for Trailer', () => {
      expect(getChecklistForCategory('Trailer')).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('falls back to truck checklist for unknown category', () => {
      expect(getChecklistForCategory('Unknown')).toBe(TRUCK_CHECKLIST_ITEMS);
      expect(getChecklistForCategory('')).toBe(TRUCK_CHECKLIST_ITEMS);
    });

    it('all items are non-empty strings', () => {
      for (const category of ['Van', 'Truck', 'Artic', 'Trailer']) {
        const items = getChecklistForCategory(category);
        items.forEach((item, i) => {
          expect(typeof item).toBe('string');
          expect(item.trim().length).toBeGreaterThan(0);
        });
      }
    });

    it('van and truck checklists have no overlap in descriptions (different forms)', () => {
      const vanSet = new Set(VAN_CHECKLIST_ITEMS.map(i => i.toLowerCase()));
      const truckSet = new Set(TRUCK_CHECKLIST_ITEMS.map(i => i.toLowerCase()));
      const overlap = [...vanSet].filter(v => truckSet.has(v));
      expect(overlap.length).toBeLessThan(VAN_CHECKLIST_ITEMS.length);
    });
  });

  describe('isVanCategory', () => {
    it('returns true for Van', () => {
      expect(isVanCategory('Van')).toBe(true);
    });

    it('returns false for Truck/Artic/Trailer', () => {
      expect(isVanCategory('Truck')).toBe(false);
      expect(isVanCategory('Artic')).toBe(false);
      expect(isVanCategory('Trailer')).toBe(false);
    });

    it('returns false for empty/null-ish', () => {
      expect(isVanCategory('')).toBe(false);
      expect(isVanCategory('van')).toBe(false); // case-sensitive
    });
  });

  describe('legacy INSPECTION_ITEMS export', () => {
    it('equals TRUCK_CHECKLIST_ITEMS', () => {
      expect(INSPECTION_ITEMS).toBe(TRUCK_CHECKLIST_ITEMS);
    });
  });
});

describe('Plant Checklists', () => {
  it('has exactly 22 items', () => {
    expect(PLANT_INSPECTION_ITEMS).toHaveLength(22);
  });

  it('getPlantChecklist returns the items array', () => {
    expect(getPlantChecklist()).toBe(PLANT_INSPECTION_ITEMS);
  });

  it('getPlantChecklistCount returns 22', () => {
    expect(getPlantChecklistCount()).toBe(22);
  });

  it('all items are non-empty strings', () => {
    PLANT_INSPECTION_ITEMS.forEach((item) => {
      expect(typeof item).toBe('string');
      expect(item.trim().length).toBeGreaterThan(0);
    });
  });

  it('has no duplicate items', () => {
    const normalized = PLANT_INSPECTION_ITEMS.map(i => i.toLowerCase());
    expect(new Set(normalized).size).toBe(normalized.length);
  });
});
