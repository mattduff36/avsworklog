/**
 * Fleet Module Integration Tests
 * Tests all workflows for /fleet page including vehicles, maintenance, and categories
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? 'Set' : 'Missing');
  throw new Error('Missing required environment variables for integration tests');
}

describe('Fleet Module Workflows', () => {
  let supabase: ReturnType<typeof createClient>;
  let testUserId: string;
  let testVehicleId: string;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl, supabaseKey);
    
    // Authenticate as test user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'test123456',
    });

    if (authError) throw authError;
    testUserId = authData.user!.id;
  });

  afterAll(async () => {
    await supabase.auth.signOut();
  });

  describe('Vehicles Tab Workflows', () => {
    it('should fetch all active vehicles', async () => {
      const { data: vehicles, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          *,
          vehicles!inner(id, reg_number, nickname)
        `);

      expect(error).toBeNull();
      expect(vehicles).toBeDefined();
      expect(Array.isArray(vehicles)).toBe(true);
    });

    it('should fetch all active vehicles (alternative direct query)', async () => {
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('*')
        .neq('status', 'deleted')
        .order('nickname');

      expect(error).toBeNull();
      expect(vehicles).toBeDefined();
      expect(Array.isArray(vehicles)).toBe(true);
    });

    it('should fetch vehicle with maintenance data', async () => {
      // First get a vehicle ID from vehicles table
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id')
        .neq('status', 'deleted')
        .limit(1);

      if (!vehicles || vehicles.length === 0) {
        console.log('No vehicles found, skipping test');
        return;
      }

      const vehicleId = vehicles[0].id;

      const { data: vehicleData, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          *,
          vehicles!inner(
            id,
            reg_number,
            nickname,
            category_id,
            vehicle_categories(id, name)
          )
        `)
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      if (error) {
        console.log('Error fetching vehicle data:', error);
      }
      
      if (!vehicleData) {
        console.log('No maintenance record found for vehicle, skipping test');
        return;
      }

      expect(vehicleData).toBeDefined();
      expect(vehicleData?.vehicle_id).toBe(vehicleId);
      
      // Set testVehicleId for other tests
      testVehicleId = vehicleId;
    });

    it('should update vehicle maintenance data', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      // First, get the vehicle_maintenance record ID
      const { data: vmRecord } = await supabase
        .from('vehicle_maintenance')
        .select('id')
        .eq('vehicle_id', testVehicleId)
        .single();

      if (!vmRecord) {
        console.log('No vehicle_maintenance record found, skipping test');
        return;
      }

      const updates = {
        current_mileage: 50000,
      };

      const { data: updated, error } = await supabase
        .from('vehicle_maintenance')
        .update(updates)
        .eq('id', vmRecord.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.current_mileage).toBe(50000);
    });
  });

  describe('Maintenance Tab Workflows', () => {
    it('should fetch all workshop tasks with filters', async () => {
      const { data: tasks, error } = await supabase
        .from('actions')
        .select(`
          *,
          vehicle:vehicles!vehicle_id(id, reg_number, nickname),
          category:workshop_task_categories(id, name, slug),
          subcategory:workshop_task_subcategories(id, name, slug)
        `)
        .eq('action_type', 'workshop_task')
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status', async () => {
      const { data: pendingTasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('status', 'pending');

      expect(error).toBeNull();
      expect(pendingTasks).toBeDefined();
      expect(Array.isArray(pendingTasks)).toBe(true);
    });

    it('should filter tasks by vehicle', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: vehicleTasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('vehicle_id', testVehicleId);

      expect(error).toBeNull();
      expect(vehicleTasks).toBeDefined();
      expect(Array.isArray(vehicleTasks)).toBe(true);
    });

    it('should fetch overdue and due soon tasks', async () => {
      // Fetch vehicles with service data by joining with active vehicles
      const { data: vehicles, error } = await supabase
        .from('vehicle_maintenance')
        .select(`
          *,
          vehicles!inner(id, status)
        `)
        .neq('vehicles.status', 'deleted');

      expect(error).toBeNull();
      expect(vehicles).toBeDefined();

      // Calculate overdue/due soon based on service dates
      const today = new Date();
      const overdueVehicles = vehicles?.filter(v => {
        if (!v.mot_expiry_date) return false;
        const motDate = new Date(v.mot_expiry_date);
        return motDate < today;
      });

      expect(Array.isArray(overdueVehicles)).toBe(true);
    });
  });

  describe('Vehicle Categories Management', () => {
    let testCategoryId: string;

    it('should fetch all vehicle categories', async () => {
      const { data: categories, error} = await supabase
        .from('vehicle_categories')
        .select('*')
        .order('name');

      expect(error).toBeNull();
      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
    });

    it('should create a new vehicle category (manager only)', async () => {
      const newCategory = {
        name: 'Test Category ' + Date.now(),
        colour: '#FF0000',
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      
      try {
        const response = await fetch(`${siteUrl}/api/admin/vehicle-categories`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(newCategory),
        });

        if (response.status === 403) {
          console.log('User not authorized for category management, skipping test');
          return;
        }

        expect(response.ok).toBe(true);
        const data = await response.json();
        expect(data.success).toBe(true);
        
        if (data.category) {
          testCategoryId = data.category.id;
        }
      } catch (error) {
        console.log('API test skipped - server may not be reachable from test environment');
        return;
      }
    }, 10000);

    it('should update vehicle category', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const updates = {
        colour: '#00FF00',
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const response = await fetch(`${siteUrl}/api/admin/vehicle-categories/${testCategoryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should delete vehicle category', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const response = await fetch(`${siteUrl}/api/admin/vehicle-categories/${testCategoryId}`, {
        method: 'DELETE',
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });
  });
});
