import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('timesheet submit contracts', () => {
  it('TS-SAVE-004 ROLLBACK-001 keeps submitted entry writes RLS-blocked and has no owner-create rollback script', () => {
    const dualGate = read('supabase/migrations/20260903_timesheet_dual_gate_approval.sql');
    expect(dualGate).toContain('Users can insert own timesheet entries');
    expect(dualGate).toContain("timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])");
    expect(dualGate).not.toContain("timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text, 'submitted'::text])");

    const hardening = read('supabase/migrations/20260904_timesheet_owner_create_draft_only.sql');
    expect(hardening).toContain('Users can create own timesheets');
    expect(hardening).toContain("status = ANY (ARRAY['draft'::text, 'rejected'::text])");
    expect(hardening).not.toContain("'submitted'");
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'supabase/rollback/20260904_timesheet_owner_create_draft_only.sql')
      )
    ).toBe(false);
  });

  it('TS-SAVE-007 live Plant submit uses the shared submit API', () => {
    const plant = read('app/(dashboard)/timesheets/types/plant/PlantTimesheetV2Aligned.tsx');
    const civils = read('app/(dashboard)/timesheets/types/civils/CivilsTimesheet.tsx');
    expect(plant).toContain("from '@/lib/client/timesheet-submit'");
    expect(plant).toContain('submitTimesheet(');
    expect(plant).toContain("timesheetType: 'plant'");
    expect(civils).toContain("from '@/lib/client/timesheet-submit'");
    expect(civils).toContain('submitTimesheet(');
  });

  it('submit route binds app-session identity and stable 400 JSON errors', () => {
    const route = read('app/api/timesheets/submit/route.ts');
    expect(route).toContain('validateAppSession');
    expect(route).toContain('getAppAuthProfile');
    expect(route).toContain('applyValidationCookieIfNeeded');
    expect(route).not.toContain('getCurrentAuthenticatedProfile');
    expect(route).toContain('await request.json()');
    expect(route).toContain("code: 'INVALID_INPUT'");
  });

  it('TS-SAVE-008 details-page submit uses the same API', () => {
    const details = read('app/(dashboard)/timesheets/[id]/page.tsx');
    expect(details).toContain("from '@/lib/client/timesheet-submit'");
    expect(details).toContain('submitTimesheet(');
    expect(details).not.toContain('.from(\'timesheets\')\n        .update({\n          status: \'submitted\'');
  });
});
