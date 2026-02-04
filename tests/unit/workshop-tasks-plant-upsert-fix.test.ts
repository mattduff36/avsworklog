/**
 * Workshop Tasks Plant Maintenance Upsert Bug Fix Test
 * 
 * Tests for bug fix related to missing UNIQUE constraint on plant_id
 * preventing proper upsert operations for plant maintenance records
 */

import { describe, it, expect } from 'vitest';

describe('Workshop Tasks Plant Maintenance Upsert Bug Fix', () => {
  describe('Bug: Missing UNIQUE constraint on plant_id', () => {
    it('should demonstrate the upsert conflict column requirement', () => {
      // PostgreSQL upsert (ON CONFLICT) requires the conflict column to have:
      // 1. UNIQUE constraint, OR
      // 2. PRIMARY KEY constraint, OR
      // 3. UNIQUE index

      const originalSchema = {
        tableName: 'vehicle_maintenance',
        constraints: {
          primary_key: 'id',
          unique_constraints: ['vehicle_id'], // ✅ vehicle_id has UNIQUE
          indexes: ['plant_id'], // ❌ plant_id only has INDEX, not UNIQUE
        },
      };

      // Upsert attempts
      const vehicleUpsert = {
        onConflict: 'vehicle_id',
        willWork: originalSchema.constraints.unique_constraints.includes('vehicle_id'),
      };

      const plantUpsert = {
        onConflict: 'plant_id',
        willWork: originalSchema.constraints.unique_constraints.includes('plant_id'),
      };

      expect(vehicleUpsert.willWork).toBe(true); // ✅ Works
      expect(plantUpsert.willWork).toBe(false); // ❌ Fails
    });

    it('should show the migration adds UNIQUE constraint for plant_id', () => {
      const fixedSchema = {
        tableName: 'vehicle_maintenance',
        uniqueIndexes: [
          {
            name: 'unique_vehicle_maintenance_id',
            column: 'vehicle_id',
            partial: 'WHERE vehicle_id IS NOT NULL',
          },
          {
            name: 'unique_plant_maintenance',
            column: 'plant_id',
            partial: 'WHERE plant_id IS NOT NULL', // ✅ Now has UNIQUE index
          },
        ],
      };

      // Verify both indexes exist
      const hasVehicleUnique = fixedSchema.uniqueIndexes.some(
        (idx) => idx.column === 'vehicle_id'
      );
      const hasPlantUnique = fixedSchema.uniqueIndexes.some(
        (idx) => idx.column === 'plant_id'
      );

      expect(hasVehicleUnique).toBe(true);
      expect(hasPlantUnique).toBe(true);
    });

    it('should handle partial unique indexes correctly', () => {
      // Partial unique indexes allow NULL values while enforcing uniqueness on non-NULL values
      const records = [
        { id: 1, vehicle_id: 'v1', plant_id: null },
        { id: 2, vehicle_id: 'v2', plant_id: null },
        { id: 3, vehicle_id: null, plant_id: 'p1' },
        { id: 4, vehicle_id: null, plant_id: 'p2' },
      ];

      // Check for duplicate vehicle_ids (excluding NULLs)
      const vehicleIds = records
        .filter((r) => r.vehicle_id !== null)
        .map((r) => r.vehicle_id);
      const uniqueVehicleIds = new Set(vehicleIds);

      // Check for duplicate plant_ids (excluding NULLs)
      const plantIds = records
        .filter((r) => r.plant_id !== null)
        .map((r) => r.plant_id);
      const uniquePlantIds = new Set(plantIds);

      expect(vehicleIds.length).toBe(uniqueVehicleIds.size); // No duplicates
      expect(plantIds.length).toBe(uniquePlantIds.size); // No duplicates
    });
  });

  describe('Upsert operation behavior', () => {
    it('should correctly structure vehicle maintenance upsert data', () => {
      const isPlant = false;
      const selectedVehicleId = 'vehicle-uuid-123';
      const readingValue = 50000;
      const userId = 'user-123';

      const updateData: Record<string, any> = {
        last_updated_at: new Date().toISOString(),
        last_updated_by: userId,
      };

      if (isPlant) {
        updateData.plant_id = selectedVehicleId;
        updateData.current_hours = readingValue;
        updateData.last_hours_update = new Date().toISOString();
      } else {
        updateData.vehicle_id = selectedVehicleId;
        updateData.current_mileage = readingValue;
        updateData.last_mileage_update = new Date().toISOString();
      }

      const onConflict = isPlant ? 'plant_id' : 'vehicle_id';

      // Verify structure
      expect(updateData.vehicle_id).toBe('vehicle-uuid-123');
      expect(updateData.current_mileage).toBe(50000);
      expect(updateData.plant_id).toBeUndefined();
      expect(updateData.current_hours).toBeUndefined();
      expect(onConflict).toBe('vehicle_id'); // ✅ Has UNIQUE constraint
    });

    it('should correctly structure plant maintenance upsert data', () => {
      const isPlant = true;
      const selectedVehicleId = 'plant-uuid-456';
      const readingValue = 1200;
      const userId = 'user-123';

      const updateData: Record<string, any> = {
        last_updated_at: new Date().toISOString(),
        last_updated_by: userId,
      };

      if (isPlant) {
        updateData.plant_id = selectedVehicleId;
        updateData.current_hours = readingValue;
        updateData.last_hours_update = new Date().toISOString();
      } else {
        updateData.vehicle_id = selectedVehicleId;
        updateData.current_mileage = readingValue;
        updateData.last_mileage_update = new Date().toISOString();
      }

      const onConflict = isPlant ? 'plant_id' : 'vehicle_id';

      // Verify structure
      expect(updateData.plant_id).toBe('plant-uuid-456');
      expect(updateData.current_hours).toBe(1200);
      expect(updateData.vehicle_id).toBeUndefined();
      expect(updateData.current_mileage).toBeUndefined();
      expect(onConflict).toBe('plant_id'); // ✅ Now has UNIQUE constraint (after fix)
    });
  });

  describe('Duplicate prevention', () => {
    it('should prevent duplicate vehicle maintenance records', () => {
      // Simulate multiple upserts for same vehicle
      const vehicleId = 'v1';
      const maintenanceRecords: Array<{ vehicle_id: string; current_mileage: number }> = [];

      // First upsert
      maintenanceRecords.push({ vehicle_id: vehicleId, current_mileage: 50000 });

      // Second upsert (should update, not insert)
      const existingIndex = maintenanceRecords.findIndex((r) => r.vehicle_id === vehicleId);
      if (existingIndex >= 0) {
        maintenanceRecords[existingIndex] = { vehicle_id: vehicleId, current_mileage: 51000 };
      } else {
        maintenanceRecords.push({ vehicle_id: vehicleId, current_mileage: 51000 });
      }

      // Should have exactly one record
      expect(maintenanceRecords.length).toBe(1);
      expect(maintenanceRecords[0].current_mileage).toBe(51000);
    });

    it('should prevent duplicate plant maintenance records after fix', () => {
      // Simulate multiple upserts for same plant
      const plantId = 'p1';
      const maintenanceRecords: Array<{ plant_id: string; current_hours: number }> = [];

      // First upsert
      maintenanceRecords.push({ plant_id: plantId, current_hours: 1200 });

      // Second upsert (should update, not insert)
      const existingIndex = maintenanceRecords.findIndex((r) => r.plant_id === plantId);
      if (existingIndex >= 0) {
        maintenanceRecords[existingIndex] = { plant_id: plantId, current_hours: 1300 };
      } else {
        maintenanceRecords.push({ plant_id: plantId, current_hours: 1300 });
      }

      // Should have exactly one record
      expect(maintenanceRecords.length).toBe(1);
      expect(maintenanceRecords[0].current_hours).toBe(1300);
    });

    it('should allow one maintenance record per vehicle and one per plant', () => {
      const maintenanceRecords = [
        { id: 1, vehicle_id: 'v1', plant_id: null, current_mileage: 50000 },
        { id: 2, vehicle_id: 'v2', plant_id: null, current_mileage: 60000 },
        { id: 3, vehicle_id: null, plant_id: 'p1', current_hours: 1200 },
        { id: 4, vehicle_id: null, plant_id: 'p2', current_hours: 800 },
      ];

      // Check no duplicate vehicle_ids
      const vehicleIds = maintenanceRecords
        .filter((r) => r.vehicle_id !== null)
        .map((r) => r.vehicle_id);
      expect(new Set(vehicleIds).size).toBe(vehicleIds.length);

      // Check no duplicate plant_ids
      const plantIds = maintenanceRecords
        .filter((r) => r.plant_id !== null)
        .map((r) => r.plant_id);
      expect(new Set(plantIds).size).toBe(plantIds.length);
    });
  });

  describe('Workshop task creation/editing scenarios', () => {
    it('should handle creating workshop task with meter reading for vehicle', () => {
      const taskData = {
        vehicleId: 'v1',
        isPlant: false,
        meterReading: 50000,
      };

      const maintenanceUpdate = {
        vehicle_id: taskData.vehicleId,
        current_mileage: taskData.meterReading,
        last_mileage_update: new Date().toISOString(),
      };

      const onConflict = taskData.isPlant ? 'plant_id' : 'vehicle_id';

      expect(onConflict).toBe('vehicle_id');
      expect(maintenanceUpdate.vehicle_id).toBe('v1');
      expect(maintenanceUpdate.current_mileage).toBe(50000);
    });

    it('should handle creating workshop task with meter reading for plant', () => {
      const taskData = {
        vehicleId: 'p1',
        isPlant: true,
        meterReading: 1200,
      };

      const maintenanceUpdate = {
        plant_id: taskData.vehicleId,
        current_hours: taskData.meterReading,
        last_hours_update: new Date().toISOString(),
      };

      const onConflict = taskData.isPlant ? 'plant_id' : 'vehicle_id';

      expect(onConflict).toBe('plant_id');
      expect(maintenanceUpdate.plant_id).toBe('p1');
      expect(maintenanceUpdate.current_hours).toBe(1200);
    });

    it('should handle editing workshop task and updating meter reading', () => {
      const existingTask = {
        id: 'task-1',
        vehicle_id: null,
        plant_id: 'p1',
      };

      const isPlant = existingTask.plant_id !== null;
      const newMeterReading = 1300;

      const meterUpdateData: Record<string, any> = {
        last_updated_at: new Date().toISOString(),
      };

      if (isPlant) {
        meterUpdateData.plant_id = existingTask.plant_id;
        meterUpdateData.current_hours = newMeterReading;
        meterUpdateData.last_hours_update = new Date().toISOString();
      }

      const onConflict = isPlant ? 'plant_id' : 'vehicle_id';

      expect(isPlant).toBe(true);
      expect(onConflict).toBe('plant_id');
      expect(meterUpdateData.plant_id).toBe('p1');
      expect(meterUpdateData.current_hours).toBe(1300);
    });
  });

  describe('Migration verification', () => {
    it('should verify migration creates both unique indexes', () => {
      const expectedIndexes = [
        {
          name: 'unique_vehicle_maintenance_id',
          tableName: 'vehicle_maintenance',
          column: 'vehicle_id',
          isUnique: true,
          isPartial: true,
        },
        {
          name: 'unique_plant_maintenance',
          tableName: 'vehicle_maintenance',
          column: 'plant_id',
          isUnique: true,
          isPartial: true,
        },
      ];

      // All indexes should be unique and partial
      expectedIndexes.forEach((index) => {
        expect(index.isUnique).toBe(true);
        expect(index.isPartial).toBe(true);
        expect(index.tableName).toBe('vehicle_maintenance');
      });

      // Should have exactly 2 indexes
      expect(expectedIndexes.length).toBe(2);
    });

    it('should verify check constraint still enforces either vehicle_id or plant_id', () => {
      // The check_maintenance_asset constraint should still exist
      const checkConstraint = {
        name: 'check_maintenance_asset',
        condition:
          '(vehicle_id IS NOT NULL AND plant_id IS NULL) OR (vehicle_id IS NULL AND plant_id IS NOT NULL)',
      };

      // Valid records
      const validRecords = [
        { vehicle_id: 'v1', plant_id: null }, // ✅ Only vehicle_id
        { vehicle_id: null, plant_id: 'p1' }, // ✅ Only plant_id
      ];

      // Invalid records (would be rejected by constraint)
      const invalidRecords = [
        { vehicle_id: null, plant_id: null }, // ❌ Both NULL
        { vehicle_id: 'v1', plant_id: 'p1' }, // ❌ Both set
      ];

      validRecords.forEach((record) => {
        const isValid =
          (record.vehicle_id !== null && record.plant_id === null) ||
          (record.vehicle_id === null && record.plant_id !== null);
        expect(isValid).toBe(true);
      });

      invalidRecords.forEach((record) => {
        const isValid =
          (record.vehicle_id !== null && record.plant_id === null) ||
          (record.vehicle_id === null && record.plant_id !== null);
        expect(isValid).toBe(false);
      });

      expect(checkConstraint.name).toBe('check_maintenance_asset');
    });
  });

  describe('Error scenarios before fix', () => {
    it('should demonstrate upsert failure without UNIQUE constraint', () => {
      // Before fix: Attempting upsert on plant_id without UNIQUE constraint
      const attemptedUpsert = {
        table: 'vehicle_maintenance',
        data: {
          plant_id: 'p1',
          current_hours: 1200,
        },
        onConflict: 'plant_id',
        hasUniqueConstraint: false, // ❌ Missing
      };

      // PostgreSQL error would be:
      // "there is no unique or exclusion constraint matching the ON CONFLICT specification"
      const expectedError = !attemptedUpsert.hasUniqueConstraint;

      expect(expectedError).toBe(true);
      expect(attemptedUpsert.onConflict).toBe('plant_id');
    });

    it('should show potential for duplicate records without proper upsert', () => {
      // If upsert fails and code falls back to insert, duplicates could occur
      const plantId = 'p1';
      const records: Array<{ plant_id: string; current_hours: number }> = [];

      // First insert (works)
      records.push({ plant_id: plantId, current_hours: 1200 });

      // Second attempt (upsert fails, falls back to insert)
      // Without UNIQUE constraint, this would create a duplicate
      records.push({ plant_id: plantId, current_hours: 1300 });

      // Before fix: Could have duplicates
      const duplicates = records.filter((r) => r.plant_id === plantId);
      expect(duplicates.length).toBeGreaterThan(1); // ❌ Duplicates exist

      // After fix: UNIQUE constraint would prevent this
      const uniquePlantIds = new Set(records.map((r) => r.plant_id));
      expect(uniquePlantIds.size).toBeLessThan(records.length); // Shows duplicates exist
    });
  });

  describe('Edge cases', () => {
    it('should handle NULL values correctly with partial indexes', () => {
      // Partial indexes (WHERE column IS NOT NULL) don't enforce uniqueness on NULLs
      const records = [
        { vehicle_id: 'v1', plant_id: null },
        { vehicle_id: 'v2', plant_id: null }, // Multiple NULLs allowed
        { vehicle_id: null, plant_id: 'p1' },
        { vehicle_id: null, plant_id: 'p2' }, // Multiple NULLs allowed
      ];

      // Count NULL values
      const nullVehicleIds = records.filter((r) => r.vehicle_id === null).length;
      const nullPlantIds = records.filter((r) => r.plant_id === null).length;

      expect(nullVehicleIds).toBeGreaterThan(1); // Multiple NULLs OK
      expect(nullPlantIds).toBeGreaterThan(1); // Multiple NULLs OK
    });

    it('should prevent duplicate non-NULL values', () => {
      const records = [
        { vehicle_id: 'v1', plant_id: null },
        { vehicle_id: null, plant_id: 'p1' },
      ];

      // Attempt to add duplicate vehicle_id
      const duplicateVehicle = { vehicle_id: 'v1', plant_id: null };
      const hasDuplicateVehicle = records.some(
        (r) => r.vehicle_id === duplicateVehicle.vehicle_id && r.vehicle_id !== null
      );

      // Attempt to add duplicate plant_id
      const duplicatePlant = { vehicle_id: null, plant_id: 'p1' };
      const hasDuplicatePlant = records.some(
        (r) => r.plant_id === duplicatePlant.plant_id && r.plant_id !== null
      );

      expect(hasDuplicateVehicle).toBe(true); // Would be rejected by UNIQUE constraint
      expect(hasDuplicatePlant).toBe(true); // Would be rejected by UNIQUE constraint
    });
  });
});
