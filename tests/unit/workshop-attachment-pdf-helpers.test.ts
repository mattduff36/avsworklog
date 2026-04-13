import { describe, expect, it } from 'vitest';
import { isSignatureComplete, isV2FieldAnswered, type V2PdfFieldData } from '@/lib/pdf/workshop-attachment-pdf';

function buildField(overrides: Partial<V2PdfFieldData> = {}): V2PdfFieldData {
  return {
    field_key: 'field',
    label: 'Field',
    field_type: 'text',
    is_required: false,
    response_value: 'Value',
    response_json: null,
    ...overrides,
  };
}

describe('workshop attachment PDF helpers', () => {
  it('treats empty standard responses as hidden rows', () => {
    expect(isV2FieldAnswered(buildField({ response_value: '' }))).toBe(false);
    expect(isV2FieldAnswered(buildField({ response_value: null }))).toBe(false);
    expect(isV2FieldAnswered(buildField({ response_value: 'UNLADEN' }))).toBe(true);
  });

  it('requires complete signature metadata before showing sign-off blocks', () => {
    expect(isSignatureComplete({
      data_url: 'data:image/png;base64,abc',
      signed_by_name: 'LUKE WILLIAMS',
      signed_at: '2026-04-10T16:46:00.000Z',
    })).toBe(true);

    expect(isSignatureComplete({
      data_url: '',
      signed_by_name: 'LUKE WILLIAMS',
      signed_at: '2026-04-10T16:46:00.000Z',
    })).toBe(false);
  });
});
