import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260924152132_contractor_role_transition.sql'
);

describe('Contractor role transition migration contract', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('defines one service-role-only atomic transition function', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.transition_profile_to_contractor');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.transition_profile_to_contractor(uuid, uuid, uuid) FROM authenticated'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.transition_profile_to_contractor(uuid, uuid, uuid) TO service_role'
    );
  });

  it('fails closed before zeroing entitlements and clearing permissions', () => {
    const conflictIndex = sql.indexOf('v_blocking_leave_count > 0');
    const evidenceIndex = sql.indexOf('TIMESHEET_EVIDENCE');
    const deleteIndex = sql.indexOf('DELETE FROM public.absences a');
    const profileUpdateIndex = sql.indexOf('UPDATE public.profiles');

    expect(conflictIndex).toBeGreaterThan(0);
    expect(evidenceIndex).toBeGreaterThan(conflictIndex);
    expect(deleteIndex).toBeGreaterThan(evidenceIndex);
    expect(profileUpdateIndex).toBeGreaterThan(deleteIndex);
  });

  it('preserves closed years and limits deletion to future generated or bulk Annual Leave', () => {
    expect(sql).toContain('NOT public.absence_is_closed_financial_year(a.date)');
    expect(sql).toContain('a.date > CURRENT_DATE');
    expect(sql).toContain('COALESCE(a.auto_generated, false) AND COALESCE(a.is_bank_holiday, false)');
    expect(sql).toContain('a.bulk_batch_id IS NOT NULL');
    expect(sql).toContain('timesheet_entry_leave_snapshots');
    expect(sql).toContain('timesheet_bank_holiday_work_confirmations');
  });

  it('database-enforces the dedicated role path and serializes snapshot evidence', () => {
    expect(sql).toContain('trg_guard_contractor_role_identity');
    expect(sql).toContain('The canonical Contractor role identity cannot be renamed or reassigned');
    expect(sql).toContain('trg_guard_contractor_role_transition');
    expect(sql).toContain("current_setting('app.contractor_role_transition', true)");
    expect(sql).toContain('trg_guard_leave_snapshot_absence_exists');
    expect(sql).toContain('FOR KEY SHARE');
  });
});
