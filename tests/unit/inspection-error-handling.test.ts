import { describe, expect, it } from 'vitest';
import {
  getInspectionErrorMessage,
  isDuplicateInspectionError,
  isMissingDraftError,
  isPostgrestNoRowError,
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

  it('detects stale draft update misses', () => {
    expect(isMissingDraftError(new Error('Draft not found'))).toBe(true);
    expect(
      isMissingDraftError(
        new Error('This draft could not be saved. It may have been submitted, removed, or your session may have expired. Refresh and try again.')
      )
    ).toBe(true);
  });

  it('does not treat unrelated missing data as a stale draft', () => {
    expect(isMissingDraftError(new Error('Plant not found'))).toBe(false);
  });

  it('maps PostgREST coerce / PGRST116 write misses to a user-facing save message', () => {
    const coerceError = {
      code: 'PGRST116',
      details: 'The result contains 0 rows',
      message: 'Cannot coerce the result to a single JSON object',
    };

    expect(isPostgrestNoRowError(coerceError)).toBe(true);
    expect(isMissingDraftError(coerceError)).toBe(true);
    expect(getInspectionErrorMessage(coerceError, 'Failed to save inspection')).toBe(
      'This draft could not be saved. It may have been submitted, removed, or your session may have expired. Refresh and try again.'
    );
  });

  it('treats zero-row update messages as expected draft misses', () => {
    expect(
      isMissingDraftError(
        new Error('Failed to update inspection - no rows returned. You may not have permission to edit this inspection.')
      )
    ).toBe(true);
  });
});
