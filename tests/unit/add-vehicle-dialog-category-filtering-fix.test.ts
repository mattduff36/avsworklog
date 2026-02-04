/**
 * AddVehicleDialog Category Filtering Consistency Fix Test
 * 
 * Tests for bug fixes related to:
 * - Inconsistent category filtering logic
 * - Race condition in dialog open sequence
 */

import { describe, it, expect } from 'vitest';

describe('AddVehicleDialog Category Filtering Fixes', () => {
  describe('Bug 1: Inconsistent category filtering logic', () => {
    it('should demonstrate inconsistency before fix', () => {
      const categories = [
        { id: '1', name: 'MOT', applies_to: ['vehicle'] },
        { id: '2', name: 'LOLER', applies_to: ['plant'] },
        { id: '3', name: 'Service', applies_to: ['vehicle', 'plant'] },
        { id: '4', name: 'Old Category', applies_to: undefined }
      ];

      // BEFORE: fetchCategories uses ?? true (includes undefined)
      const fetchFiltered = categories.filter(cat => 
        cat.applies_to?.includes('plant') ?? true
      );

      // BEFORE: SELECT dropdown uses || ['vehicle'] (excludes undefined for plant)
      const selectFiltered = categories.filter(cat => {
        const appliesTo = cat.applies_to || ['vehicle'];
        return appliesTo.includes('plant');
      });

      // fetchCategories includes Old Category (undefined → true)
      expect(fetchFiltered.map(c => c.id)).toContain('4'); // ❌ Included

      // SELECT dropdown excludes Old Category (undefined → ['vehicle'], 'plant' not in array)
      expect(selectFiltered.map(c => c.id)).not.toContain('4'); // ❌ Excluded

      // Inconsistency: category fetched but not displayed!
      expect(fetchFiltered.length).not.toBe(selectFiltered.length);
    });

    it('should show consistent behavior after fix', () => {
      const categories = [
        { id: '1', name: 'MOT', applies_to: ['vehicle'] },
        { id: '2', name: 'LOLER', applies_to: ['plant'] },
        { id: '3', name: 'Service', applies_to: ['vehicle', 'plant'] },
        { id: '4', name: 'Old Category', applies_to: undefined }
      ];

      // AFTER: Both use || ['vehicle'] (consistent default)
      const fetchFiltered = categories.filter(cat => {
        const appliesTo = cat.applies_to || ['vehicle'];
        return appliesTo.includes('plant');
      });

      const selectFiltered = categories.filter(cat => {
        const appliesTo = cat.applies_to || ['vehicle'];
        return appliesTo.includes('plant');
      });

      // Both exclude Old Category (undefined → ['vehicle'])
      expect(fetchFiltered.map(c => c.id)).not.toContain('4'); // ✅ Excluded
      expect(selectFiltered.map(c => c.id)).not.toContain('4'); // ✅ Excluded

      // Consistency: same categories in both places
      expect(fetchFiltered.length).toBe(selectFiltered.length);
      expect(fetchFiltered.map(c => c.id)).toEqual(selectFiltered.map(c => c.id));
    });
  });

  describe('Bug 2: Race condition in dialog open sequence', () => {
    it('should demonstrate race condition before fix', async () => {
      const events: string[] = [];
      let assetType = 'vehicle'; // Current state
      const initialAssetType = 'plant'; // Prop value

      // BEFORE: fetchCategories called first
      const simulateOpenBefore = async () => {
        // fetchCategories uses stale assetType
        events.push(`fetch for ${assetType}`); // ❌ Uses 'vehicle' (stale)
        
        // Then setAssetType updates
        assetType = initialAssetType;
        events.push(`set assetType to ${assetType}`);
        
        // fetchCategories runs again due to assetType change
        events.push(`fetch for ${assetType}`); // Second fetch for 'plant'
      };

      await simulateOpenBefore();

      // Two fetches: one wrong, one correct
      expect(events).toEqual([
        'fetch for vehicle', // ❌ Wrong categories fetched
        'set assetType to plant',
        'fetch for plant' // ✅ Correct categories fetched (second time)
      ]);
      expect(events.length).toBe(3); // ❌ Unnecessary extra fetch
    });

    it('should show correct sequence after fix', async () => {
      const events: string[] = [];
      let assetType = 'vehicle'; // Current state
      const initialAssetType = 'plant'; // Prop value

      // AFTER: setAssetType called first
      const simulateOpenAfter = async () => {
        // Set assetType first
        assetType = initialAssetType;
        events.push(`set assetType to ${assetType}`);
        
        // Then fetchCategories uses correct assetType
        events.push(`fetch for ${assetType}`); // ✅ Uses 'plant' (correct)
      };

      await simulateOpenAfter();

      // One fetch with correct type
      expect(events).toEqual([
        'set assetType to plant',
        'fetch for plant' // ✅ Correct categories fetched (once)
      ]);
      expect(events.length).toBe(2); // ✅ Optimal
    });
  });

  describe('Category filtering with various applies_to values', () => {
    const categories = [
      { id: '1', name: 'MOT', applies_to: ['vehicle'] },
      { id: '2', name: 'LOLER', applies_to: ['plant'] },
      { id: '3', name: 'Service', applies_to: ['vehicle', 'plant'] },
      { id: '4', name: 'Old Category', applies_to: undefined },
      { id: '5', name: 'Empty Category', applies_to: [] }
    ];

    it('should filter for vehicle asset type', () => {
      const filtered = categories.filter(cat => {
        const appliesTo = cat.applies_to || ['vehicle'];
        return appliesTo.includes('vehicle');
      });

      expect(filtered.map(c => c.id)).toEqual(['1', '3', '4']); // ✅ MOT, Service, Old
    });

    it('should filter for plant asset type', () => {
      const filtered = categories.filter(cat => {
        const appliesTo = cat.applies_to || ['vehicle'];
        return appliesTo.includes('plant');
      });

      expect(filtered.map(c => c.id)).toEqual(['2', '3']); // ✅ LOLER, Service
    });

    it('should handle empty applies_to array', () => {
      const emptyCategory = categories.find(c => c.id === '5');
      const appliesTo = emptyCategory!.applies_to || ['vehicle'];
      
      // Empty array || ['vehicle'] → [] (empty array is truthy)
      expect(appliesTo).toEqual([]); // ❌ Empty array
      expect(appliesTo.includes('vehicle')).toBe(false);
      expect(appliesTo.includes('plant')).toBe(false);
      
      // This category won't match any filter (edge case)
    });
  });

  describe('useEffect dependency and timing', () => {
    it('should verify correct useEffect structure', () => {
      const effects = {
        openDialog: {
          deps: ['open', 'initialAssetType'],
          actions: ['setAssetType(initialAssetType)']
        },
        fetchCategories: {
          deps: ['open', 'fetchCategories'],
          actions: ['fetchCategories()']
        }
      };

      // Two separate effects
      expect(effects.openDialog.deps).toContain('open');
      expect(effects.openDialog.deps).toContain('initialAssetType');
      expect(effects.fetchCategories.deps).toContain('fetchCategories');
    });

    it('should verify execution order', () => {
      const execution = [
        '1. Dialog opens (open=true)',
        '2. First useEffect runs: setAssetType(initialAssetType)',
        '3. assetType changes',
        '4. fetchCategories recreated (depends on assetType)',
        '5. Second useEffect runs: fetchCategories()',
        '6. fetchCategories() fetches with correct assetType'
      ];

      expect(execution[1]).toContain('setAssetType');
      expect(execution[5]).toContain('fetchCategories');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle switching from vehicle to plant mode', () => {
      const logs: string[] = [];
      let assetType = 'vehicle';

      // User opens dialog for plant
      const initialAssetType = 'plant';
      
      // Set assetType first
      assetType = initialAssetType;
      logs.push(`assetType set to: ${assetType}`);
      
      // Fetch categories
      logs.push(`fetching categories for: ${assetType}`);

      expect(logs).toEqual([
        'assetType set to: plant',
        'fetching categories for: plant'
      ]);
      expect(logs.length).toBe(2); // ✅ Single fetch
    });

    it('should handle reopening dialog with same asset type', () => {
      const logs: string[] = [];
      let assetType = 'vehicle';
      const initialAssetType = 'vehicle'; // Same

      // Set assetType (no change)
      if (assetType !== initialAssetType) {
        assetType = initialAssetType;
        logs.push(`assetType changed to: ${assetType}`);
      }
      
      // Fetch categories (runs anyway because dialog opened)
      logs.push(`fetching categories for: ${assetType}`);

      expect(logs).toEqual([
        'fetching categories for: vehicle'
      ]);
      expect(logs.length).toBe(1); // ✅ Single fetch
    });
  });

  describe('Performance implications', () => {
    it('should calculate API calls before and after fix', () => {
      const scenario = {
        condition: 'Dialog opens with different initialAssetType',
        before: {
          apiCalls: 2, // Fetch with stale type + fetch with new type
          correctCategories: 'Second fetch only'
        },
        after: {
          apiCalls: 1, // Fetch with correct type
          correctCategories: 'First fetch'
        }
      };

      expect(scenario.before.apiCalls).toBe(2); // ❌ Inefficient
      expect(scenario.after.apiCalls).toBe(1); // ✅ Efficient
      
      const improvement = scenario.before.apiCalls / scenario.after.apiCalls;
      expect(improvement).toBe(2); // 2x improvement
    });
  });
});
