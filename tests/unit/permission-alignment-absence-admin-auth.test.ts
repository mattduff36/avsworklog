import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf-8');
}

describe('Permission alignment absence and admin auth hardening', () => {
  it('RLS-ABSENCE-NO-SELF-001 blocks self-approve and drops legacy global manage', () => {
    const sql = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_absence_and_admin_auth.sql'
    );
    const matrix = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_absence_status_matrix.sql'
    );

    expect(sql).toContain('DROP POLICY IF EXISTS "Admins can manage all absences"');
    expect(sql).toContain("status = ANY (ARRAY['pending'::text, 'cancelled'::text])");
    expect(sql).toContain('enforce_absence_status_transition_auth');
    expect(sql).toContain('can_actor_approve_absence_request');
    expect(matrix).toContain("NEW.status = ANY (ARRAY['approved'::text, 'rejected'::text])");
    expect(matrix).toContain("OLD.status = 'approved'");
    expect(matrix).toContain("NEW.status = 'processed'");
    expect(matrix).toContain('Unsupported absence status transition');
    expect(matrix).toContain('can_actor_approve_absence_request');
    expect(matrix).toContain('can_actor_edit_absence_request');
    expect(matrix.indexOf('can_actor_approve_absence_request')).toBeGreaterThan(
      matrix.indexOf("NEW.status = ANY (ARRAY['approved'::text, 'rejected'::text])")
    );
  });

  it('TS-FD-001 writes reject notifications in the gate transaction and does not mutate via Adjust', () => {
    const reject = readProjectFile('app/api/timesheets/[id]/reject/route.ts');
    const adjust = readProjectFile('app/api/timesheets/[id]/adjust/route.ts');
    const gates = readProjectFile('lib/server/timesheet-gate-mutations.ts');

    expect(reject).toContain('applyTimesheetReject');
    expect(reject).not.toMatch(/\.from\('messages'\)/);
    expect(reject).not.toMatch(/const db = supabase/);
    expect(adjust).toContain('TIMESHEET_ADJUST_RETIRED_CODE');
    expect(adjust).not.toMatch(/\.from\('messages'\)/);
    expect(adjust).not.toContain('applyTimesheetAdjustmentMutation');
    expect(gates).toContain('INSERT INTO public.messages');
    expect(gates).toContain('INSERT INTO public.message_recipients');
    expect(gates).toContain("'timesheet_gate'");
  });

  it('APPROVAL-ADMIN-GLOBAL-001 keeps admin-tier override in SQL and server scope', () => {
    const sql = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_absence_and_admin_auth.sql'
    );
    const scope = readProjectFile('lib/server/timesheet-approval-scope.ts');

    expect(sql).toContain('effective_has_admin_full_access');
    expect(sql).toContain('IF public.effective_has_admin_full_access() THEN');
    expect(scope).toContain('hasEffectiveRoleFullAccess(effectiveRole)');
  });

  it('RLS-POLICY-001 locks absence ownership against pivot self-approval', () => {
    const sql = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_absence_profile_lock.sql'
    );

    expect(sql).toContain('prevent_absence_profile_reassignment');
    expect(sql).toContain('absences.profile_id is immutable for authenticated updates');
    expect(sql).toContain('owner_id UUID := OLD.profile_id');
    expect(sql).toContain('can_actor_approve_absence_request(actor_id, owner_id)');
  });
});
