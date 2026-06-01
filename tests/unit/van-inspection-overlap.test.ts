import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('van daily inspection conversion artifacts', () => {
  it('uses a single-day van PDF table instead of weekday columns', () => {
    const pdfSource = readFileSync(
      resolve(process.cwd(), 'lib/pdf/van-inspection-pdf.tsx'),
      'utf-8'
    );

    expect(pdfSource).toContain('PASS');
    expect(pdfSource).toContain('FAIL');
    expect(pdfSource).toContain('COMMENTS');
    expect(pdfSource).not.toContain('WEEK ENDING');
    expect(pdfSource).not.toContain('MON');
    expect(pdfSource).not.toContain('TUE');
    expect(pdfSource).not.toContain('WED');
  });

  it('keeps the migration action relink verification for the known Tuesday action', () => {
    const migrationSource = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260601_van_inspections_daily_split.sql'),
      'utf-8'
    );

    expect(migrationSource).toContain('1579a56c-2baa-4168-a59e-3e921a78588c');
    expect(migrationSource).toContain('e26747ef-1ef0-4fef-a6f9-4e6810f9d058');
    expect(migrationSource).toContain('original_day_of_week = 2');
  });
});
