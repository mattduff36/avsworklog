import { describe, expect, it } from 'vitest';
import { remapResponsesByFieldKey } from '@/lib/workshop-attachments/response-remap';

describe('remapResponsesByFieldKey', () => {
  it('preserves response values/json while remapping section and field ids', () => {
    const result = remapResponsesByFieldKey(
      [
        {
          field_key: 'engine_mil',
          response_value: 'attention',
          response_json: { note: 'MIL lamp active' },
        },
        {
          field_key: 'unknown_field',
          response_value: 'serviceable',
          response_json: null,
        },
      ],
      new Map([
        [
          'engine_mil',
          {
            field_id: 'field-1',
            section_key: 'inside_cab',
          },
        ],
      ]),
    );

    expect(result.mapped).toHaveLength(1);
    expect(result.mapped[0]).toEqual({
      field_id: 'field-1',
      section_key: 'inside_cab',
      field_key: 'engine_mil',
      response_value: 'attention',
      response_json: { note: 'MIL lamp active' },
    });
    expect(result.unmappedKeys).toEqual(['unknown_field']);
  });
});
