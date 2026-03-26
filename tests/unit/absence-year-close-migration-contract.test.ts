import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

function readMigration(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('absence year-close migration contract', () => {
  it('contains close-year pending guard and carryover recalculation trigger', () => {
    const sql = readMigration('supabase/migrations/20260326_absence_year_closure_carryover_flow.sql');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION close_absence_financial_year_bookings');
    expect(sql).toContain('IF NOT effective_is_manager_admin() THEN');
    expect(sql).toContain('Only managers or admins can close a financial year.');
    expect(sql).toContain("Current year still has pending bookings. Accept or decline these first.");
    expect(sql).toContain("COALESCE(p.full_name, '') NOT ILIKE '%(Deleted User)%'");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION recalculate_financial_year_carryover_for_profile');
    expect(sql).toContain('CREATE TRIGGER trg_recalculate_closed_year_carryover');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON absences');
  });

  it('allows negative carryovers by removing non-negative constraint', () => {
    const sql = readMigration('supabase/migrations/20260326_absence_year_closure_carryover_flow.sql');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS absence_allowance_carryovers_non_negative');
  });

  it('contains undo-close snapshot and restore safeguards', () => {
    const sql = readMigration('supabase/migrations/20260327_absence_year_undo_close_flow.sql');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS absence_financial_year_close_snapshots');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS absence_financial_year_close_snapshot_rows');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION snapshot_financial_year_carryovers_before_close');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION get_latest_absence_close_undo_status');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION undo_close_absence_financial_year_bookings');
    expect(sql).toContain("COALESCE(p.full_name, '') NOT ILIKE '%(Deleted User)%'");
    expect(sql).toContain('IF NOT effective_is_admin() THEN');
    expect(sql).toContain('Only admins can undo a closed financial year.');
    expect(sql).toContain('Cannot undo close because this financial year has already ended.');
    expect(sql).toContain('Cannot undo close because no pre-close snapshot exists for this year.');
    expect(sql).toContain('Cannot undo close because archive data already exists for this year.');
  });
});
