import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('timesheet dual-gate contracts', () => {
  it('TS-RPT-001 keys payroll export off the payroll gate', () => {
    const report = read('app/api/reports/timesheets/payroll/route.ts');
    expect(report).toContain(".in('status', ['approved', 'processed'])");
    expect(report).not.toContain("candidateQuery = candidateQuery.eq('status', 'approved')");
  });

  it('requires expected_status on gate mutations', () => {
    const payrollEdit = read('lib/server/timesheet-payroll-edit.ts');
    const approve = read('lib/server/timesheet-payroll.ts');
    const gates = read('lib/server/timesheet-gate-mutations.ts');
    expect(payrollEdit).toContain('expectedStatus');
    expect(approve).toContain('input.expectedStatus && timesheet.status !== input.expectedStatus');
    expect(gates).toContain('options.expectedStatus && current.status !== options.expectedStatus');
    const payrollEditRoute = read('app/api/timesheets/[id]/payroll-edit/route.ts');
    expect(payrollEditRoute).toContain('expected_snapshot_id must be a UUID or null');
    expect(payrollEditRoute).toContain('UUID_PATTERN.test(expectedSnapshotIdRaw.trim())');
  });

  it('TS-EDIT-006 retires Adjust as a mutation path', () => {
    const route = read('app/api/timesheets/[id]/adjust/route.ts');
    expect(route).toContain('TIMESHEET_ADJUST_RETIRED_CODE');
    expect(route).not.toContain('applyTimesheetAdjustmentMutation');
  });

  it('TS-ABS-001 blocks absence hour rewrites after Payroll Received', () => {
    const impact = read('lib/utils/absence-timesheet-impact.ts');
    expect(impact).toContain("'approved'");
    expect(impact).toContain("'manager_approved'");
    expect(impact).toContain('LOCKED_TIMESHEET_STATUSES');
  });
});
