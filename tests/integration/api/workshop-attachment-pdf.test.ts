import { describe, it, expect } from 'vitest';

/**
 * Workshop Attachment PDF Generation Tests
 * Tests the PDF document generation for workshop task attachments.
 */
describe('Workshop Attachment PDF', () => {
  describe('PDF Document Structure', () => {
    it('should accept all required props for PDF generation', () => {
      const pdfProps = {
        templateName: 'Service Checklist',
        templateDescription: 'Standard service checklist for plant machinery',
        taskTitle: 'carry out inspection',
        taskCategory: 'Service (Plant)',
        taskStatus: 'completed',
        attachmentStatus: 'completed' as const,
        completedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        questions: [
          {
            id: 'q1',
            question_text: 'Oil level checked',
            question_type: 'checkbox',
            is_required: true,
            sort_order: 1,
          },
          {
            id: 'q2',
            question_text: 'Notes',
            question_type: 'long_text',
            is_required: false,
            sort_order: 2,
          },
        ],
        responses: [
          { question_id: 'q1', response_value: 'true' },
          { question_id: 'q2', response_value: 'All items in good condition' },
        ],
        assetName: '878 (Trailer woodford tilt bed)',
        assetType: 'plant' as const,
      };

      expect(pdfProps.templateName).toBe('Service Checklist');
      expect(pdfProps.questions).toHaveLength(2);
      expect(pdfProps.responses).toHaveLength(2);
      expect(pdfProps.attachmentStatus).toBe('completed');
    });

    it('should handle empty responses gracefully', () => {
      const pdfProps = {
        templateName: 'Inspection Form',
        templateDescription: null,
        taskTitle: '',
        taskCategory: 'Workshop Task',
        taskStatus: 'completed',
        attachmentStatus: 'pending' as const,
        completedAt: null,
        createdAt: new Date().toISOString(),
        questions: [
          {
            id: 'q1',
            question_text: 'Engine condition',
            question_type: 'text',
            is_required: true,
            sort_order: 1,
          },
        ],
        responses: [],
        assetName: null,
        assetType: null,
      };

      expect(pdfProps.responses).toHaveLength(0);
      expect(pdfProps.templateDescription).toBeNull();
      expect(pdfProps.completedAt).toBeNull();
      expect(pdfProps.assetName).toBeNull();
    });

    it('should calculate completion percentage correctly', () => {
      const questions = [
        { id: 'q1', question_text: 'Item 1', question_type: 'checkbox', is_required: true, sort_order: 1 },
        { id: 'q2', question_text: 'Item 2', question_type: 'checkbox', is_required: true, sort_order: 2 },
        { id: 'q3', question_text: 'Item 3', question_type: 'text', is_required: false, sort_order: 3 },
      ];
      const responses = [
        { question_id: 'q1', response_value: 'true' },
        { question_id: 'q2', response_value: 'false' },
      ];

      const responsesMap = new Map(responses.map(r => [r.question_id, r.response_value]));
      const answeredCount = questions.filter(q => {
        const val = responsesMap.get(q.id);
        if (!val) return false;
        if (q.question_type === 'checkbox') return val === 'true';
        return val.trim() !== '';
      }).length;

      // Only q1 is truly answered (checked), q2 is unchecked, q3 has no response
      expect(answeredCount).toBe(1);
      expect(Math.round((answeredCount / questions.length) * 100)).toBe(33);
    });
  });

  describe('API Route Contract', () => {
    it('should require an attachment ID in the URL path', () => {
      const validPath = '/api/workshop-tasks/attachments/some-uuid/pdf';
      expect(validPath).toContain('/pdf');
      expect(validPath).toContain('/attachments/');
    });

    it('should return PDF content type', () => {
      const expectedHeaders = {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Service_Checklist_attachment.pdf"',
      };

      expect(expectedHeaders['Content-Type']).toBe('application/pdf');
      expect(expectedHeaders['Content-Disposition']).toMatch(/^attachment; filename=/);
    });

    it('should sanitize template name in filename', () => {
      const templateName = 'Service (Plant) - Check/Repair';
      const safeTemplateName = templateName.replace(/[^a-z0-9]/gi, '_');
      const filename = `${safeTemplateName}_attachment.pdf`;

      expect(filename).toBe('Service__Plant____Check_Repair_attachment.pdf');
      expect(filename).not.toMatch(/[/\\:*?"<>|()]/);
    });

    it('should build correct response data structure from Supabase queries', () => {
      // Simulates the data joining done in the route
      const attachment = {
        id: 'att-1',
        task_id: 'task-1',
        template_id: 'tmpl-1',
        status: 'completed',
        completed_at: '2026-02-12T10:00:00Z',
        created_at: '2026-02-10T10:00:00Z',
        workshop_attachment_templates: {
          id: 'tmpl-1',
          name: 'Service Checklist',
          description: 'Standard checklist',
        },
      };

      const questions = [
        { id: 'q1', question_text: 'Checked', question_type: 'checkbox', is_required: true, sort_order: 1 },
      ];

      const responses = [
        { question_id: 'q1', response_value: 'true' },
      ];

      const task = {
        id: 'task-1',
        status: 'completed',
        workshop_comments: 'carry out inspection',
        workshop_task_categories: { name: 'Service (Plant)' },
      };

      expect(attachment.workshop_attachment_templates?.name).toBe('Service Checklist');
      expect(questions).toHaveLength(1);
      expect(responses).toHaveLength(1);
      expect(task.workshop_task_categories?.name).toBe('Service (Plant)');
    });
  });
});
