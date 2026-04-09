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
          message: 'duplicate key value violates unique constraint "idx_unique_plant_inspection_user_date"',
        },
        'fallback'
      )
    ).toBe('duplicate key value violates unique constraint "idx_unique_plant_inspection_user_date"');
  });

  it('detects duplicate constraint errors from object codes', () => {
    expect(
      isDuplicateInspectionError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_unique_hgv_inspection_user_date"',
      })
    ).toBe(true);
  });

  it('detects duplicate constraint errors from updated index names without codes', () => {
    expect(
      isDuplicateInspectionError({
        message: 'duplicate key value violates unique constraint "idx_unique_plant_inspection_user_date"',
      })
    ).toBe(true);
  });

  it('does not classify unrelated errors as duplicate conflicts', () => {
    expect(isDuplicateInspectionError(new Error('new row violates row-level security policy'))).toBe(false);
  });
});
