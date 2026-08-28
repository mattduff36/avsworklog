import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('HGV inspection save write-miss handling', () => {
  const source = readFileSync(
    resolve(__dirname, '../../app/(dashboard)/hgv-inspections/new/page.tsx'),
    'utf-8'
  );

  it('saves through the authenticated API instead of browser item writes', () => {
    expect(source).toContain('requestHgvInspectionSave');
    expect(
      readFileSync(resolve(__dirname, '../../lib/client/hgv-inspection-save.ts'), 'utf-8')
    ).toContain('/api/hgv-inspections/save');
    expect(source).toContain('getInspectionErrorMessage');
    expect(source).toContain('isMissingDraftError');
    expect(source).not.toMatch(/from\('inspection_items'\)[\s\S]{0,120}\.(insert|delete)\(/u);
  });
});
