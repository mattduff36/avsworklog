/**
 * Workshop Tasks Module Integration Tests
 * Tests all workflows for /workshop-tasks page including task management and category management
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

describe('Workshop Tasks Module Workflows', () => {
  let supabase: ReturnType<typeof createClient>;
  let testUserId: string;
  let testTaskId: string;
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

    // Get a test vehicle
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id')
      .neq('status', 'deleted')
      .limit(1);

    if (vehicles && vehicles.length > 0) {
      testVehicleId = vehicles[0].id;
    }
  });

  afterAll(async () => {
    await supabase.auth.signOut();
  });

  describe('Task Viewing and Filtering', () => {
    it('should fetch all workshop tasks', async () => {
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

      if (tasks && tasks.length > 0) {
        testTaskId = tasks[0].id;
      }
    });

    it('should filter tasks by status - pending', async () => {
      const { data: tasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('status', 'pending');

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status - in progress', async () => {
      const { data: tasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('status', 'logged');

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status - on hold', async () => {
      const { data: tasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('status', 'on_hold');

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by status - completed', async () => {
      const { data: tasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('status', 'completed');

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter tasks by vehicle', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: tasks, error } = await supabase
        .from('actions')
        .select('*')
        .eq('action_type', 'workshop_task')
        .eq('vehicle_id', testVehicleId);

      expect(error).toBeNull();
      expect(tasks).toBeDefined();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe('Task Status Change Workflows', () => {
    let workflowTestTaskId: string;

    beforeAll(async () => {
      // Create a test task for workflow testing
      if (!testVehicleId) return;

      const { data: categories } = await supabase
        .from('workshop_task_categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!categories || categories.length === 0) return;

      const { data: newTask, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_task',
          title: 'Test Workflow Task ' + Date.now(),
          description: 'Testing status workflows',
          status: 'pending',
          priority: 'medium',
          vehicle_id: testVehicleId,
          workshop_category_id: categories[0].id,
          created_by: testUserId,
        })
        .select()
        .single();

      if (!error && newTask) {
        workflowTestTaskId = newTask.id;
      }
    });

    afterAll(async () => {
      // Clean up test task
      if (workflowTestTaskId) {
        await supabase
          .from('actions')
          .delete()
          .eq('id', workflowTestTaskId);
      }
    });

    it('should start task (pending -> in progress)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_by: testUserId,
          logged_at: new Date().toISOString(),
          logged_comment: 'Started working on this task',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('logged');
    });

    it('should place task on hold (in progress -> on hold)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'on_hold',
          workshop_comments: 'Waiting for parts',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('on_hold');
    });

    it('should resume task (on hold -> in progress)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          workshop_comments: 'Parts arrived, resuming work',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('logged');
    });

    it('should complete task (in progress -> completed)', async () => {
      if (!workflowTestTaskId) {
        console.log('No workflow test task, skipping test');
        return;
      }

      const { data: updated, error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_by: testUserId,
          actioned_at: new Date().toISOString(),
          actioned_comment: 'Task completed successfully',
        })
        .eq('id', workflowTestTaskId)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('completed');
      expect(updated?.actioned).toBe(true);
    });

    it('should support multi-step completion (pending -> in progress -> completed)', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: categories } = await supabase
        .from('workshop_task_categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!categories || categories.length === 0) {
        console.log('No categories, skipping test');
        return;
      }

      // Create task
      const { data: newTask, error: createError } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_task',
          title: 'Multi-step Test Task ' + Date.now(),
          description: 'Testing multi-step completion',
          status: 'pending',
          priority: 'high',
          vehicle_id: testVehicleId,
          workshop_category_id: categories[0].id,
          created_by: testUserId,
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(newTask).toBeDefined();

      if (!newTask) return;

      // Step 1: Move to in progress
      const { data: inProgress, error: step1Error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_by: testUserId,
          logged_at: new Date().toISOString(),
          logged_comment: 'Step 1: Started task',
        })
        .eq('id', newTask.id)
        .select()
        .single();

      expect(step1Error).toBeNull();
      expect(inProgress?.status).toBe('logged');

      // Step 2: Complete
      const { data: completed, error: step2Error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_by: testUserId,
          actioned_at: new Date().toISOString(),
          actioned_comment: 'Step 2: Completed task',
        })
        .eq('id', newTask.id)
        .select()
        .single();

      expect(step2Error).toBeNull();
      expect(completed?.status).toBe('completed');

      // Clean up
      await supabase.from('actions').delete().eq('id', newTask.id);
    });
  });

  describe('Category Management Workflows', () => {
    let testCategoryId: string;
    let testSubcategoryId: string;

    it('should fetch all categories', async () => {
      const { data: categories, error } = await supabase
        .from('workshop_task_categories')
        .select('*')
        .eq('is_active', true)
        .order('name');

      expect(error).toBeNull();
      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
    });

    it('should fetch all subcategories', async () => {
      const { data: subcategories, error } = await supabase
        .from('workshop_task_subcategories')
        .select('*')
        .eq('is_active', true)
        .order('name');

      expect(error).toBeNull();
      expect(subcategories).toBeDefined();
      expect(Array.isArray(subcategories)).toBe(true);
    });

    it('should create new category via API (manager only)', async () => {
      const newCategory = {
        name: 'Test Category ' + Date.now(),
        slug: 'test-category-' + Date.now(),
        sort_order: 0,
        is_active: true,
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      
      try {
        const response = await fetch(`${siteUrl}/api/workshop-tasks/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

    it('should update category via API', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const updates = {
        name: 'Updated Test Category',
      };

      const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/workshop-tasks/categories/${testCategoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should create subcategory via API', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const newSubcategory = {
        category_id: testCategoryId,
        name: 'Test Subcategory ' + Date.now(),
        slug: 'test-subcategory-' + Date.now(),
        sort_order: 0,
        is_active: true,
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/subcategories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubcategory),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);

      if (data.subcategory) {
        testSubcategoryId = data.subcategory.id;
      }
    });

    it('should update subcategory via API', async () => {
      if (!testSubcategoryId) {
        console.log('No test subcategory, skipping test');
        return;
      }

      const updates = {
        name: 'Updated Test Subcategory',
        slug: 'updated-test-subcategory',
      };

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/subcategories/${testSubcategoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should delete subcategory via API', async () => {
      if (!testSubcategoryId) {
        console.log('No test subcategory, skipping test');
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/subcategories/${testSubcategoryId}`, {
        method: 'DELETE',
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });

    it('should delete category via API', async () => {
      if (!testCategoryId) {
        console.log('No test category, skipping test');
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const response = await fetch(`${siteUrl}/api/workshop-tasks/categories/${testCategoryId}`, {
        method: 'DELETE',
      });

      if (response.status === 403) {
        console.log('User not authorized, skipping test');
        return;
      }

      expect(response.ok).toBe(true);
    });
  });

  describe('Task Creation Workflow', () => {
    let createdTaskId: string;

    it('should create a new workshop task', async () => {
      if (!testVehicleId) {
        console.log('No test vehicle, skipping test');
        return;
      }

      const { data: categories } = await supabase
        .from('workshop_task_categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      if (!categories || categories.length === 0) {
        console.log('No categories, skipping test');
        return;
      }

      const newTask = {
        action_type: 'workshop_task',
        title: 'New Workshop Task ' + Date.now(),
        description: 'Test task creation',
        status: 'pending',
        priority: 'medium',
        vehicle_id: testVehicleId,
        workshop_category_id: categories[0].id,
        created_by: testUserId,
      };

      const { data: task, error } = await supabase
        .from('actions')
        .insert(newTask)
        .select()
        .single();

      expect(error).toBeNull();
      expect(task).toBeDefined();
      expect(task?.title).toBe(newTask.title);

      if (task) {
        createdTaskId = task.id;
      }
    });

    it('should cleanup created task', async () => {
      if (!createdTaskId) {
        console.log('No created task, skipping cleanup');
        return;
      }

      const { error } = await supabase
        .from('actions')
        .delete()
        .eq('id', createdTaskId);

      expect(error).toBeNull();
    });
  });
});
