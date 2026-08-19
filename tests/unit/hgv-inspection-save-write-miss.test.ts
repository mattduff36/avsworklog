import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('HGV inspection save write-miss handling', () => {
  const source = readFileSync(
    resolve(__dirname, '../../app/(dashboard)/hgv-inspections/new/page.tsx'),
    'utf-8'
  );

  it('updates existing drafts with maybeSingle instead of coercing a single row', () => {
    expect(source).toContain(".eq('status', 'draft')");
    expect(source).toContain('.maybeSingle()');
    expect(source).toContain('getInspectionErrorMessage');
    expect(source).toContain('isMissingDraftError');
    expect(source).not.toContain('.single()');
  });

  it('does not log expected draft write misses as console errors', () => {
    expect(source).toContain("console.warn('HGV inspection save skipped because the draft could not be updated'");
  });
});
