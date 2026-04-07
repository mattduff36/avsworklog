import { describe, expect, it } from 'vitest';
import {
  getInspectionErrorMessage,
  isDuplicateInspectionError,
} from '@/lib/utils/inspection-error-handling';

describe('inspection-error-handling', () => {
  it('extracts messages from plain Supabase-style error objects', () => {
    expect(
      getInspectionErrorMessage(
        {
          code: '23505',
          message: 'duplicate key value violates unique constraint "van_inspections_vehicle_week_key"',
        },
        'fallback'
      )
    ).toBe('duplicate key value violates unique constraint "van_inspections_vehicle_week_key"');
  });

  it('detects duplicate constraint errors from object codes', () => {
    expect(
      isDuplicateInspectionError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "van_inspections_vehicle_week_key"',
      })
    ).toBe(true);
  });

  it('does not classify unrelated errors as duplicate conflicts', () => {
    expect(isDuplicateInspectionError(new Error('new row violates row-level security policy'))).toBe(false);
  });
});
