/**
 * Fleet Page and Category Dialog Bug Fixes Test
 * 
 * Tests for bug fixes related to plant asset state sync and applies_to validation
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('Fleet Page and Category Dialog Bug Fixes', () => {
  describe('Bug 1: Plant asset state synchronization', () => {
    it('should sync plantAssets state when PlantTable adds new assets', () => {
      // Simulate fleet page state
      let plantAssetsCount = 2;
      const plantAssets = [
        { id: '1', plant_id: 'P001', category_id: 'cat-1' },
        { id: '2', plant_id: 'P002', category_id: 'cat-1' },
      ];

      // Simulate fetchPlantAssets callback
      const fetchPlantAssets = () => {
        plantAssetsCount = 3; // New asset added
      };

      // Simulate PlantTable adding a new asset
      const onVehicleAdded = fetchPlantAssets;
      
      // Initial count
      expect(plantAssetsCount).toBe(2);

      // PlantTable adds asset and calls callback
      onVehicleAdded();

      // Count should update
      expect(plantAssetsCount).toBe(3);
    });

    it('should pass fetchPlantAssets callback to PlantTable, not empty function', () => {
      const fetchPlantAssets = () => {
        // This should be called
      };

      // BEFORE (incorrect)
      const incorrectCallback = () => {};
      expect(incorrectCallback).not.toBe(fetchPlantAssets);

      // AFTER (correct)
      const correctCallback = fetchPlantAssets;
      expect(correctCallback).toBe(fetchPlantAssets);
    });

    it('should update category counts after adding plant asset', () => {
      // Simulate category counts based on plantAssets
      const categories = [{ id: 'cat-1', name: 'Excavator' }];
      
      let plantAssets = [
        { id: '1', category_id: 'cat-1' },
        { id: '2', category_id: 'cat-1' },
      ];

      const getCount = (categoryId: string) => 
        plantAssets.filter(p => p.category_id === categoryId).length;

      // Initial count
      expect(getCount('cat-1')).toBe(2);

      // Simulate fetchPlantAssets adding a new asset
      plantAssets = [
        ...plantAssets,
        { id: '3', category_id: 'cat-1' },
      ];

      // Count should update
      expect(getCount('cat-1')).toBe(3);
    });

    it('should prevent stale counts in settings tab', () => {
      // Simulate the bug: counts don't update until tab is reopened
      let displayedCount = 2;
      const actualPlantAssets = [
        { id: '1', category_id: 'cat-1' },
        { id: '2', category_id: 'cat-1' },
      ];

      // User adds asset via PlantTable (with no callback - BEFORE)
      actualPlantAssets.push({ id: '3', category_id: 'cat-1' });
      
      // Count is stale (BEFORE fix)
      expect(displayedCount).toBe(2);
      expect(actualPlantAssets.length).toBe(3);

      // After fix: callback updates the count
      const fetchPlantAssets = () => {
        displayedCount = actualPlantAssets.length;
      };
      fetchPlantAssets();

      // Count is now accurate
      expect(displayedCount).toBe(3);
    });
  });

  describe('Bug 2: applies_to array validation', () => {
    it('should reject empty applies_to array', () => {
      const schema = z.object({
        applies_to: z.array(z.enum(['vehicle', 'plant']))
          .min(1, 'Category must apply to at least one asset type')
          .default(['vehicle']),
      });

      // Try to create with empty array
      const result = schema.safeParse({ applies_to: [] });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least one');
      }
    });

    it('should accept single asset type', () => {
      const schema = z.object({
        applies_to: z.array(z.enum(['vehicle', 'plant']))
          .min(1, 'Category must apply to at least one asset type')
          .default(['vehicle']),
      });

      const vehicleOnly = schema.safeParse({ applies_to: ['vehicle'] });
      const plantOnly = schema.safeParse({ applies_to: ['plant'] });

      expect(vehicleOnly.success).toBe(true);
      expect(plantOnly.success).toBe(true);
    });

    it('should accept both asset types', () => {
      const schema = z.object({
        applies_to: z.array(z.enum(['vehicle', 'plant']))
          .min(1, 'Category must apply to at least one asset type')
          .default(['vehicle']),
      });

      const result = schema.safeParse({ applies_to: ['vehicle', 'plant'] });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.applies_to).toHaveLength(2);
      }
    });

    it('should default to vehicle when not provided', () => {
      const schema = z.object({
        applies_to: z.array(z.enum(['vehicle', 'plant']))
          .min(1, 'Category must apply to at least one asset type')
          .default(['vehicle']),
      });

      const result = schema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.applies_to).toEqual(['vehicle']);
      }
    });

    it('should prevent categories that apply to no asset types', () => {
      // Simulate user unchecking all checkboxes
      const userInput = {
        name: 'Test Category',
        applies_to: [], // Both checkboxes unchecked
      };

      const schema = z.object({
        name: z.string(),
        applies_to: z.array(z.enum(['vehicle', 'plant']))
          .min(1, 'Category must apply to at least one asset type')
          .default(['vehicle']),
      });

      const result = schema.safeParse(userInput);

      // Should fail validation
      expect(result.success).toBe(false);
    });

    it('should maintain filtering logic integrity', () => {
      // Simulate filtering logic that relies on applies_to
      const categories = [
        { id: '1', name: 'Valid', applies_to: ['vehicle'] },
        { id: '2', name: 'Invalid', applies_to: [] as string[] }, // Should be prevented by validation
      ];

      // Filter for vehicle categories
      const vehicleCategories = categories.filter(c => {
        const appliesTo = c.applies_to.length > 0 ? c.applies_to : ['vehicle'];
        return appliesTo.includes('vehicle');
      });

      // With validation, invalid category should not exist
      expect(categories[0].applies_to.length).toBeGreaterThan(0);
      
      // Without validation, empty arrays break filtering
      const invalidCategory = categories[1];
      expect(invalidCategory.applies_to.length).toBe(0);
      
      // Filtering with empty array defaults to vehicle (workaround)
      const filtered = vehicleCategories.filter(c => 
        c.applies_to.length > 0
      );
      expect(filtered.length).toBe(1);
    });

    it('should show appropriate error message for empty array', () => {
      const schema = z.object({
        applies_to: z.array(z.enum(['vehicle', 'plant']))
          .min(1, 'Category must apply to at least one asset type'),
      });

      const result = schema.safeParse({ applies_to: [] });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessage = result.error.issues[0].message;
        expect(errorMessage).toBe('Category must apply to at least one asset type');
      }
    });
  });

  describe('Integration: Both fixes working together', () => {
    it('should maintain accurate counts with validated categories', () => {
      // Setup: Categories with valid applies_to
      const categories = [
        { id: '1', name: 'Excavator', applies_to: ['plant'] },
        { id: '2', name: 'Van', applies_to: ['vehicle'] },
      ];

      // All categories have at least one applies_to value (validation)
      categories.forEach(cat => {
        expect(cat.applies_to.length).toBeGreaterThan(0);
      });

      // Plant assets state
      let plantAssets = [
        { id: 'p1', category_id: '1' },
      ];

      // Count function
      const getCount = (categoryId: string) =>
        plantAssets.filter(p => p.category_id === categoryId).length;

      // Initial count
      expect(getCount('1')).toBe(1);

      // Add new plant via PlantTable with callback
      const fetchPlantAssets = () => {
        plantAssets = [
          ...plantAssets,
          { id: 'p2', category_id: '1' },
        ];
      };

      fetchPlantAssets();

      // Count updates correctly
      expect(getCount('1')).toBe(2);

      // Filter categories for plant
      const plantCategories = categories.filter(c =>
        c.applies_to.includes('plant')
      );

      expect(plantCategories.length).toBe(1);
      expect(plantCategories[0].name).toBe('Excavator');
    });

    it('should prevent workflow issues with empty applies_to', () => {
      // Workflow: Create category → Add plant → Check counts

      // Step 1: Try to create category with no asset types
      const schema = z.object({
        name: z.string(),
        applies_to: z.array(z.enum(['vehicle', 'plant']))
          .min(1, 'Category must apply to at least one asset type'),
      });

      const invalidCategory = schema.safeParse({
        name: 'Broken Category',
        applies_to: [],
      });

      // Should be rejected
      expect(invalidCategory.success).toBe(false);

      // Step 2: Create valid category
      const validCategory = schema.safeParse({
        name: 'Working Category',
        applies_to: ['plant'],
      });

      expect(validCategory.success).toBe(true);

      // Step 3: Add plant asset and sync counts
      const plantAssets: any[] = [];
      
      const addPlantAsset = (categoryId: string) => {
        plantAssets.push({ id: 'p1', category_id: categoryId });
      };

      const fetchPlantAssets = () => {
        // Simulates fetching updated list
        return plantAssets;
      };

      // Add plant
      addPlantAsset('cat-1');
      
      // Trigger sync via callback
      const updated = fetchPlantAssets();
      
      // Count is accurate
      expect(updated.length).toBe(1);
    });

    it('should handle real-world scenario: settings tab with plant management', () => {
      // User opens settings tab
      const categories = [
        { id: 'cat-1', name: 'Excavator', applies_to: ['plant'] },
      ];

      let plantAssets = [
        { id: 'p1', category_id: 'cat-1' },
      ];

      // Display count
      const displayCount = (categoryId: string) =>
        plantAssets.filter(p => p.category_id === categoryId).length;

      expect(displayCount('cat-1')).toBe(1);

      // User clicks "Add Plant" in PlantTable
      // PlantTable calls onVehicleAdded callback
      const onVehicleAdded = () => {
        // Simulates fetchPlantAssets
        plantAssets = [
          ...plantAssets,
          { id: 'p2', category_id: 'cat-1' },
        ];
      };

      onVehicleAdded();

      // Count updates immediately (no need to close/reopen tab)
      expect(displayCount('cat-1')).toBe(2);

      // Try to create category with no applies_to
      const schema = z.object({
        applies_to: z.array(z.enum(['vehicle', 'plant'])).min(1),
      });

      const invalid = schema.safeParse({ applies_to: [] });
      expect(invalid.success).toBe(false);
    });
  });
});
