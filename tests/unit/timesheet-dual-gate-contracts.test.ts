import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getApprovalsDefaultStatusFilters } from '@/lib/utils/approvals-filters';
import { getApprovalsTimesheetStatuses } from '@/lib/utils/timesheet-status-display';

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

  it('TS-DG-QUEUE-001 dashboard tiles follow the dual-gate default queues', () => {
    expect(getApprovalsTimesheetStatuses(getApprovalsDefaultStatusFilters('Accounts').timesheets)).toEqual([
      'submitted',
      'manager_approved',
    ]);
    expect(getApprovalsTimesheetStatuses(getApprovalsDefaultStatusFilters('Operations').timesheets)).toEqual([
      'submitted',
      'approved',
    ]);
    const dashboard = read('lib/server/dashboard-approvals.ts');
    expect(dashboard).toContain('getApprovalsTimesheetStatuses');
    expect(dashboard).toContain('getApprovalsDefaultStatusFilters');
    expect(dashboard).toContain('timesheetStatuses: getApprovalsTimesheetStatuses(defaultFilters.timesheets)');
    expect(dashboard).not.toContain("defaultFilters.timesheets === 'approved' ? 'approved' : 'submitted'");
  });

  it('TS-DG-ADMIN-001 payroll-admin unapproved impact includes manager-first sheets', () => {
    const admin = read('lib/server/payroll-admin.ts');
    expect(admin).toContain("['draft', 'submitted', 'rejected', 'adjusted', 'manager_approved']");
    expect(admin).not.toContain(".in('status', ['draft', 'submitted', 'rejected', 'adjusted'])");
  });

  it('TS-DG-PDF-001 list PDF download includes manager-approved sheets', () => {
    const page = read('app/(dashboard)/timesheets/page.tsx');
    const table = read('app/(dashboard)/timesheets/components/TimesheetsListTable.tsx');
    expect(page).toContain("timesheet.status === 'manager_approved'");
    expect(table).toContain("'manager_approved'");
  });

  it('TS-DG-HISTORY-001 keeps snapshotless unsafe-history on payroll-received statuses', () => {
    const admin = read('lib/server/payroll-admin.ts');
    expect(admin).toContain("status IN ('approved', 'processed', 'adjusted')");
    expect(admin).not.toContain("status IN ('approved', 'processed', 'adjusted', 'manager_approved')");
  });

  it('TS-ABS-001 blocks absence hour rewrites after Payroll Received', () => {
    const impact = read('lib/utils/absence-timesheet-impact.ts');
    expect(impact).toContain("'approved'");
    expect(impact).toContain("'manager_approved'");
    expect(impact).toContain('LOCKED_TIMESHEET_STATUSES');
  });
});
