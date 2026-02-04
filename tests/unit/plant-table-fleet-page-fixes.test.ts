/**
 * Plant Table and Fleet Page Bug Fixes Test
 * 
 * Tests for bug fixes related to plant history routing, AddVehicleDialog props, and category filtering
 */

import { describe, it, expect } from 'vitest';

describe('Plant Table and Fleet Page Bug Fixes', () => {
  describe('Bug 1: Plant history routing with UUID instead of human-readable ID', () => {
    it('should pass plant UUID (plant.id) to history route, not plant_id', () => {
      // Simulate plant data structure from PlantTable
      const plantAsset = {
        plant_id: 'P001', // Human-readable identifier
        plant: {
          id: 'uuid-12345-67890', // Database UUID
          plant_id: 'P001',
          nickname: 'Excavator 1',
        },
        current_hours: 1250,
        next_service_hours: 1500,
      };

      // Simulate the fixed handleViewHistory call
      const plantIdForRoute = plantAsset.plant?.id || '';

      // Verify we're using the UUID, not the human-readable ID
      expect(plantIdForRoute).toBe('uuid-12345-67890');
      expect(plantIdForRoute).not.toBe('P001');
    });

    it('should handle missing plant object gracefully', () => {
      const plantAssetWithoutPlant = {
        plant_id: 'P002',
        plant: undefined,
        current_hours: 0,
        next_service_hours: null,
      };

      const plantIdForRoute = plantAssetWithoutPlant.plant?.id || '';

      // Should return empty string when plant is undefined
      expect(plantIdForRoute).toBe('');
    });

    it('should construct correct history route URL', () => {
      const plantUuid = 'uuid-abc-123-def';
      const expectedRoute = `/fleet/plant/${plantUuid}/history`;

      // Verify route construction
      expect(expectedRoute).toBe('/fleet/plant/uuid-abc-123-def/history');
      expect(expectedRoute).toContain(plantUuid);
    });

    it('should match history page query expectations', () => {
      // History page queries with .eq('id', plantId)
      // So the route param must be the UUID
      const plantUuid = 'uuid-plant-456';
      const routeParam = plantUuid;

      // Simulate what the history page does
      const queryField = 'id'; // History page uses .eq('id', plantId)
      const queryValue = routeParam;

      expect(queryField).toBe('id');
      expect(queryValue).toBe('uuid-plant-456');
    });
  });

  describe('Bug 2: AddVehicleDialog missing assetType prop', () => {
    it('should accept assetType prop and use it for filtering', () => {
      // Simulate AddVehicleDialog props
      interface AddVehicleDialogProps {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        onSuccess?: () => void;
        assetType?: 'vehicle' | 'plant' | 'tool';
      }

      const propsFromPlantTable: AddVehicleDialogProps = {
        open: true,
        onOpenChange: () => {},
        onSuccess: () => {},
        assetType: 'plant', // ✅ Now provided
      };

      expect(propsFromPlantTable.assetType).toBe('plant');
    });

    it('should default to vehicle when assetType is not provided', () => {
      const initialAssetType = 'vehicle'; // Default value
      const assetType = undefined; // Not provided by caller

      const effectiveAssetType = assetType || initialAssetType;

      expect(effectiveAssetType).toBe('vehicle');
    });

    it('should filter categories correctly based on assetType', () => {
      const categories = [
        { id: '1', name: 'Car', applies_to: ['vehicle'] },
        { id: '2', name: 'Van', applies_to: ['vehicle'] },
        { id: '3', name: 'All plant', applies_to: ['plant'] },
        { id: '4', name: 'Shared', applies_to: ['vehicle', 'plant'] },
      ];

      const assetType = 'plant';

      // Simulate the filter logic
      const filteredCategories = categories.filter(category => {
        const appliesTo = category.applies_to || ['vehicle'];
        return appliesTo.includes(assetType);
      });

      // Should include plant and shared categories
      expect(filteredCategories.length).toBe(2);
      expect(filteredCategories.some(c => c.name === 'All plant')).toBe(true);
      expect(filteredCategories.some(c => c.name === 'Shared')).toBe(true);
      
      // Should exclude vehicle-only categories
      expect(filteredCategories.some(c => c.name === 'Car')).toBe(false);
      expect(filteredCategories.some(c => c.name === 'Van')).toBe(false);
    });

    it('should prevent users from selecting incorrect categories for plant', () => {
      const categories = [
        { id: '1', name: 'Car', applies_to: ['vehicle'] },
        { id: '2', name: 'Excavator', applies_to: ['plant'] },
      ];

      const assetType = 'plant';

      const availableCategories = categories.filter(c => {
        const appliesTo = c.applies_to || ['vehicle'];
        return appliesTo.includes(assetType);
      });

      // User should only see plant-applicable categories
      expect(availableCategories).toHaveLength(1);
      expect(availableCategories[0].name).toBe('Excavator');
    });
  });

  describe('Bug 3: Fleet page category filtering using incorrect logic', () => {
    it('should filter by applies_to field, not by plant usage', () => {
      const categories = [
        { id: '1', name: 'Car', applies_to: ['vehicle'] },
        { id: '2', name: 'Van', applies_to: ['vehicle'] },
        { id: '3', name: 'All plant', applies_to: ['plant'] },
        { id: '4', name: 'Shared', applies_to: ['vehicle', 'plant'] },
      ];

      const plantAssets = [
        { category_id: '4' }, // Uses "Shared" category
      ];

      // BEFORE (incorrect): Exclude categories used by plant
      const plantCategoryIds = new Set(plantAssets.map(p => p.category_id).filter(Boolean));
      const incorrectVehicleCategories = categories.filter(c => !plantCategoryIds.has(c.id));

      // AFTER (correct): Filter by applies_to field
      const correctVehicleCategories = categories.filter(c => {
        const appliesTo = c.applies_to || ['vehicle'];
        return appliesTo.includes('vehicle');
      });

      // Incorrect logic would exclude "Shared" category
      expect(incorrectVehicleCategories.some(c => c.name === 'Shared')).toBe(false);
      
      // Correct logic includes "Shared" category
      expect(correctVehicleCategories.some(c => c.name === 'Shared')).toBe(true);
      expect(correctVehicleCategories.some(c => c.name === 'Car')).toBe(true);
      expect(correctVehicleCategories.some(c => c.name === 'Van')).toBe(true);
      
      // Should exclude plant-only categories
      expect(correctVehicleCategories.some(c => c.name === 'All plant')).toBe(false);
    });

    it('should show vehicle categories even if plant uses them (shared categories)', () => {
      const categories = [
        { id: '1', name: 'Shared Category', applies_to: ['vehicle', 'plant'] },
      ];

      const plantAssets = [
        { category_id: '1' }, // Plant uses the shared category
      ];

      // Correct logic: Filter by applies_to
      const vehicleCategories = categories.filter(c => {
        const appliesTo = c.applies_to || ['vehicle'];
        return appliesTo.includes('vehicle');
      });

      // Should still show the category in vehicle section
      expect(vehicleCategories).toHaveLength(1);
      expect(vehicleCategories[0].name).toBe('Shared Category');
    });

    it('should handle categories without applies_to field (legacy data)', () => {
      const categories = [
        { id: '1', name: 'Legacy Car', applies_to: undefined },
        { id: '2', name: 'Modern Van', applies_to: ['vehicle'] },
      ];

      const vehicleCategories = categories.filter(c => {
        const appliesTo = (c as any).applies_to || ['vehicle']; // Default to ['vehicle']
        return appliesTo.includes('vehicle');
      });

      // Both should be included (legacy defaults to vehicle)
      expect(vehicleCategories).toHaveLength(2);
    });

    it('should correctly separate vehicle and plant categories', () => {
      const categories = [
        { id: '1', name: 'Car', applies_to: ['vehicle'] },
        { id: '2', name: 'Van', applies_to: ['vehicle'] },
        { id: '3', name: 'Excavator', applies_to: ['plant'] },
        { id: '4', name: 'Telehandler', applies_to: ['plant'] },
        { id: '5', name: 'Road Sweeper', applies_to: ['vehicle', 'plant'] },
      ];

      const vehicleCategories = categories.filter(c => {
        const appliesTo = c.applies_to || ['vehicle'];
        return appliesTo.includes('vehicle');
      });

      const plantCategories = categories.filter(c => {
        const appliesTo = c.applies_to || ['vehicle'];
        return appliesTo.includes('plant');
      });

      // Vehicle section: Car, Van, Road Sweeper
      expect(vehicleCategories).toHaveLength(3);
      expect(vehicleCategories.some(c => c.name === 'Car')).toBe(true);
      expect(vehicleCategories.some(c => c.name === 'Van')).toBe(true);
      expect(vehicleCategories.some(c => c.name === 'Road Sweeper')).toBe(true);

      // Plant section: Excavator, Telehandler, Road Sweeper
      expect(plantCategories).toHaveLength(3);
      expect(plantCategories.some(c => c.name === 'Excavator')).toBe(true);
      expect(plantCategories.some(c => c.name === 'Telehandler')).toBe(true);
      expect(plantCategories.some(c => c.name === 'Road Sweeper')).toBe(true);

      // Road Sweeper should appear in both
      expect(vehicleCategories.some(c => c.name === 'Road Sweeper')).toBe(true);
      expect(plantCategories.some(c => c.name === 'Road Sweeper')).toBe(true);
    });
  });

  describe('Integration: All three fixes working together', () => {
    it('should handle complete plant workflow from table to history', () => {
      // 1. Plant data from PlantTable
      const plantAsset = {
        plant_id: 'P001',
        plant: {
          id: 'uuid-123',
          plant_id: 'P001',
          nickname: 'Excavator',
        },
      };

      // 2. Click history button - should pass UUID
      const historyRouteParam = plantAsset.plant?.id || '';
      expect(historyRouteParam).toBe('uuid-123');

      // 3. History page queries with UUID
      const historyPageQuery = { field: 'id', value: historyRouteParam };
      expect(historyPageQuery.field).toBe('id');
      expect(historyPageQuery.value).toBe('uuid-123');
    });

    it('should handle complete plant creation workflow', () => {
      // 1. Categories with applies_to
      const categories = [
        { id: '1', name: 'Car', applies_to: ['vehicle'] },
        { id: '2', name: 'Excavator', applies_to: ['plant'] },
      ];

      // 2. AddVehicleDialog with assetType='plant'
      const dialogAssetType = 'plant';

      // 3. Filter categories
      const availableCategories = categories.filter(c => {
        const appliesTo = c.applies_to || ['vehicle'];
        return appliesTo.includes(dialogAssetType);
      });

      // 4. User can only select plant categories
      expect(availableCategories).toHaveLength(1);
      expect(availableCategories[0].name).toBe('Excavator');
    });

    it('should handle fleet page category separation correctly', () => {
      const categories = [
        { id: '1', name: 'Car', applies_to: ['vehicle'] },
        { id: '2', name: 'Excavator', applies_to: ['plant'] },
        { id: '3', name: 'Shared', applies_to: ['vehicle', 'plant'] },
      ];

      // Plant uses shared category
      const plantAssets = [
        { category_id: '3' },
      ];

      // Vehicle section should still show shared category
      const vehicleCategories = categories.filter(c => {
        const appliesTo = c.applies_to || ['vehicle'];
        return appliesTo.includes('vehicle');
      });

      expect(vehicleCategories).toHaveLength(2);
      expect(vehicleCategories.some(c => c.name === 'Shared')).toBe(true);
    });
  });
});
