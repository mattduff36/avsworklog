import { describe, expect, it } from 'vitest';
import { validateRequiredSchemaResponses } from '@/lib/workshop-attachments/schema-validation';
import type { AttachmentSchemaSection } from '@/types/workshop-attachments-v2';

const baseSections: AttachmentSchemaSection[] = [
  {
    id: 'section-1',
    section_key: 'inside_cab',
    title: 'Inside Cab',
    description: null,
    sort_order: 1,
    fields: [
      {
        id: 'field-1',
        field_key: 'engine_mil',
        label: 'Engine MIL',
        help_text: null,
        field_type: 'marking_code',
        is_required: true,
        sort_order: 1,
        options_json: null,
        validation_json: { require_note_for: ['attention', 'monitor'] },
      },
      {
        id: 'field-2',
        field_key: 'inspector_signature',
        label: 'Inspector Signature',
        help_text: null,
        field_type: 'signature',
        is_required: true,
        sort_order: 2,
        options_json: null,
        validation_json: null,
      },
    ],
  },
];

describe('validateRequiredSchemaResponses', () => {
  it('requires notes for marking code attention/monitor values', () => {
    const errors = validateRequiredSchemaResponses(baseSections, [
      {
        section_key: 'inside_cab',
        field_key: 'engine_mil',
        response_value: 'attention',
        response_json: null,
      },
      {
        section_key: 'inside_cab',
        field_key: 'inspector_signature',
        response_value: 'Inspector Name',
        response_json: {
          data_url: 'data:image/png;base64,abc',
          signed_by_name: 'Inspector Name',
          signed_at: '2026-04-01T12:00:00.000Z',
        },
      },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Engine MIL requires a note');
  });

  it('requires signature payload for required signature fields', () => {
    const errors = validateRequiredSchemaResponses(baseSections, [
      {
        section_key: 'inside_cab',
        field_key: 'engine_mil',
        response_value: 'serviceable',
        response_json: null,
      },
      {
        section_key: 'inside_cab',
        field_key: 'inspector_signature',
        response_value: 'Inspector Name',
        response_json: null,
      },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Inspector Signature signature is required');
  });

  it('passes when required values, notes, and signatures are present', () => {
    const errors = validateRequiredSchemaResponses(baseSections, [
      {
        section_key: 'inside_cab',
        field_key: 'engine_mil',
        response_value: 'attention',
        response_json: { note: 'MIL light diagnostics complete.' },
      },
      {
        section_key: 'inside_cab',
        field_key: 'inspector_signature',
        response_value: 'Inspector Name',
        response_json: {
          data_url: 'data:image/png;base64,abc',
          signed_by_name: 'Inspector Name',
          signed_at: '2026-04-01T12:00:00.000Z',
        },
      },
    ]);

    expect(errors).toEqual([]);
  });
});
