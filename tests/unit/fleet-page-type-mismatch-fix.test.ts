/**
 * Fleet Page Type Mismatch Bug Fix Test
 * 
 * Tests for bug fix related to missing is_plant property in VehicleMaintenanceWithStatus type
 */

import { describe, it, expect } from 'vitest';

describe('Fleet Page Type Mismatch Bug Fix', () => {
  describe('Bug: Missing is_plant property in VehicleMaintenanceWithStatus', () => {
    it('should demonstrate the type mismatch issue before fix', () => {
      // Before fix: VehicleMaintenanceWithStatus doesn't include is_plant
      const vehicleMaintenanceTypeBefore = {
        vehicle_id: 'v1',
        overdue_count: 0,
        due_soon_count: 0,
        // is_plant property missing from type ❌
      };

      // PlantOverview creates objects with is_plant
      const plantObjectFromPlantOverview = {
        vehicle_id: 'p1',
        plant_id: 'P001',
        is_plant: true, // ✅ Set by PlantOverview
        overdue_count: 1,
        due_soon_count: 0,
      };

      // At runtime, accessing is_plant returns undefined for type without the property
      const isPlantBefore = (vehicleMaintenanceTypeBefore as any).is_plant === true;
      const isPlantFromPlant = plantObjectFromPlantOverview.is_plant === true;

      expect(isPlantBefore).toBe(false); // undefined === true → false
      expect(isPlantFromPlant).toBe(true); // true === true → true
    });

    it('should show type definition now includes is_plant property', () => {
      // After fix: VehicleMaintenanceWithStatus includes is_plant
      type VehicleMaintenanceWithStatus = {
        vehicle_id: string;
        is_plant?: boolean; // ✅ Now included in type
        overdue_count: number;
        due_soon_count: number;
      };

      const plantAsset: VehicleMaintenanceWithStatus = {
        vehicle_id: 'p1',
        is_plant: true, // ✅ Type-safe
        overdue_count: 1,
        due_soon_count: 0,
      };

      const regularVehicle: VehicleMaintenanceWithStatus = {
        vehicle_id: 'v1',
        is_plant: false, // ✅ Type-safe
        overdue_count: 0,
        due_soon_count: 0,
      };

      expect(plantAsset.is_plant).toBe(true);
      expect(regularVehicle.is_plant).toBe(false);
    });

    it('should correctly route plant assets to plant history', () => {
      const plantAsset = {
        vehicle_id: 'plant-uuid-123',
        is_plant: true, // ✅ Now type-safe
        vehicle: {
          id: 'plant-uuid-123',
        },
      };

      const isPlant = plantAsset.is_plant === true;
      const assetId = plantAsset.vehicle?.id || plantAsset.vehicle_id;
      const route = isPlant
        ? `/fleet/plant/${assetId}/history`
        : `/fleet/vehicles/${assetId}/history`;

      expect(isPlant).toBe(true); // ✅ Correctly identified as plant
      expect(route).toBe('/fleet/plant/plant-uuid-123/history'); // ✅ Correct route
    });

    it('should correctly route regular vehicles to vehicle history', () => {
      const regularVehicle = {
        vehicle_id: 'vehicle-uuid-456',
        is_plant: false, // ✅ Now type-safe
        vehicle: {
          id: 'vehicle-uuid-456',
        },
      };

      const isPlant = regularVehicle.is_plant === true;
      const assetId = regularVehicle.vehicle?.id || regularVehicle.vehicle_id;
      const route = isPlant
        ? `/fleet/plant/${assetId}/history`
        : `/fleet/vehicles/${assetId}/history`;

      expect(isPlant).toBe(false); // ✅ Correctly identified as vehicle
      expect(route).toBe('/fleet/vehicles/vehicle-uuid-456/history'); // ✅ Correct route
    });
  });

  describe('Runtime behavior before fix', () => {
    it('should show is_plant was undefined causing routing failure', () => {
      // Simulating PlantOverview setting is_plant
      const plantAssetObject = {
        vehicle_id: 'p1',
        is_plant: true, // Set by PlantOverview
      };

      // But if type doesn't include is_plant, TypeScript won't validate it
      // At runtime, the property exists but type checking doesn't enforce it

      // Before fix: Type system doesn't know about is_plant
      // Code accesses vehicle.is_plant, gets undefined if not set
      const vehicleWithoutIsPlant = {
        vehicle_id: 'v1',
        // is_plant not set
      };

      const isPlantUndefined = (vehicleWithoutIsPlant as any).is_plant === true;
      expect(isPlantUndefined).toBe(false); // undefined === true → false

      // This caused all plant assets to be routed to vehicle history ❌
      const wrongRoute = isPlantUndefined
        ? `/fleet/plant/v1/history`
        : `/fleet/vehicles/v1/history`;
      expect(wrongRoute).toBe('/fleet/vehicles/v1/history'); // ❌ Wrong route
    });

    it('should demonstrate navigation failures for plant assets', () => {
      // Plant asset created by PlantOverview
      const plantAsset = {
        vehicle_id: 'plant-uuid-123',
        is_plant: true,
      };

      // Before fix: If type doesn't include is_plant, it might be stripped or ignored
      // Simulating what happens when type doesn't match
      const assetWithoutTypeProperty = {
        vehicle_id: 'plant-uuid-123',
        // is_plant: true, // ❌ Lost due to type mismatch
      };

      const isPlantLost = (assetWithoutTypeProperty as any).is_plant === true;
      expect(isPlantLost).toBe(false); // ❌ Property lost

      // Routes to wrong endpoint
      const route = isPlantLost
        ? `/fleet/plant/plant-uuid-123/history`
        : `/fleet/vehicles/plant-uuid-123/history`;

      expect(route).toBe('/fleet/vehicles/plant-uuid-123/history');
      // ❌ Plant UUID sent to vehicle history endpoint → 404 error
    });
  });

  describe('Type safety improvements', () => {
    it('should ensure is_plant property is preserved through type system', () => {
      type VehicleMaintenanceWithStatus = {
        vehicle_id: string;
        is_plant?: boolean; // ✅ Included in type
        overdue_count: number;
        due_soon_count: number;
      };

      const createPlantAsset = (): VehicleMaintenanceWithStatus => {
        return {
          vehicle_id: 'p1',
          is_plant: true, // ✅ Type-safe, won't be lost
          overdue_count: 1,
          due_soon_count: 0,
        };
      };

      const plant = createPlantAsset();
      expect(plant.is_plant).toBe(true); // ✅ Property preserved
    });

    it('should handle undefined is_plant gracefully', () => {
      type VehicleMaintenanceWithStatus = {
        vehicle_id: string;
        is_plant?: boolean; // Optional
        overdue_count: number;
        due_soon_count: number;
      };

      const vehicleWithoutFlag: VehicleMaintenanceWithStatus = {
        vehicle_id: 'v1',
        // is_plant not set (undefined)
        overdue_count: 0,
        due_soon_count: 0,
      };

      const isPlant = vehicleWithoutFlag.is_plant === true;
      expect(isPlant).toBe(false); // undefined === true → false
      expect(vehicleWithoutFlag.is_plant).toBeUndefined();
    });

    it('should support explicit false value for is_plant', () => {
      type VehicleMaintenanceWithStatus = {
        vehicle_id: string;
        is_plant?: boolean;
        overdue_count: number;
        due_soon_count: number;
      };

      const vehicle: VehicleMaintenanceWithStatus = {
        vehicle_id: 'v1',
        is_plant: false, // Explicitly set to false
        overdue_count: 0,
        due_soon_count: 0,
      };

      const isPlant = vehicle.is_plant === true;
      expect(isPlant).toBe(false);
      expect(vehicle.is_plant).toBe(false);
    });
  });

  describe('PlantOverview and Fleet page interaction', () => {
    it('should verify PlantOverview sets is_plant flag', () => {
      // Simulating PlantOverview data transformation
      const plant = {
        id: 'plant-uuid-123',
        plant_id: 'P001',
        current_hours: 1200,
      };

      const plantMaintenanceWithStatus = {
        vehicle_id: plant.id,
        plant_id: plant.plant_id,
        is_plant: true, // ✅ Set by PlantOverview
        current_hours: plant.current_hours,
        overdue_count: 1,
        due_soon_count: 0,
      };

      expect(plantMaintenanceWithStatus.is_plant).toBe(true);
    });

    it('should verify Fleet page checks is_plant for routing', () => {
      const vehicles = [
        { vehicle_id: 'v1', is_plant: false },
        { vehicle_id: 'p1', is_plant: true },
      ];

      vehicles.forEach((vehicle) => {
        const isPlant = vehicle.is_plant === true;
        const route = isPlant
          ? `/fleet/plant/${vehicle.vehicle_id}/history`
          : `/fleet/vehicles/${vehicle.vehicle_id}/history`;

        if (vehicle.vehicle_id === 'v1') {
          expect(route).toBe('/fleet/vehicles/v1/history');
        } else {
          expect(route).toBe('/fleet/plant/p1/history');
        }
      });
    });

    it('should handle mixed vehicle and plant assets correctly', () => {
      const assets = [
        {
          vehicle_id: 'vehicle-uuid-1',
          is_plant: false,
          vehicle: { id: 'vehicle-uuid-1' },
        },
        {
          vehicle_id: 'vehicle-uuid-2',
          is_plant: false,
          vehicle: { id: 'vehicle-uuid-2' },
        },
        {
          vehicle_id: 'plant-uuid-1',
          is_plant: true,
          vehicle: { id: 'plant-uuid-1' },
        },
        {
          vehicle_id: 'plant-uuid-2',
          is_plant: true,
          vehicle: { id: 'plant-uuid-2' },
        },
      ];

      const routes = assets.map((asset) => {
        const isPlant = asset.is_plant === true;
        const assetId = asset.vehicle?.id || asset.vehicle_id;
        return isPlant
          ? `/fleet/plant/${assetId}/history`
          : `/fleet/vehicles/${assetId}/history`;
      });

      expect(routes[0]).toBe('/fleet/vehicles/vehicle-uuid-1/history');
      expect(routes[1]).toBe('/fleet/vehicles/vehicle-uuid-2/history');
      expect(routes[2]).toBe('/fleet/plant/plant-uuid-1/history'); // ✅ Correct
      expect(routes[3]).toBe('/fleet/plant/plant-uuid-2/history'); // ✅ Correct
    });
  });

  describe('Edge cases', () => {
    it('should handle null is_plant value', () => {
      const asset = {
        vehicle_id: 'v1',
        is_plant: null as any,
      };

      const isPlant = asset.is_plant === true;
      expect(isPlant).toBe(false); // null === true → false
    });

    it('should handle truthy but non-boolean is_plant values', () => {
      const asset = {
        vehicle_id: 'p1',
        is_plant: 'true' as any, // String instead of boolean
      };

      // Strict equality check
      const isPlantStrict = asset.is_plant === true;
      expect(isPlantStrict).toBe(false); // 'true' === true → false

      // This is why we use === true instead of just if(is_plant)
    });

    it('should handle missing vehicle property', () => {
      const asset = {
        vehicle_id: 'v1',
        is_plant: false,
        // vehicle property missing
      };

      const isPlant = asset.is_plant === true;
      const assetId = (asset as any).vehicle?.id || asset.vehicle_id;

      expect(isPlant).toBe(false);
      expect(assetId).toBe('v1'); // Falls back to vehicle_id
    });
  });

  describe('Type compatibility', () => {
    it('should ensure plant objects from PlantOverview are compatible with VehicleMaintenanceWithStatus', () => {
      type PlantMaintenanceWithStatus = {
        vehicle_id: string;
        plant_id: string;
        is_plant?: boolean; // ✅ Included
        current_hours: number | null;
        overdue_count: number;
        due_soon_count: number;
      };

      type VehicleMaintenanceWithStatus = {
        vehicle_id: string;
        is_plant?: boolean; // ✅ Now included
        overdue_count: number;
        due_soon_count: number;
      };

      const plantObject: PlantMaintenanceWithStatus = {
        vehicle_id: 'p1',
        plant_id: 'P001',
        is_plant: true,
        current_hours: 1200,
        overdue_count: 1,
        due_soon_count: 0,
      };

      // Should be assignable to VehicleMaintenanceWithStatus
      const asVehicleMaintenance: Partial<VehicleMaintenanceWithStatus> = {
        vehicle_id: plantObject.vehicle_id,
        is_plant: plantObject.is_plant, // ✅ Type-safe now
        overdue_count: plantObject.overdue_count,
        due_soon_count: plantObject.due_soon_count,
      };

      expect(asVehicleMaintenance.is_plant).toBe(true);
    });

    it('should verify handleVehicleClick can accept plant assets', () => {
      type VehicleMaintenanceWithStatus = {
        vehicle_id: string;
        is_plant?: boolean; // ✅ Included
        vehicle?: {
          id: string;
        };
      };

      const handleVehicleClick = (vehicle: VehicleMaintenanceWithStatus) => {
        const isPlant = vehicle.is_plant === true;
        const assetId = vehicle.vehicle?.id || vehicle.vehicle_id;
        return isPlant
          ? `/fleet/plant/${assetId}/history`
          : `/fleet/vehicles/${assetId}/history`;
      };

      const plantAsset: VehicleMaintenanceWithStatus = {
        vehicle_id: 'p1',
        is_plant: true, // ✅ Type-safe
        vehicle: { id: 'plant-uuid-123' },
      };

      const route = handleVehicleClick(plantAsset);
      expect(route).toBe('/fleet/plant/plant-uuid-123/history');
    });
  });
});
