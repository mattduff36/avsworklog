import { describe, expect, it } from 'vitest';
import {
  getSignatureTimestampText,
  isSignatureComplete,
  isV2FieldAnswered,
  type V2PdfFieldData,
} from '@/lib/pdf/workshop-attachment-pdf';

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

  it('shows the original signature timestamp with time when no override exists', () => {
    const result = getSignatureTimestampText({
      signatureAt: '2026-04-10T15:45:00.000Z',
    });

    expect(result).toContain('April 10th, 2026');
    expect(result).toMatch(/\d{1,2}:\d{2} [AP]M/);
  });

  it('shows the adjusted completed date without time when overridden', () => {
    expect(getSignatureTimestampText({
      signatureAt: '2026-04-10T15:45:00.000Z',
      signatureTimestampOverride: '2026-04-07T08:35:00.000Z',
      signatureTimestampOverrideDateOnly: true,
    })).toBe('April 7th, 2026');
  });
});
