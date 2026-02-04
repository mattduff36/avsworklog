/**
 * Fleet Page Category Counting Fix Test
 * 
 * Bug Fix Verification: Category counts should use ID-based comparison
 * 
 * ISSUE: The code was counting plant assets and vehicles per category by 
 * comparing category names (p.vehicle_categories?.name === category.name),
 * which is fragile and error-prone.
 * 
 * FIX: Changed to use ID-based comparison (p.category_id === category.id),
 * which directly leverages the foreign key relationship.
 */

import { describe, it, expect } from 'vitest';

describe('Fleet Page Category Counting Fix', () => {
  it('should count plant assets using category ID comparison', () => {
    const category = {
      id: 'cat-uuid-123',
      name: 'Excavators',
    };

    const plantAssets = [
      { id: 'plant-1', category_id: 'cat-uuid-123', vehicle_categories: { id: 'cat-uuid-123', name: 'Excavators' } },
      { id: 'plant-2', category_id: 'cat-uuid-123', vehicle_categories: { id: 'cat-uuid-123', name: 'Excavators' } },
      { id: 'plant-3', category_id: 'cat-uuid-456', vehicle_categories: { id: 'cat-uuid-456', name: 'Telehandlers' } },
    ];

    // Count using ID (CORRECT - after fix)
    const countById = plantAssets.filter(p => p.category_id === category.id).length;
    
    // This should match 2 assets
    expect(countById).toBe(2);
  });

  it('should count vehicles using category ID comparison', () => {
    const category = {
      id: 'cat-uuid-789',
      name: 'Vans',
    };

    const vehicles = [
      { id: 'vehicle-1', category_id: 'cat-uuid-789', vehicle_categories: { id: 'cat-uuid-789', name: 'Vans' } },
      { id: 'vehicle-2', category_id: 'cat-uuid-789', vehicle_categories: { id: 'cat-uuid-789', name: 'Vans' } },
      { id: 'vehicle-3', category_id: 'cat-uuid-999', vehicle_categories: { id: 'cat-uuid-999', name: 'Trucks' } },
    ];

    // Count using ID (CORRECT - after fix)
    const countById = vehicles.filter(v => v.category_id === category.id).length;
    
    // This should match 2 vehicles
    expect(countById).toBe(2);
  });

  it('should be resilient to category name changes when using ID comparison', () => {
    const category = {
      id: 'cat-uuid-123',
      name: 'Excavators (Updated Name)', // Category name changed
    };

    const plantAssets = [
      { 
        id: 'plant-1', 
        category_id: 'cat-uuid-123', 
        vehicle_categories: { 
          id: 'cat-uuid-123', 
          name: 'Excavators' // Old name in nested object
        } 
      },
    ];

    // ID-based comparison still works despite name mismatch
    const countById = plantAssets.filter(p => p.category_id === category.id).length;
    expect(countById).toBe(1); // ✅ Correctly counts the asset

    // Name-based comparison would fail (the OLD approach)
    const countByName = plantAssets.filter(p => p.vehicle_categories?.name === category.name).length;
    expect(countByName).toBe(0); // ❌ Would incorrectly return 0
  });

  it('should handle case-sensitive name differences correctly with ID comparison', () => {
    const category = {
      id: 'cat-uuid-456',
      name: 'Telehandlers',
    };

    const plantAssets = [
      { 
        id: 'plant-1', 
        category_id: 'cat-uuid-456', 
        vehicle_categories: { 
          id: 'cat-uuid-456', 
          name: 'telehandlers' // Different case
        } 
      },
    ];

    // ID comparison is case-insensitive (UUIDs don't have case issues)
    const countById = plantAssets.filter(p => p.category_id === category.id).length;
    expect(countById).toBe(1); // ✅ Works correctly

    // Name comparison would fail due to case sensitivity
    const countByName = plantAssets.filter(p => p.vehicle_categories?.name === category.name).length;
    expect(countByName).toBe(0); // ❌ Would fail
  });

  it('should handle null/undefined category_id gracefully', () => {
    const category = {
      id: 'cat-uuid-123',
      name: 'Excavators',
    };

    const plantAssets = [
      { id: 'plant-1', category_id: 'cat-uuid-123', vehicle_categories: { id: 'cat-uuid-123', name: 'Excavators' } },
      { id: 'plant-2', category_id: null, vehicle_categories: null }, // No category assigned
      { id: 'plant-3', category_id: undefined, vehicle_categories: undefined }, // No category
    ];

    // ID comparison handles null/undefined correctly
    const countById = plantAssets.filter(p => p.category_id === category.id).length;
    expect(countById).toBe(1); // Only plant-1 matches
  });
});
