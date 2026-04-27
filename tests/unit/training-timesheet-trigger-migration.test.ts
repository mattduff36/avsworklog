import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('training timesheet trigger migration', () => {
  it('excludes Training from full-day absence coercion while keeping leave coercion', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260427_exclude_training_from_timesheet_absence_coercion.sql'),
      'utf-8'
    ).toLowerCase();

    expect(sql).toContain("a.status in ('approved', 'processed')");
    expect(sql).toContain("coalesce(a.is_half_day, false) = false");
    expect(sql).toContain("lower(trim(ar.name)) <> 'training'");
    expect(sql).toContain('new.did_not_work := true');
  });
});
