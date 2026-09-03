import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('timesheet dual-gate migration contract', () => {
  it('TS-MIG-001 ships the status-gate CHECK and backfill proof query', () => {
    const sql = read('supabase/migrations/20260903_timesheet_dual_gate_approval.sql');
    expect(sql).toContain('timesheets_status_gate_check');
    expect(sql).toContain("'manager_approved'");
    expect(sql).toContain('timesheet_payroll_edits');
    expect(sql).toContain('mismatch_count');
    expect(sql).toContain("RAISE EXCEPTION 'timesheet gate backfill mismatch");
    expect(sql).toContain("timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])");
    expect(sql).toContain("IF parent_status IN ('approved', 'processed', 'adjusted') THEN");
    expect(sql).toContain('request_fingerprint');
    expect(sql).toContain("app.timesheet_payroll_edit");
    expect(sql).toContain('guard_timesheet_payroll_approval');
  });

  it('TS-RLS-001 locks owner and authoriser entry writes to draft/rejected', () => {
    const sql = read('supabase/migrations/20260903_timesheet_dual_gate_approval.sql');
    expect(sql).toContain('Users can delete own timesheet entries');
    expect(sql).toContain("timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])");
    expect(sql).toContain('Timesheet authorisers can update draft entries');
    expect(sql).toContain("AND cmd IN ('INSERT', 'UPDATE', 'DELETE')");
    expect(sql).toContain('effective_is_manager_admin');
  });

  it('TS-ARCH-ROLLBACK-001 restores approved-only entry locks and refuses to drop audit rows', () => {
    const sql = read('supabase/rollback/20260903_timesheet_dual_gate_approval.sql');
    expect(sql).toContain("IF parent_status = 'approved' THEN");
    expect(sql).toContain('do not drop payroll-edit audit history');
    expect(sql).toContain('Users can update own timesheets');
    expect(sql).toContain("Payroll snapshot pointer can only change during approval");
    expect(sql).toContain("IF NEW.status IN ('approved', 'processed', 'adjusted') AND NOT v_snapshot_valid THEN");
  });
});
