import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { calculatePayrollWeek } from '@/lib/payroll/calculate';
import { calculateLegacyPayroll } from '@/lib/payroll/legacy';
import { getSignedPayrollRule } from '@/lib/payroll/schema';
import { resolveTimesheetOffDayStates } from '@/lib/utils/timesheet-off-days';

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('payroll rollout contract', () => {
  it('TS-TYPECHECK-001 keeps the project typecheck script available', () => {
    const pkg = JSON.parse(readProjectFile('package.json')) as { scripts?: { typecheck?: string } };
    expect(pkg.scripts?.typecheck).toBe('tsc --noEmit');
  });

  it('PAY-FAIL-CLOSED-001 rejects incomplete post-cutover configuration', () => {
    const rule = getSignedPayrollRule('civils');
    delete rule.dayBands[7];
    expect(() => calculatePayrollWeek({
      weekEnding: '2026-08-09',
      rule,
      days: [],
    })).toThrow(/Day 7 is missing/);
    const excel = readProjectFile('app/api/reports/timesheets/payroll/route.ts');
    const pdf = readProjectFile('app/api/timesheets/[id]/pdf/route.ts');
    expect(excel).toContain('missingPostCutoverSnapshot');
    expect(excel).toContain('Export is blocked to protect payroll history');
    expect(pdf).toContain('PDF generation is blocked');
  });

  it('PAY-VERSION-001 returns isolated rule configuration values', () => {
    const first = getSignedPayrollRule('plant');
    first.dayBands[1].upToMinutes = 1;
    expect(getSignedPayrollRule('plant').dayBands[1].upToMinutes).toBe(480);
    const server = readProjectFile('lib/server/timesheet-payroll.ts');
    expect(server).toContain("candidate.status IN ('active', 'archived')");
    expect(server).toContain('candidate.effective_week_ending <= $3');
  });

  it('PAY-ROLLOUT-001 preserves the frozen legacy export classification', () => {
    expect(calculateLegacyPayroll([
      { dayOfWeek: 1, workedHours: 10 },
      { dayOfWeek: 6, workedHours: 8 },
      { dayOfWeek: 7, workedHours: 4, bankHoliday: true },
    ])).toEqual({
      basicHours: 10,
      overtimeHours: 8,
      doubleTimeHours: 4,
      totalHours: 22,
    });
    const report = readProjectFile('app/api/reports/timesheets/payroll/route.ts');
    expect(report).toContain(': leaveAwareTotals.weekly.display');
  });

  it('PAY-AUTH-APPROVAL-001 requires module permission, employee scope and payroll-received authority', () => {
    const route = readProjectFile('app/api/timesheets/[id]/approve/route.ts');
    expect(route).toContain('canCurrentActorAuthoriseTimesheetTarget');
    expect(route).toContain('canCurrentActorMarkTimesheetPayrollReceived');
    expect(route).not.toContain('filterTimesheetRowsForReportScope');
  });

  it('PAY-PROCESS-MANAGER-001 keeps process on authorise scope and routes the detail page through the API', () => {
    const processRoute = readProjectFile('app/api/timesheets/[id]/process/route.ts');
    const detail = readProjectFile('app/(dashboard)/timesheets/[id]/page.tsx');
    expect(processRoute).toContain('canCurrentActorAuthoriseTimesheetTarget');
    expect(processRoute).not.toContain('canCurrentActorMarkTimesheetPayrollReceived');
    expect(detail).toContain('/api/timesheets/${timesheet.id}/process');
    expect(detail).not.toContain('processed_at: new Date().toISOString()');
  });

  it('PAY-ENGINE-VERSION-002 records engine version 2 on new snapshots', () => {
    const server = readProjectFile('lib/server/timesheet-payroll.ts');
    expect(server).toContain('export const PAYROLL_ENGINE_VERSION = 2');
    expect(server).toContain('const ENGINE_VERSION = PAYROLL_ENGINE_VERSION');
  });

  it('AUTH-PAYROLL-LEVEL5-01 requires delegated Admin Settings access', () => {
    const route = readProjectFile('app/api/admin/settings/payroll-rules/route.ts');
    expect(route).toContain('requireAdminSettingsAccess');
    expect(route).not.toContain('hasEffectiveRoleFullAccess');
    const service = readProjectFile('lib/server/payroll-admin.ts');
    expect(service).toContain('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(service).toContain('must be assigned to the');
    expect(service).toContain('current_payroll_snapshot_id IS NULL');
  });

  it('PAY-REPORT-SCOPE-001 retains scoped payroll report filtering', () => {
    const route = readProjectFile('app/api/reports/timesheets/payroll/route.ts');
    expect(route).toContain('getTimesheetReportScopedProfileIds');
    expect(route).toContain("candidateQuery.in('user_id', Array.from(scopedProfileIds))");
    expect(route).toContain("canEffectiveRoleAccessModule('reports')");
    expect(route).toContain("canEffectiveRoleAccessModule('timesheets')");
  });

  it('PAY-PARITY-001 makes detail, PDF and Excel consume the current snapshot', () => {
    const detail = readProjectFile('app/(dashboard)/timesheets/[id]/page.tsx');
    const payrollApi = readProjectFile('app/api/timesheets/[id]/payroll/route.ts');
    const pdf = readProjectFile('app/api/timesheets/[id]/pdf/route.ts');
    const excel = readProjectFile('app/api/reports/timesheets/payroll/route.ts');
    const snapshotRls = readProjectFile('supabase/migrations/20260805_squires_payroll_snapshot_rls_scope.sql');
    const civils = readProjectFile('app/(dashboard)/timesheets/types/civils/CivilsTimesheet.tsx');
    const adjustApi = readProjectFile('app/api/timesheets/[id]/adjust/route.ts');
    const entryGuard = readProjectFile('supabase/migrations/20260805_squires_payroll_approved_entry_guard.sql');
    expect(detail).toContain('/api/timesheets/${id}/payroll');
    expect(detail).toContain('entries: entriesToPersist');
    expect(detail).not.toContain('allowApprovedAdjustment');
    expect(detail).toContain("!(timesheet.status === 'approved' && dataChanged)");
    expect(adjustApi).toContain('canCurrentActorAuthoriseTimesheetTarget');
    expect(adjustApi).not.toContain('filterTimesheetRowsForReportScope');
    expect(adjustApi).toContain('applyTimesheetAdjustmentMutation');
    expect(adjustApi).toContain("typedTimesheet.status === 'approved' && entries === null");
    expect(readProjectFile('lib/server/timesheet-adjust.ts')).toContain("await client.query('BEGIN')");
    expect(readProjectFile('lib/server/timesheet-adjust.ts')).toContain("await client.query('COMMIT')");
    expect(readProjectFile('lib/server/timesheet-adjust.ts')).toContain("await client.query('ROLLBACK')");
    expect(payrollApi).toContain('filterTimesheetRowsForReportScope');
    expect(pdf).toContain("createAdminClient");
    expect(excel).toContain("createAdminClient");
    expect(excel.indexOf('getTimesheetReportScopedProfileIds')).toBeLessThan(
      excel.indexOf('const admin = createAdminClient()')
    );
    expect(excel.indexOf('const admin = createAdminClient()')).toBeLessThan(
      excel.indexOf('current_payroll_snapshot:timesheet_payroll_snapshots')
    );
    expect(adjustApi).toContain("typedTimesheet.status !== 'adjusted'");
    expect(entryGuard).toContain('reject_approved_timesheet_entry_mutation');
    expect(snapshotRls).toContain('payroll_is_full_admin()');
    expect(snapshotRls).not.toContain('effective_is_manager_admin()');
    expect(civils).toContain('bankHolidays.size === 0');
    expect(pdf).toContain('current_payroll_snapshot');
    expect(excel).toContain('current_payroll_snapshot');
    expect(pdf).toContain('payrollSnapshot');
    expect(pdf).toContain('previewTimesheetPayroll');
    expect(pdf).toContain('loadEmployeeWorkShiftPatternMap');
    expect(pdf).toContain('resolveTimesheetOffDayStates');
    expect(excel).toContain('snapshot.basic_minutes');
    expect(excel).toContain("'Basic Hours'");
    expect(excel).toContain("'Double Time Hours'");
    expect(detail).toContain("'Re-mark Payroll Received' : 'Payroll Received'");
  });

  it('PAY-ASSIGNMENT-001 supports effective-dated profile override retirement', () => {
    const server = readProjectFile('lib/server/timesheet-payroll.ts');
    const admin = readProjectFile('lib/server/payroll-admin.ts');
    const ui = readProjectFile('app/(dashboard)/admin/settings/components/PayrollRulesSettingsCard.tsx');
    expect(server).toContain('FROM profile_assignment WHERE is_active');
    expect(admin).toContain('VALUES ($1, NULL, false, $2, $3)');
    expect(ui).toContain("value={assignment?.ruleSetKey || 'none'}");
    expect(ui).toContain('<SelectItem value="none">Use team rule</SelectItem>');
    expect(ui).toContain('Save employee overrides');
    expect(readProjectFile('app/api/admin/settings/payroll-rules/route.ts')).toContain(
      "action === 'save_profile_assignment'"
    );
  });

  it('PAY-MIGRATION-001 is rerunnable after activation and protects snapshot pointers', () => {
    const sql = readProjectFile('supabase/migrations/20260805_squires_payroll_rules.sql');
    expect(sql).toContain('WHERE NOT EXISTS (');
    expect(sql).toContain('Payroll snapshot pointer can only change during approval');
    expect(sql).toContain('Reapproval must append a snapshot revision');
    expect(sql).toContain("NEW.status = 'archived'");
  });

  it('PAY-LEAVE-001 excludes training and non-shift days while retaining paid/unpaid day units', () => {
    const saturdayWorkingPattern = {
      monday_am: true,
      monday_pm: true,
      tuesday_am: true,
      tuesday_pm: true,
      wednesday_am: true,
      wednesday_pm: true,
      thursday_am: true,
      thursday_pm: true,
      friday_am: true,
      friday_pm: true,
      saturday_am: true,
      saturday_pm: true,
      sunday_am: false,
      sunday_pm: false,
    };
    const states = resolveTimesheetOffDayStates('2026-08-09', [
      {
        date: '2026-08-03',
        end_date: null,
        status: 'approved',
        absence_reasons: { name: 'Annual Leave', is_paid: true },
      },
      {
        date: '2026-08-04',
        end_date: null,
        status: 'approved',
        is_half_day: true,
        half_day_session: 'AM',
        absence_reasons: { name: 'Sickness', is_paid: false },
      },
      {
        date: '2026-08-05',
        end_date: null,
        status: 'approved',
        absence_reasons: { name: 'Training', is_paid: true },
      },
      {
        date: '2026-08-08',
        end_date: null,
        status: 'approved',
        absence_reasons: { name: 'Annual Leave', is_paid: true },
      },
    ], saturdayWorkingPattern);

    expect(states[0]).toMatchObject({ paidLeaveUnits: 1, unpaidLeaveUnits: 0 });
    expect(states[1]).toMatchObject({ paidLeaveUnits: 0, unpaidLeaveUnits: 0.5 });
    expect(states[2]).toMatchObject({ paidLeaveUnits: 0, unpaidLeaveUnits: 0 });
    expect(states[5]).toMatchObject({ paidLeaveUnits: 1, unpaidLeaveUnits: 0 });
  });

  it('PAY-OVERRIDE-SAVE-001 and PAY-OVERRIDE-TXN-001 write one profile assignment per save and never touch versions, teams or rollout', () => {
    const admin = readProjectFile('lib/server/payroll-admin.ts');
    const saveFn = admin.slice(admin.indexOf('export async function savePayrollProfileAssignment'));
    expect(saveFn).toContain('INSERT INTO public.payroll_profile_rule_assignments');
    expect(saveFn).not.toContain('payroll_rule_versions');
    expect(saveFn).not.toContain('payroll_team_rule_assignments');
    expect(saveFn).not.toContain('payroll_rollout_activations');
    expect(saveFn).toContain('PayrollAssignmentConflictError');
    expect(saveFn).toContain('validatePayrollProfileAssignmentInput');
    expect(saveFn).toContain('decidePayrollAssignmentWrite');
    expect(readProjectFile('lib/payroll/calculate.ts')).toContain("week.rule.key !== 'lorries'");
    expect(readProjectFile('app/(dashboard)/admin/settings/components/PayrollRulesSettingsCard.tsx')).toContain(
      'Each employee is saved separately'
    );
    const civils = readProjectFile('app/(dashboard)/timesheets/types/civils/CivilsTimesheet.tsx');
    const plant = readProjectFile('app/(dashboard)/timesheets/types/plant/PlantTimesheetV2Aligned.tsx');
    expect(civils).toContain('resolvePersistedNightShiftFlag');
    expect(plant).toContain('resolvePersistedNightShiftFlag');
    expect(civils).not.toContain(
      'entry.night_shift || isOvernightShift(entry.time_started, entry.time_finished)'
    );
  });

  it('PAY-OVERRIDE-RESOLVE-001 keeps profile overrides ahead of team and Civils fallback', () => {
    const server = readProjectFile('lib/server/timesheet-payroll.ts');
    expect(server).toContain('FROM profile_assignment WHERE is_active');
    expect(server).toContain("WHEN EXISTS (SELECT 1 FROM profile_assignment WHERE is_active) THEN 'profile'");
    expect(server).toContain("rule_key = 'civils'");
  });

  it('PAY-PDF-JOB-YARD-001 and PAY-PDF-REMARKS-001 move generic PDF jobs out of remarks', () => {
    const generic = readProjectFile('lib/pdf/timesheet-pdf.tsx');
    const plant = readProjectFile('lib/pdf/plant-timesheet-v2-pdf.tsx');
    expect(generic).toContain('Job number');
    expect(generic).toContain('/ Yard');
    expect(generic).toContain('formatJobNumberOrYard');
    expect(readProjectFile('lib/pdf/timesheet-pdf-cells.ts')).toContain('export function formatJobNumberOrYard');
    expect(generic).not.toContain('Working{\'\\n\'}in Yard');
    expect(generic).not.toContain('Job number${formattedJobNumbers.includes(\',\') ? \'s\' : \'\'}');
    expect(plant).toContain('Job numbers ${jobNumbers}');
    expect(plant).not.toContain('Job number / Yard');
  });
});
