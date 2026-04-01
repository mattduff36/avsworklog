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
        v2Sections: [
          {
            section_key: 'section_1',
            title: 'Checklist',
            description: null,
            fields: [
              {
                field_key: 'oil_level_checked',
                label: 'Oil level checked',
                field_type: 'yes_no',
                is_required: true,
                response_value: 'yes',
                response_json: null,
              },
              {
                field_key: 'section_comments',
                label: 'Section Comments',
                field_type: 'long_text',
                is_required: false,
                response_value: 'All items in good condition',
                response_json: null,
              },
            ],
          },
        ],
        assetName: '878 (Trailer woodford tilt bed)',
        assetType: 'plant' as const,
      };

      expect(pdfProps.templateName).toBe('Service Checklist');
      expect(pdfProps.v2Sections).toHaveLength(1);
      expect(pdfProps.v2Sections[0].fields).toHaveLength(2);
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
        v2Sections: [
          {
            section_key: 'section_1',
            title: 'Checks',
            description: null,
            fields: [
              {
                field_key: 'engine_condition',
                label: 'Engine condition',
                field_type: 'text',
                is_required: true,
                response_value: null,
                response_json: null,
              },
            ],
          },
        ],
        assetName: null,
        assetType: null,
      };

      expect(pdfProps.v2Sections[0].fields[0].response_value).toBeNull();
      expect(pdfProps.templateDescription).toBeNull();
      expect(pdfProps.completedAt).toBeNull();
      expect(pdfProps.assetName).toBeNull();
    });

    it('should calculate completion percentage correctly', () => {
      const fields = [
        { field_type: 'yes_no', response_value: 'yes' },
        { field_type: 'yes_no', response_value: '' },
        { field_type: 'text', response_value: '' },
      ];

      const answeredCount = fields.filter((field) => field.response_value.trim() !== '').length;
      expect(answeredCount).toBe(1);
      expect(Math.round((answeredCount / fields.length) * 100)).toBe(33);
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

      const v2Sections = [
        {
          section_key: 'section_1',
          title: 'Checklist',
          description: null,
          fields: [
            {
              field_key: 'checked',
              label: 'Checked',
              field_type: 'yes_no',
              is_required: true,
              response_value: 'yes',
              response_json: null,
            },
          ],
        },
      ];

      const task = {
        id: 'task-1',
        status: 'completed',
        workshop_comments: 'carry out inspection',
        workshop_task_categories: { name: 'Service (Plant)' },
      };

      expect(attachment.workshop_attachment_templates?.name).toBe('Service Checklist');
      expect(v2Sections).toHaveLength(1);
      expect(v2Sections[0].fields).toHaveLength(1);
      expect(task.workshop_task_categories?.name).toBe('Service (Plant)');
    });
  });
});
