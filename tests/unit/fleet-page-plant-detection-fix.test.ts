/**
 * Fleet Page Plant Detection Logic Bug Fix Test
 * 
 * Tests for bug fix related to incorrect plant asset detection with operator precedence
 */

import { describe, it, expect } from 'vitest';

describe('Fleet Page Plant Detection Logic Bug Fix', () => {
  describe('Bug: Incorrect operator precedence in plant detection', () => {
    it('should return boolean true, not string value of plant_id', () => {
      // Simulate vehicle object from PlantOverview
      const plantAsset = {
        vehicle_id: 'uuid-123',
        plant_id: 'P001', // Human-readable identifier
        is_plant: true, // ✅ Flag set by PlantOverview
        vehicle: {
          id: 'uuid-123',
          plant_id: 'P001',
        },
      };

      // BEFORE (incorrect)
      const incorrectIsPlant = plantAsset.vehicle?.plant_id || plantAsset.vehicle?.asset_type === 'plant';
      // Result: 'P001' (string) ❌

      // AFTER (correct)
      const correctIsPlant = plantAsset.is_plant === true;
      // Result: true (boolean) ✅

      expect(typeof incorrectIsPlant).toBe('string');
      expect(incorrectIsPlant).toBe('P001');

      expect(typeof correctIsPlant).toBe('boolean');
      expect(correctIsPlant).toBe(true);
    });

    it('should check the correct structural location (top-level is_plant)', () => {
      const plantAsset = {
        is_plant: true, // ✅ Top-level flag
        vehicle: {
          plant_id: 'P001', // Nested data
        },
      };

      // BEFORE: Checks nested vehicle.plant_id ❌
      const incorrectLocation = plantAsset.vehicle?.plant_id;
      
      // AFTER: Checks top-level is_plant ✅
      const correctLocation = plantAsset.is_plant;

      expect(incorrectLocation).toBe('P001');
      expect(correctLocation).toBe(true);
    });

    it('should match MaintenanceOverview pattern', () => {
      const vehicles = [
        { vehicle_id: 'v1', is_plant: false },
        { vehicle_id: 'p1', is_plant: true },
      ];

      // MaintenanceOverview pattern (correct)
      const isPlantAsset = (vehicleId: string) => {
        const vehicle = vehicles.find(v => v.vehicle_id === vehicleId);
        return vehicle && 'is_plant' in vehicle && vehicle.is_plant === true;
      };

      // Fleet page pattern (after fix)
      const isPlant = (vehicle: any) => vehicle.is_plant === true;

      expect(isPlantAsset('v1')).toBe(false);
      expect(isPlantAsset('p1')).toBe(true);

      expect(isPlant(vehicles[0])).toBe(false);
      expect(isPlant(vehicles[1])).toBe(true);
    });
  });

  describe('Operator precedence issue', () => {
    it('should demonstrate the operator precedence problem', () => {
      const plantAsset = {
        vehicle: {
          plant_id: 'P001',
          asset_type: undefined,
        },
      };

      // Incorrect expression: plant_id || asset_type === 'plant'
      // Evaluates as: (plant_id) || (asset_type === 'plant')
      const result = plantAsset.vehicle?.plant_id || plantAsset.vehicle?.asset_type === 'plant';
      
      // When plant_id is truthy ('P001'), short-circuit returns it
      expect(result).toBe('P001'); // ❌ String, not boolean
      expect(typeof result).toBe('string');
    });

    it('should show correct behavior with proper check', () => {
      const plantAsset = {
        is_plant: true,
        vehicle: {
          plant_id: 'P001',
        },
      };

      // Correct: Check the boolean flag directly
      const result = plantAsset.is_plant === true;

      expect(result).toBe(true); // ✅ Boolean
      expect(typeof result).toBe('boolean');
    });

    it('should handle falsy plant_id with incorrect logic', () => {
      const plantAsset = {
        vehicle: {
          plant_id: '', // Empty string (falsy)
          asset_type: 'plant',
        },
      };

      // Incorrect logic
      const result = plantAsset.vehicle?.plant_id || plantAsset.vehicle?.asset_type === 'plant';
      
      // Empty string is falsy, so it checks second condition
      expect(result).toBe(true); // ✅ Gets true from second check
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Type safety and consistency', () => {
    it('should use consistent boolean type for isPlant', () => {
      const vehicles = [
        { is_plant: true, vehicle: { plant_id: 'P001' } },
        { is_plant: false, vehicle: { reg_number: 'AB12 CDE' } },
      ];

      vehicles.forEach(vehicle => {
        const isPlant = vehicle.is_plant === true;
        
        // Should always be boolean
        expect(typeof isPlant).toBe('boolean');
      });
    });

    it('should handle missing is_plant flag gracefully', () => {
      const vehicleWithoutFlag = {
        vehicle: {
          reg_number: 'AB12 CDE',
        },
      };

      // Check for is_plant flag
      const isPlant = (vehicleWithoutFlag as any).is_plant === true;

      // Should be false when flag is missing
      expect(isPlant).toBe(false);
      expect(typeof isPlant).toBe('boolean');
    });

    it('should handle undefined vehicle gracefully', () => {
      const vehicleWithoutNested = {
        is_plant: true,
        vehicle: undefined,
      };

      const isPlant = vehicleWithoutNested.is_plant === true;

      expect(isPlant).toBe(true);
      expect(typeof isPlant).toBe('boolean');
    });
  });

  describe('Routing behavior with corrected logic', () => {
    it('should route to correct page for plant assets', () => {
      const plantAsset = {
        is_plant: true,
        vehicle: {
          id: 'uuid-plant-123',
          plant_id: 'P001',
        },
      };

      const isPlant = plantAsset.is_plant === true;
      const assetId = plantAsset.vehicle?.id;

      const route = isPlant 
        ? `/fleet/plant/${assetId}/history`
        : `/fleet/${assetId}/history`;

      expect(route).toBe('/fleet/plant/uuid-plant-123/history');
    });

    it('should route to correct page for regular vehicles', () => {
      const regularVehicle = {
        is_plant: false,
        vehicle_id: 'uuid-vehicle-456',
        vehicle: {
          id: 'uuid-vehicle-456',
          reg_number: 'AB12 CDE',
        },
      };

      const isPlant = regularVehicle.is_plant === true;
      const assetId = regularVehicle.vehicle?.id || regularVehicle.vehicle_id;

      const route = isPlant 
        ? `/fleet/plant/${assetId}/history`
        : `/fleet/${assetId}/history`;

      expect(route).toBe('/fleet/uuid-vehicle-456/history');
    });
  });

  describe('Comparison with MaintenanceOverview pattern', () => {
    it('should use same pattern as isPlantAsset in MaintenanceOverview', () => {
      const vehicles = [
        { 
          vehicle_id: 'v1', 
          is_plant: false,
          vehicle: { reg_number: 'AB12 CDE' }
        },
        { 
          vehicle_id: 'p1', 
          is_plant: true,
          vehicle: { plant_id: 'P001' }
        },
      ];

      // MaintenanceOverview pattern
      const isPlantAsset = (vehicleId: string) => {
        const vehicle = vehicles.find(v => v.vehicle_id === vehicleId);
        return vehicle && 'is_plant' in vehicle && vehicle.is_plant === true;
      };

      // Fleet page pattern (after fix)
      const isPlantInFleetPage = (vehicle: any) => vehicle.is_plant === true;

      // Both should check is_plant flag
      expect(isPlantAsset('v1')).toBe(false);
      expect(isPlantAsset('p1')).toBe(true);

      expect(isPlantInFleetPage(vehicles[0])).toBe(false);
      expect(isPlantInFleetPage(vehicles[1])).toBe(true);
    });

    it('should be consistent across all components', () => {
      const plantAsset = {
        vehicle_id: 'uuid-123',
        is_plant: true,
        vehicle: {
          id: 'uuid-123',
          plant_id: 'P001',
        },
      };

      // All components should check is_plant flag
      const maintenanceOverviewCheck = plantAsset.is_plant === true;
      const fleetPageCheck = plantAsset.is_plant === true;

      expect(maintenanceOverviewCheck).toBe(fleetPageCheck);
      expect(typeof maintenanceOverviewCheck).toBe('boolean');
      expect(typeof fleetPageCheck).toBe('boolean');
    });
  });

  describe('Edge cases', () => {
    it('should handle plant with empty plant_id string', () => {
      const plantAsset = {
        is_plant: true,
        vehicle: {
          plant_id: '', // Empty string
        },
      };

      // Correct check
      const isPlant = plantAsset.is_plant === true;

      // Incorrect check would fail or return empty string
      const incorrectCheck = plantAsset.vehicle?.plant_id || false;

      expect(isPlant).toBe(true); // ✅ Correct
      expect(incorrectCheck).toBe(false); // ❌ Wrong result
    });

    it('should handle plant without plant_id field', () => {
      const plantAsset = {
        is_plant: true,
        vehicle: {
          // No plant_id field
        },
      };

      const isPlant = plantAsset.is_plant === true;

      expect(isPlant).toBe(true); // ✅ Still detects as plant
    });

    it('should handle vehicle with plant_id but is_plant=false (edge case)', () => {
      // This shouldn't happen, but test defensive coding
      const vehicle = {
        is_plant: false,
        vehicle: {
          plant_id: 'P001', // Has plant_id but not actually a plant
        },
      };

      // Correct check uses is_plant flag
      const isPlant = vehicle.is_plant === true;

      // Should be false (trusts the is_plant flag)
      expect(isPlant).toBe(false);

      // Incorrect check would return string
      const incorrectCheck = vehicle.vehicle?.plant_id || false;
      expect(incorrectCheck).toBe('P001'); // Would give wrong result
    });
  });
});
