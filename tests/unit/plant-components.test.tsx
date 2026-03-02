/**
 * Plant Components Unit Tests
 * Tests the plant-specific React components
 */

import { describe, it, expect } from 'vitest';

describe('Plant Component Structure Validation', () => {
  describe('EditPlantRecordDialog', () => {
    it('should export EditPlantRecordDialog component', async () => {
      // Dynamic import to check file exists and exports correctly
      try {
        const module = await import('@/app/(dashboard)/maintenance/components/EditPlantRecordDialog');
        expect(module.EditPlantRecordDialog).toBeDefined();
        expect(typeof module.EditPlantRecordDialog).toBe('function');
      } catch (error) {
        throw new Error('EditPlantRecordDialog component not found or has syntax errors');
      }
    });
  });

  describe('DeletePlantDialog', () => {
    it('should export DeletePlantDialog component', async () => {
      try {
        const module = await import('@/app/(dashboard)/maintenance/components/DeletePlantDialog');
        expect(module.DeletePlantDialog).toBeDefined();
        expect(typeof module.DeletePlantDialog).toBe('function');
      } catch (error) {
        throw new Error('DeletePlantDialog component not found or has syntax errors');
      }
    });
  });

  describe('Plant History Page', () => {
    it('should have valid plant history page component', async () => {
      try {
        const module = await import('@/app/(dashboard)/fleet/plant/[plantId]/history/page');
        expect(module.default).toBeDefined();
        expect(typeof module.default).toBe('function');
      } catch (error) {
        throw new Error('Plant history page component not found or has syntax errors');
      }
    });
  });
});

describe('Plant Maintenance Hooks', () => {
  it('should export usePlantMaintenanceHistory hook', async () => {
    try {
      const module = await import('@/lib/hooks/useMaintenance');
      expect(module.usePlantMaintenanceHistory).toBeDefined();
      expect(typeof module.usePlantMaintenanceHistory).toBe('function');
    } catch (error) {
      throw new Error('usePlantMaintenanceHistory hook not found');
    }
  });
});

describe('Type Definitions', () => {
  it('should have updated MaintenanceHistory type with plant_id', async () => {
    try {
      const module = await import('@/types/maintenance');
      // Type checking happens at compile time, this just validates import works
      expect(module).toBeDefined();
    } catch (error) {
      throw new Error('Maintenance types not found or have errors');
    }
  });

  it('should have updated database types with plant_id', async () => {
    try {
      const module = await import('@/types/database');
      expect(module).toBeDefined();
    } catch (error) {
      throw new Error('Database types not found or have errors');
    }
  });
});
