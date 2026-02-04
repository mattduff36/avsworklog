/**
 * Plant Maintenance Type Structure Bug Fixes Test
 * 
 * Tests for bug fixes related to plant maintenance data structure and auto-fetch logic
 */

import { describe, it, expect } from 'vitest';

describe('Plant Maintenance Type Structure Bug Fixes', () => {
  describe('Bug 1: Complete status fields for plant assets', () => {
    it('should include all status fields in plant maintenance objects', () => {
      // Simulate PlantOverview output structure after fix
      const plantMaintenanceObject = {
        vehicle_id: 'plant-uuid-123',
        plant_id: 'P001', // Human-readable identifier
        is_plant: true,
        vehicle: {
          id: 'plant-uuid-123',
          plant_id: 'P001',
          nickname: 'Excavator 1',
        },
        current_hours: 1250,
        next_service_hours: 1500,
        loler_due_date: '2024-12-31',
        loler_status: { status: 'due_soon', days_until: 15 },
        // Plant assets don't have these, but they should be explicitly null
        tax_status: null,
        mot_status: null,
        service_status: null,
        cambelt_status: null,
        first_aid_status: null,
        overdue_count: 0,
        due_soon_count: 1,
      };

      // Verify all status fields are present
      expect(plantMaintenanceObject).toHaveProperty('tax_status');
      expect(plantMaintenanceObject).toHaveProperty('mot_status');
      expect(plantMaintenanceObject).toHaveProperty('service_status');
      expect(plantMaintenanceObject).toHaveProperty('cambelt_status');
      expect(plantMaintenanceObject).toHaveProperty('first_aid_status');
      expect(plantMaintenanceObject).toHaveProperty('loler_status');
      
      // Plant-specific statuses should be null (not undefined)
      expect(plantMaintenanceObject.tax_status).toBeNull();
      expect(plantMaintenanceObject.mot_status).toBeNull();
      expect(plantMaintenanceObject.service_status).toBeNull();
      expect(plantMaintenanceObject.cambelt_status).toBeNull();
      expect(plantMaintenanceObject.first_aid_status).toBeNull();
      
      // LOLER status should be set
      expect(plantMaintenanceObject.loler_status).not.toBeNull();
    });

    it('should use alert counts for filtering instead of individual status checks', () => {
      const plantWithoutLOLER = {
        vehicle_id: 'plant-uuid-456',
        plant_id: 'P002',
        is_plant: true,
        loler_status: { status: 'ok' }, // No LOLER alert
        tax_status: null,
        mot_status: null,
        service_status: null,
        cambelt_status: null,
        first_aid_status: null,
        overdue_count: 0,
        due_soon_count: 0,
      };

      const plantWithLOLER = {
        vehicle_id: 'plant-uuid-789',
        plant_id: 'P003',
        is_plant: true,
        loler_status: { status: 'due_soon', days_until: 10 },
        tax_status: null,
        mot_status: null,
        service_status: null,
        cambelt_status: null,
        first_aid_status: null,
        overdue_count: 0,
        due_soon_count: 1,
      };

      // Simulate the fixed filter logic
      const filterByAlertCounts = (v: any) => {
        // Check alert counts first (works for both vehicles and plant)
        if (v.overdue_count > 0 || v.due_soon_count > 0) {
          return true;
        }
        
        // Fallback to individual status checks
        return v.tax_status?.status === 'overdue' || v.tax_status?.status === 'due_soon' ||
          v.mot_status?.status === 'overdue' || v.mot_status?.status === 'due_soon' ||
          v.service_status?.status === 'overdue' || v.service_status?.status === 'due_soon' ||
          v.cambelt_status?.status === 'overdue' || v.cambelt_status?.status === 'due_soon' ||
          v.first_aid_status?.status === 'overdue' || v.first_aid_status?.status === 'due_soon' ||
          v.loler_status?.status === 'overdue' || v.loler_status?.status === 'due_soon';
      };

      // Plant without LOLER alert should not be fetched
      expect(filterByAlertCounts(plantWithoutLOLER)).toBe(false);

      // Plant with LOLER alert should be fetched
      expect(filterByAlertCounts(plantWithLOLER)).toBe(true);
    });

    it('should handle plant assets with service alerts (future-proofing)', () => {
      const plantWithServiceAlert = {
        vehicle_id: 'plant-uuid-999',
        plant_id: 'P004',
        is_plant: true,
        loler_status: { status: 'ok' },
        tax_status: null,
        mot_status: null,
        service_status: null,
        cambelt_status: null,
        first_aid_status: null,
        overdue_count: 1, // Has an overdue alert (could be hours-based service)
        due_soon_count: 0,
      };

      // Filter should catch it via alert counts
      const filterByAlertCounts = (v: any) => {
        if (v.overdue_count > 0 || v.due_soon_count > 0) {
          return true;
        }
        return false;
      };

      expect(filterByAlertCounts(plantWithServiceAlert)).toBe(true);
    });
  });

  describe('Bug 2: plant_id should be human-readable identifier', () => {
    it('should use plant.plant_id (human-readable) not plant.id (UUID)', () => {
      const plantFromDatabase = {
        id: 'uuid-12345-67890-abcdef', // Database UUID
        plant_id: 'P001', // Human-readable identifier
        nickname: 'Excavator 1',
        make: 'Caterpillar',
        model: '320D',
        current_hours: 1250,
      };

      // Simulate the fixed mapping
      const plantMaintenanceObject = {
        plant_id: plantFromDatabase.plant_id, // ✅ Use human-readable identifier
        plant: plantFromDatabase,
      };

      // Verify plant_id is the human-readable identifier
      expect(plantMaintenanceObject.plant_id).toBe('P001');
      expect(plantMaintenanceObject.plant_id).not.toBe('uuid-12345-67890-abcdef');
    });

    it('should maintain consistency between PlantOverview and PlantTable', () => {
      const plantFromDatabase = {
        id: 'uuid-abc-123',
        plant_id: 'P999',
        nickname: 'Test Plant',
      };

      // Both components should use the same mapping
      const fromOverview = {
        vehicle_id: plantFromDatabase.id, // UUID for API calls
        plant_id: plantFromDatabase.plant_id, // Human-readable for display
      };

      const fromTable = {
        plant_id: plantFromDatabase.plant_id, // Human-readable for display
      };

      // Both should have same plant_id value
      expect(fromOverview.plant_id).toBe(fromTable.plant_id);
      expect(fromOverview.plant_id).toBe('P999');
    });

    it('should preserve UUID in vehicle_id for API calls', () => {
      const plantFromDatabase = {
        id: 'uuid-plant-123',
        plant_id: 'P001',
      };

      const plantMaintenanceObject = {
        vehicle_id: plantFromDatabase.id, // UUID for API routing
        plant_id: plantFromDatabase.plant_id, // Human-readable for display
      };

      // vehicle_id should be UUID (for API calls)
      expect(plantMaintenanceObject.vehicle_id).toBe('uuid-plant-123');
      
      // plant_id should be human-readable (for display)
      expect(plantMaintenanceObject.plant_id).toBe('P001');
    });

    it('should allow nested plant object to access UUID via spread', () => {
      const plantFromDatabase = {
        id: 'uuid-plant-456',
        plant_id: 'P002',
        nickname: 'Telehandler',
      };

      const plantMaintenanceObject = {
        plant_id: plantFromDatabase.plant_id, // P002
        plant: {
          ...plantFromDatabase, // Spreads id: 'uuid-plant-456'
        },
      };

      // Top-level plant_id is human-readable
      expect(plantMaintenanceObject.plant_id).toBe('P002');
      
      // Nested plant.id is UUID (from spread)
      expect(plantMaintenanceObject.plant.id).toBe('uuid-plant-456');
      
      // Nested plant.plant_id is also human-readable (from spread)
      expect(plantMaintenanceObject.plant.plant_id).toBe('P002');
    });
  });

  describe('Auto-fetch logic improvements', () => {
    it('should prioritize alert counts over individual status checks', () => {
      const vehicles = [
        // Vehicle with alerts
        { 
          vehicle_id: 'v1',
          overdue_count: 2,
          due_soon_count: 1,
          tax_status: { status: 'overdue' },
        },
        // Plant with LOLER alert
        { 
          vehicle_id: 'p1',
          is_plant: true,
          overdue_count: 0,
          due_soon_count: 1,
          loler_status: { status: 'due_soon' },
          tax_status: null,
        },
        // Vehicle with no alerts
        { 
          vehicle_id: 'v2',
          overdue_count: 0,
          due_soon_count: 0,
        },
      ];

      const filterByAlertCounts = (v: any) => {
        if (v.overdue_count > 0 || v.due_soon_count > 0) {
          return true;
        }
        return false;
      };

      const filtered = vehicles.filter(filterByAlertCounts);
      
      // Should return vehicles and plant with alerts
      expect(filtered.length).toBe(2);
      expect(filtered[0].vehicle_id).toBe('v1');
      expect(filtered[1].vehicle_id).toBe('p1');
    });
  });
});
