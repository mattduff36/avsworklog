import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

function readMigration(): string {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/20260806_permission_alignment_review_hardening.sql'
    ),
    'utf-8'
  );
}

describe('Permission alignment review hardening', () => {
  it('POLICY-CLEANUP-001: actions insert, identity locks, and broad timesheet mutations are closed', () => {
    const sql = readMigration();

    expect(sql).toContain('DROP POLICY IF EXISTS "Authenticated users can create actions"');
    expect(sql).toContain('Actions level four can create actions');
    expect(sql).toContain('Authenticated users can create constrained defect actions');
    expect(sql).toContain("action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])");
    expect(sql).toContain('prevent_message_recipient_reassignment');
    expect(sql).toContain('prevent_rams_assignment_reassignment');
    expect(sql).toContain('DROP POLICY IF EXISTS "Managers can create timesheets for any user"');
    expect(sql).toContain('DROP POLICY IF EXISTS "Managers and admins can delete any timesheet"');
  });
});
