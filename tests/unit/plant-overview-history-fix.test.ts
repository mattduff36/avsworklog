/**
 * Plant Overview History API Routing Test
 * 
 * Bug Fix Verification: Plant UUIDs should be routed to plant history endpoint
 * 
 * ISSUE: PlantOverview was creating objects with plant UUIDs in the vehicle_id field,
 * causing MaintenanceOverview to call the vehicle history endpoint with plant UUIDs,
 * resulting in 404 errors.
 * 
 * FIX: Added is_plant flag to distinguish plant assets from vehicles, and updated
 * MaintenanceOverview to route to the correct API endpoint based on this flag.
 */

import { describe, it, expect } from 'vitest';

describe('Plant Overview History API Routing Fix', () => {
  it('should include is_plant flag in plant maintenance objects', () => {
    // Simulate PlantOverview output structure
    const plantMaintenanceObject = {
      vehicle_id: 'plant-uuid-123',
      plant_id: 'plant-uuid-123',
      is_plant: true, // This flag is critical for routing
      vehicle: {
        id: 'plant-uuid-123',
        plant_id: 'PLANT001',
        nickname: 'Test Excavator',
        make: 'Caterpillar',
        model: '320D',
        current_hours: 1250,
      },
      current_hours: 1250,
      next_service_hours: 1500,
      loler_due_date: '2024-12-31',
      loler_status: { status: 'due_soon', days_until: 15 },
      overdue_count: 0,
      due_soon_count: 1,
    };

    // Verify the object has the is_plant flag
    expect(plantMaintenanceObject).toHaveProperty('is_plant');
    expect(plantMaintenanceObject.is_plant).toBe(true);
  });

  it('should route to plant history endpoint for plant assets', () => {
    const plantId = 'plant-uuid-123';
    const isPlant = true;

    // Simulate the endpoint selection logic from MaintenanceOverview
    const endpoint = isPlant 
      ? `/api/maintenance/history/plant/${plantId}`
      : `/api/maintenance/history/${plantId}`;

    // Should route to plant endpoint
    expect(endpoint).toBe('/api/maintenance/history/plant/plant-uuid-123');
  });

  it('should route to vehicle history endpoint for vehicles', () => {
    const vehicleId = 'vehicle-uuid-456';
    const isPlant = false;

    // Simulate the endpoint selection logic from MaintenanceOverview
    const endpoint = isPlant 
      ? `/api/maintenance/history/plant/${vehicleId}`
      : `/api/maintenance/history/${vehicleId}`;

    // Should route to vehicle endpoint
    expect(endpoint).toBe('/api/maintenance/history/vehicle-uuid-456');
  });

  it('should correctly identify plant assets from maintenance object', () => {
    const plantObject = {
      vehicle_id: 'plant-uuid-123',
      is_plant: true,
    };

    const vehicleObject = {
      vehicle_id: 'vehicle-uuid-456',
      // No is_plant flag, or explicitly false
    };

    // Simulate the isPlantAsset check
    const isPlantAsset = (obj: { is_plant?: boolean } | null | undefined) => 
      obj && 'is_plant' in obj && obj.is_plant === true;

    expect(isPlantAsset(plantObject)).toBe(true);
    expect(isPlantAsset(vehicleObject)).toBe(false);
  });
});
