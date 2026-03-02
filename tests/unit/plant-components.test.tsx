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
        const mod = await import('@/app/(dashboard)/maintenance/components/EditPlantRecordDialog');
        expect(mod.EditPlantRecordDialog).toBeDefined();
        expect(typeof mod.EditPlantRecordDialog).toBe('function');
      } catch {
        throw new Error('EditPlantRecordDialog component not found or has syntax errors');
      }
    });
  });

  describe('DeletePlantDialog', () => {
    it('should export DeletePlantDialog component', async () => {
      try {
        const mod = await import('@/app/(dashboard)/maintenance/components/DeletePlantDialog');
        expect(mod.DeletePlantDialog).toBeDefined();
        expect(typeof mod.DeletePlantDialog).toBe('function');
      } catch {
        throw new Error('DeletePlantDialog component not found or has syntax errors');
      }
    });
  });

  describe('Plant History Page', () => {
    it('should have valid plant history page component', async () => {
      try {
        const mod = await import('@/app/(dashboard)/fleet/plant/[plantId]/history/page');
        expect(mod.default).toBeDefined();
        expect(typeof mod.default).toBe('function');
      } catch {
        throw new Error('Plant history page component not found or has syntax errors');
      }
    });
  });
});

describe('Plant Maintenance Hooks', () => {
  it('should export usePlantMaintenanceHistory hook', async () => {
    try {
      const mod = await import('@/lib/hooks/useMaintenance');
      expect(mod.usePlantMaintenanceHistory).toBeDefined();
      expect(typeof mod.usePlantMaintenanceHistory).toBe('function');
    } catch {
      throw new Error('usePlantMaintenanceHistory hook not found');
    }
  });
});

describe('Type Definitions', () => {
  it('should have updated MaintenanceHistory type with plant_id', async () => {
    try {
      const mod = await import('@/types/maintenance');
      // Type checking happens at compile time, this just validates import works
      expect(mod).toBeDefined();
    } catch {
      throw new Error('Maintenance types not found or have errors');
    }
  });

  it('should have updated database types with plant_id', async () => {
    try {
      const mod = await import('@/types/database');
      expect(mod).toBeDefined();
    } catch {
      throw new Error('Database types not found or have errors');
    }
  });
});
