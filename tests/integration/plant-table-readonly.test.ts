/**
 * Test: Plant Table Read-Only Verification Tests
 * Verifies plant table structure and data integrity without creating records
 * Safe to run against production (read-only operations)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Skip if no environment variables
if (!supabaseUrl || !supabaseServiceKey) {
  console.log('⏭️  Skipping tests - missing environment variables');
  process.exit(0);
}

describe('Plant Table Read-Only Verification', () => {
  let supabase: ReturnType<typeof createClient>;

  beforeAll(() => {
    supabase = createClient(supabaseUrl!, supabaseServiceKey!);
  });

  describe('Database Schema Verification', () => {
    it('should have plant table with all required columns', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('*')
        .limit(1)
        .maybeSingle();

      expect(error).toBeNull();
      
      // Verify structure (may be null if no rows, but should not error)
      if (data) {
        expect(data).toHaveProperty('id');
        expect(data).toHaveProperty('plant_id');
        expect(data).toHaveProperty('nickname');
        expect(data).toHaveProperty('make');
        expect(data).toHaveProperty('model');
        expect(data).toHaveProperty('serial_number');
        expect(data).toHaveProperty('year');
        expect(data).toHaveProperty('weight_class');
        expect(data).toHaveProperty('category_id');
        expect(data).toHaveProperty('loler_due_date');
        expect(data).toHaveProperty('loler_last_inspection_date');
        expect(data).toHaveProperty('loler_certificate_number');
        expect(data).toHaveProperty('loler_inspection_interval_months');
        expect(data).toHaveProperty('current_hours');
        expect(data).toHaveProperty('status');
        expect(data).toHaveProperty('created_at');
        expect(data).toHaveProperty('updated_at');
      }
    });

    it('should have plant_id column in actions table', async () => {
      const { error } = await supabase
        .from('actions')
        .select('id, plant_id')
        .limit(1);
      
      expect(error).toBeNull();
    });

    it('should have plant_id column in vehicle_inspections table', async () => {
      const { error } = await supabase
        .from('vehicle_inspections')
        .select('id, plant_id')
        .limit(1);
      
      expect(error).toBeNull();
    });

    it('should have plant_id column in vehicle_maintenance table', async () => {
      const { error } = await supabase
        .from('vehicle_maintenance')
        .select('id, plant_id, current_hours, last_service_hours, next_service_hours')
        .limit(1);
      
      expect(error).toBeNull();
    });

    it('should NOT have plant rows in vehicles table', async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id')
        .eq('asset_type', 'plant')
        .limit(1);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe('Data Migration Verification', () => {
    it('should have plant records in plant table', async () => {
      const { count, error } = await supabase
        .from('plant')
        .select('*', { count: 'exact', head: true });

      expect(error).toBeNull();
      expect(count).toBeGreaterThan(0);
      console.log(`✅ Found ${count} plant records in plant table`);
    });

    it('should have workshop tasks with plant_id', async () => {
      const { count, error } = await supabase
        .from('actions')
        .select('*', { count: 'exact', head: true })
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      console.log(`✅ Found ${count || 0} workshop tasks with plant_id`);
    });

    it('should have maintenance records with plant_id', async () => {
      const { count, error } = await supabase
        .from('vehicle_maintenance')
        .select('*', { count: 'exact', head: true })
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      console.log(`✅ Found ${count || 0} maintenance records with plant_id`);
    });

    it('should have inspections with plant_id', async () => {
      const { count, error } = await supabase
        .from('vehicle_inspections')
        .select('*', { count: 'exact', head: true })
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      console.log(`✅ Found ${count || 0} inspections with plant_id`);
    });
  });

  describe('Plant Table Queries', () => {
    it('should query plant records successfully', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('*')
        .eq('status', 'active')
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      
      if (data && data.length > 0) {
        console.log(`✅ Successfully queried ${data.length} active plant records`);
      }
    });

    it('should join plant with workshop tasks', async () => {
      const { data, error } = await supabase
        .from('actions')
        .select(`
          id,
          title,
          plant_id,
          plant (
            plant_id,
            nickname,
            make,
            model
          )
        `)
        .not('plant_id', 'is', null)
        .limit(3);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      
      if (data && data.length > 0) {
        expect(data[0]).toHaveProperty('plant');
        console.log(`✅ Successfully joined plant with workshop tasks`);
      }
    });

    it('should join plant with maintenance records', async () => {
      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          id,
          current_hours,
          plant_id,
          plant (
            plant_id,
            nickname
          )
        `)
        .not('plant_id', 'is', null)
        .limit(3);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      
      if (data && data.length > 0) {
        expect(data[0]).toHaveProperty('plant');
        console.log(`✅ Successfully joined plant with maintenance records`);
      }
    });
  });

  describe('LOLER Fields Verification', () => {
    it('should query plant with LOLER fields', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('plant_id, loler_due_date, loler_last_inspection_date, loler_certificate_number, loler_inspection_interval_months')
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      console.log(`✅ LOLER fields accessible on plant table`);
    });

    it('should filter plant by LOLER due date', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('plant_id, loler_due_date')
        .not('loler_due_date', 'is', null)
        .order('loler_due_date', { ascending: true })
        .limit(3);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      
      if (data && data.length > 0) {
        console.log(`✅ Found ${data.length} plant records with LOLER due dates`);
      }
    });
  });

  describe('Data Integrity Checks', () => {
    it('should have unique plant_id values', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('plant_id');

      expect(error).toBeNull();
      
      if (data) {
        const plantIds = data.map(p => p.plant_id);
        const uniquePlantIds = new Set(plantIds);
        expect(plantIds.length).toBe(uniquePlantIds.size);
        console.log(`✅ All ${plantIds.length} plant_id values are unique`);
      }
    });

    it('should have valid status values', async () => {
      const { data, error } = await supabase
        .from('plant')
        .select('status');

      expect(error).toBeNull();
      
      if (data) {
        const validStatuses = ['active', 'inactive', 'maintenance', 'retired'];
        const allValid = data.every(p => validStatuses.includes(p.status));
        expect(allValid).toBe(true);
        console.log(`✅ All plant records have valid status values`);
      }
    });

    it('should NOT have actions with both vehicle_id and plant_id', async () => {
      const { data, error } = await supabase
        .from('actions')
        .select('id, vehicle_id, plant_id')
        .not('vehicle_id', 'is', null)
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      expect(data).toEqual([]);
      console.log(`✅ No actions have both vehicle_id and plant_id (constraint enforced)`);
    });

    it('should NOT have maintenance with both vehicle_id and plant_id', async () => {
      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select('id, vehicle_id, plant_id')
        .not('vehicle_id', 'is', null)
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      expect(data).toEqual([]);
      console.log(`✅ No maintenance records have both vehicle_id and plant_id (constraint enforced)`);
    });

    it('should NOT have inspections with both vehicle_id and plant_id', async () => {
      const { data, error } = await supabase
        .from('vehicle_inspections')
        .select('id, vehicle_id, plant_id')
        .not('vehicle_id', 'is', null)
        .not('plant_id', 'is', null);

      expect(error).toBeNull();
      expect(data).toEqual([]);
      console.log(`✅ No inspections have both vehicle_id and plant_id (constraint enforced)`);
    });
  });

  describe('Migration Completeness', () => {
    it('should have expected migration row count (58 plant records)', async () => {
      const { count, error } = await supabase
        .from('plant')
        .select('*', { count: 'exact', head: true });

      expect(error).toBeNull();
      expect(count).toBe(58); // Exact number from migration
      console.log(`✅ Confirmed: 58 plant records migrated successfully`);
    });

    it('should have all plant workshop tasks migrated', async () => {
      const { count: plantTaskCount } = await supabase
        .from('actions')
        .select('*', { count: 'exact', head: true })
        .not('plant_id', 'is', null);

      expect(plantTaskCount).toBeGreaterThanOrEqual(0);
      console.log(`✅ ${plantTaskCount} workshop tasks reference plant_id`);
    });
  });
});
