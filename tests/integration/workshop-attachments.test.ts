/**
 * Workshop Task Attachments Integration Tests
 * Tests attachment templates, questions, task attachments, and responses
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
  throw new Error('Missing required environment variables for integration tests');
}

describe('Workshop Task Attachments', () => {
  let supabase: ReturnType<typeof createClient>;
  let testUserId: string;
  let testTemplateId: string;
  let testQuestionId: string;
  let testTaskId: string;
  let testAttachmentId: string;
  let testVehicleId: string;

  beforeAll(async () => {
    supabase = createClient(supabaseUrl, supabaseKey);
    
    // Authenticate as test user (admin/manager required for template CRUD)
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
    // Clean up test data
    if (testAttachmentId) {
      await supabase
        .from('workshop_task_attachments')
        .delete()
        .eq('id', testAttachmentId);
    }
    if (testTaskId) {
      await supabase
        .from('actions')
        .delete()
        .eq('id', testTaskId);
    }
    await supabase.auth.signOut();
  });

  describe('Attachment Templates', () => {
    it('should fetch seeded attachment templates', async () => {
      const { data: templates, error } = await supabase
        .from('workshop_attachment_templates')
        .select('*')
        .eq('is_active', true)
        .order('name');

      expect(error).toBeNull();
      expect(templates).toBeDefined();
      expect(Array.isArray(templates)).toBe(true);
      
      // Should have the seeded templates
      const templateNames = templates?.map(t => t.name) || [];
      expect(templateNames).toContain('Vehicle Van Full Service');
      expect(templateNames).toContain('Vehicle Van Basic Service');

      // Store a template ID for later tests
      if (templates && templates.length > 0) {
        testTemplateId = templates[0].id;
      }
    });

    it('should fetch template with questions', async () => {
      if (!testTemplateId) {
        console.log('Skipping: No template ID available');
        return;
      }

      const { data: questions, error } = await supabase
        .from('workshop_attachment_questions')
        .select('*')
        .eq('template_id', testTemplateId)
        .order('sort_order');

      expect(error).toBeNull();
      expect(questions).toBeDefined();
      expect(Array.isArray(questions)).toBe(true);
      expect(questions!.length).toBeGreaterThan(0);

      // Store a question ID for later tests
      if (questions && questions.length > 0) {
        testQuestionId = questions[0].id;
      }
    });

    it('should have checkbox question type for service checklist items', async () => {
      if (!testTemplateId) {
        console.log('Skipping: No template ID available');
        return;
      }

      const { data: questions, error } = await supabase
        .from('workshop_attachment_questions')
        .select('*')
        .eq('template_id', testTemplateId);

      expect(error).toBeNull();
      expect(questions).toBeDefined();

      // All questions in service templates should be checkboxes
      const allCheckbox = questions?.every(q => q.question_type === 'checkbox');
      expect(allCheckbox).toBe(true);
    });
  });

  describe('Task Attachments', () => {
    beforeAll(async () => {
      // Create a test workshop task
      if (!testVehicleId) {
        console.log('Skipping task attachment tests: No vehicle available');
        return;
      }

      // Get a subcategory
      const { data: subcategories } = await supabase
        .from('workshop_task_subcategories')
        .select('id')
        .eq('is_active', true)
        .limit(1);

      const subcategoryId = subcategories?.[0]?.id;

      const { data: task, error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          vehicle_id: testVehicleId,
          workshop_subcategory_id: subcategoryId,
          workshop_comments: 'Test task for attachment integration test',
          title: 'Integration Test Task',
          description: 'Test task',
          status: 'pending',
          priority: 'medium',
          created_by: testUserId,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error creating test task:', error);
        return;
      }

      testTaskId = task.id;
    });

    it('should add an attachment to a task', async () => {
      if (!testTaskId || !testTemplateId) {
        console.log('Skipping: Missing task or template ID');
        return;
      }

      const { data: attachment, error } = await supabase
        .from('workshop_task_attachments')
        .insert({
          task_id: testTaskId,
          template_id: testTemplateId,
          status: 'pending',
          created_by: testUserId,
        })
        .select('*')
        .single();

      expect(error).toBeNull();
      expect(attachment).toBeDefined();
      expect(attachment!.task_id).toBe(testTaskId);
      expect(attachment!.template_id).toBe(testTemplateId);
      expect(attachment!.status).toBe('pending');

      testAttachmentId = attachment!.id;
    });

    it('should not allow duplicate template on same task', async () => {
      if (!testTaskId || !testTemplateId) {
        console.log('Skipping: Missing task or template ID');
        return;
      }

      const { error } = await supabase
        .from('workshop_task_attachments')
        .insert({
          task_id: testTaskId,
          template_id: testTemplateId,
          status: 'pending',
          created_by: testUserId,
        });

      // Should fail due to unique constraint
      expect(error).not.toBeNull();
    });

    it('should fetch attachments for a task', async () => {
      if (!testTaskId) {
        console.log('Skipping: Missing task ID');
        return;
      }

      const { data: attachments, error } = await supabase
        .from('workshop_task_attachments')
        .select(`
          *,
          workshop_attachment_templates (
            id,
            name,
            description
          )
        `)
        .eq('task_id', testTaskId);

      expect(error).toBeNull();
      expect(attachments).toBeDefined();
      expect(Array.isArray(attachments)).toBe(true);
      expect(attachments!.length).toBeGreaterThan(0);
    });
  });

  describe('Attachment Responses', () => {
    it('should save responses to an attachment', async () => {
      if (!testAttachmentId || !testQuestionId) {
        console.log('Skipping: Missing attachment or question ID');
        return;
      }

      const questionSnapshot = {
        question_text: 'Test question',
        question_type: 'checkbox',
        is_required: false,
      };

      const { data: response, error } = await supabase
        .from('workshop_attachment_responses')
        .insert({
          attachment_id: testAttachmentId,
          question_id: testQuestionId,
          question_snapshot: questionSnapshot,
          response_value: 'true',
        })
        .select('*')
        .single();

      expect(error).toBeNull();
      expect(response).toBeDefined();
      expect(response!.attachment_id).toBe(testAttachmentId);
      expect(response!.question_id).toBe(testQuestionId);
      expect(response!.response_value).toBe('true');
    });

    it('should fetch responses for an attachment', async () => {
      if (!testAttachmentId) {
        console.log('Skipping: Missing attachment ID');
        return;
      }

      const { data: responses, error } = await supabase
        .from('workshop_attachment_responses')
        .select('*')
        .eq('attachment_id', testAttachmentId);

      expect(error).toBeNull();
      expect(responses).toBeDefined();
      expect(Array.isArray(responses)).toBe(true);
      expect(responses!.length).toBeGreaterThan(0);
    });

    it('should update attachment status to completed', async () => {
      if (!testAttachmentId) {
        console.log('Skipping: Missing attachment ID');
        return;
      }

      const { data: attachment, error } = await supabase
        .from('workshop_task_attachments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: testUserId,
        })
        .eq('id', testAttachmentId)
        .select('*')
        .single();

      expect(error).toBeNull();
      expect(attachment).toBeDefined();
      expect(attachment!.status).toBe('completed');
      expect(attachment!.completed_at).not.toBeNull();
      expect(attachment!.completed_by).toBe(testUserId);
    });
  });

  describe('Full Service Template Content', () => {
    it('should have all expected checklist items for Full Service', async () => {
      const { data: template } = await supabase
        .from('workshop_attachment_templates')
        .select('id')
        .eq('name', 'Vehicle Van Full Service')
        .single();

      if (!template) {
        console.log('Skipping: Full Service template not found');
        return;
      }

      const { data: questions, error } = await supabase
        .from('workshop_attachment_questions')
        .select('question_text')
        .eq('template_id', template.id)
        .order('sort_order');

      expect(error).toBeNull();
      expect(questions).toBeDefined();
      
      // Verify some key checklist items are present
      const questionTexts = questions?.map(q => q.question_text) || [];
      expect(questionTexts).toContain('Engine oil replaced');
      expect(questionTexts).toContain('Oil filter replaced');
      expect(questionTexts).toContain('Road test completed');
      expect(questionTexts).toContain('Service checklist signed off');
      
      // Full service should have many items (40+)
      expect(questions!.length).toBeGreaterThan(40);
    });
  });

  describe('Basic Service Template Content', () => {
    it('should have all expected checklist items for Basic Service', async () => {
      const { data: template } = await supabase
        .from('workshop_attachment_templates')
        .select('id')
        .eq('name', 'Vehicle Van Basic Service')
        .single();

      if (!template) {
        console.log('Skipping: Basic Service template not found');
        return;
      }

      const { data: questions, error } = await supabase
        .from('workshop_attachment_questions')
        .select('question_text')
        .eq('template_id', template.id)
        .order('sort_order');

      expect(error).toBeNull();
      expect(questions).toBeDefined();
      
      // Verify some key checklist items are present
      const questionTexts = questions?.map(q => q.question_text) || [];
      expect(questionTexts).toContain('Engine oil replaced');
      expect(questionTexts).toContain('Oil filter replaced');
      expect(questionTexts).toContain('Road test completed');
      
      // Basic service should have fewer items than full service (around 19)
      expect(questions!.length).toBeGreaterThan(15);
      expect(questions!.length).toBeLessThan(25);
    });
  });
});
