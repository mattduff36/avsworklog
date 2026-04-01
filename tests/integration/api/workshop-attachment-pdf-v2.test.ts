import { describe, expect, it } from 'vitest';
import { renderToStream } from '@react-pdf/renderer';
import { WorkshopAttachmentPDF } from '@/lib/pdf/workshop-attachment-pdf';

async function renderPdfByteLength(documentNode: ReturnType<typeof WorkshopAttachmentPDF>) {
  const stream = await renderToStream(documentNode);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).byteLength;
}

describe('WorkshopAttachmentPDF rendering paths', () => {
  it('renders v2 section layout for standard fields', async () => {
    const byteLength = await renderPdfByteLength(
      WorkshopAttachmentPDF({
        templateName: 'Legacy Template',
        templateDescription: null,
        taskTitle: 'Legacy test task',
        taskCategory: 'Workshop Task',
        taskStatus: 'in_progress',
        attachmentStatus: 'pending',
        completedAt: null,
        createdAt: '2026-04-01T09:00:00.000Z',
        v2Sections: [
          {
            section_key: 'checks',
            title: 'Checks',
            description: null,
            fields: [
              {
                field_key: 'oil_level',
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
                response_value: 'All good',
                response_json: null,
              },
            ],
          },
        ],
        assetName: 'VN-TEST-001',
        assetType: 'van',
      }),
    );

    expect(byteLength).toBeGreaterThan(500);
  });

  it('renders v2 section layout including signature fields', async () => {
    const byteLength = await renderPdfByteLength(
      WorkshopAttachmentPDF({
        templateName: 'V2 Template',
        templateDescription: 'V2 PDF path',
        taskTitle: 'V2 test task',
        taskCategory: 'Service (HGV)',
        taskStatus: 'in_progress',
        attachmentStatus: 'pending',
        completedAt: null,
        createdAt: '2026-04-01T09:00:00.000Z',
        v2Sections: [
          {
            section_key: 'general',
            title: 'General',
            description: 'General checks.',
            fields: [
              {
                field_key: 'check_1',
                label: 'Engine condition',
                field_type: 'marking_code',
                is_required: true,
                response_value: 'attention',
                response_json: { note: 'Requires follow-up' },
              },
              {
                field_key: 'sign_1',
                label: 'Inspector Signature',
                field_type: 'signature',
                is_required: true,
                response_value: 'Inspector',
                response_json: {
                  data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
                  signed_by_name: 'Inspector',
                  signed_at: '2026-04-01T10:30:00.000Z',
                },
              },
            ],
          },
        ],
        assetName: 'HGV-TEST-001',
        assetType: 'hgv',
      }),
    );

    expect(byteLength).toBeGreaterThan(500);
  });
});
