import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { resolveReportScopeAccess } from '@/lib/server/report-scope';

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Permission Alignment Phase 4', () => {
  it('REPORT-SCOPE-001 maps Reports Level 3/4/5 to own/team/global independently of role', () => {
    const statsRoute = readProjectFile('app/api/reports/stats/route.ts');
    expect(statsRoute).toContain('getTimesheetReportScopedProfileIds');
    expect(statsRoute).toContain(".in('user_id', scopedIds)");
    expect(statsRoute).toContain(".in('id', scopedIds)");

    expect(
      resolveReportScopeAccess({
        reportAccessLevel: 3,
        hasFullAccessRole: false,
        hasAccountsVisibilityOverride: false,
      })
    ).toEqual({
      isAdminTier: false,
      isManagerLike: false,
      shouldScopeToTeam: false,
    });
    expect(
      resolveReportScopeAccess({
        reportAccessLevel: 4,
        hasFullAccessRole: false,
        hasAccountsVisibilityOverride: false,
      })
    ).toEqual({
      isAdminTier: false,
      isManagerLike: true,
      shouldScopeToTeam: true,
    });
    expect(
      resolveReportScopeAccess({
        reportAccessLevel: 5,
        hasFullAccessRole: false,
        hasAccountsVisibilityOverride: false,
      })
    ).toEqual({
      isAdminTier: true,
      isManagerLike: true,
      shouldScopeToTeam: false,
    });
  });

  it('SHIFT-SCOPE-001 installs own/team/all secondary-aware work-shift SELECT', () => {
    const migration = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_approvals_supervisor_and_scopes.sql'
    );

    expect(migration).toContain('can_actor_view_employee_work_shift');
    expect(migration).toContain('see_manage_work_shifts_all');
    expect(migration).toContain('see_manage_work_shifts_team');
    expect(migration).toContain('are_effective_actor_and_target_in_same_team');
    expect(migration).toContain('Absence scoped work shift viewers');
    expect(migration).toContain('auth.uid() = target_profile_id');
  });

  it('APPROVAL-MIN-001 and CHILD-SCOPE-001 enforce Level 3 and parent visibility', () => {
    const migration = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_approvals_supervisor_and_scopes.sql'
    );
    const accessRules = readProjectFile('lib/config/permission-access-rules.ts');

    expect(accessRules).toContain('approvals: 3');
    expect(migration).toContain("WHEN 'approvals' THEN 3");
    expect(migration).toContain("effective_module_access_level('approvals') < 3");
    expect(migration).toContain('can_actor_view_timesheet_entry(timesheet_id)');
    expect(migration).toContain('FROM public.timesheets t');
    expect(migration).toContain(
      'can_actor_view_timesheet_entry_job_codes(timesheet_entry_id)'
    );
  });

  it('SECONDARY-PARITY-001 derives SQL secondary defaults from Absence access level', () => {
    const migration = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_approvals_supervisor_and_scopes.sql'
    );

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.absence_secondary_role_tier');
    expect(migration).toContain("effective_module_access_level('absence')");
    expect(migration).toContain('user_module_access_level');
    expect(migration).toContain('absence_level >= 3');
  });

  it('VIEW-AS-001 uses effective role/team and ignores actual-user overrides', () => {
    const migration = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_approvals_supervisor_and_scopes.sql'
    );
    const serverScope = readProjectFile('lib/server/timesheet-approval-scope.ts');

    expect(migration).toContain('permission_alignment_effective_module_access_level');
    expect(migration).toContain('role_on_team_module_access_level');
    expect(migration).toContain('permission_alignment_absence_secondary_effective_cell');
    expect(migration).toContain('are_effective_actor_and_target_in_same_team');
    expect(serverScope).toContain('role_id: effectiveRole.role_id');
    expect(serverScope).toContain('include_user_overrides: effectiveRole.is_viewing_as !== true');
    expect(serverScope).toContain('include_secondary_overrides: effectiveRole.is_viewing_as !== true');
  });

  it('POLICY-CLEANUP-001 removes broad manager SELECT and UPDATE policies', () => {
    const migration = readProjectFile(
      'supabase/migrations/20260806_permission_alignment_approvals_supervisor_and_scopes.sql'
    );

    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers can view all timesheets" ON public.timesheets'
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers can update timesheets" ON public.timesheets'
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers can view all timesheet entries" ON public.timesheet_entries'
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers can update all entries" ON public.timesheet_entries'
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers can update any timesheet entry job codes" ON public.timesheet_entry_job_codes'
    );
  });

  it('ROUTE-AUTH-001 keeps mutation routes independent from Reports scope', () => {
    const authorisingRoutePaths = [
      'app/api/timesheets/[id]/approve/route.ts',
      'app/api/timesheets/[id]/reject/route.ts',
      'app/api/timesheets/[id]/process/route.ts',
      'app/api/timesheets/[id]/payroll-edit/route.ts',
      'app/api/timesheets/payroll-preview/route.ts',
    ];

    for (const path of authorisingRoutePaths) {
      const route = readProjectFile(path);
      if (path.endsWith('process/route.ts')) {
        expect(route).toContain('canCurrentActorMarkTimesheetManagerApproved');
      } else {
        expect(route).toContain('canCurrentActorAuthoriseTimesheetTarget');
      }
      expect(route).not.toContain('filterTimesheetRowsForReportScope');
    }

    const retiredAdjust = readProjectFile('app/api/timesheets/[id]/adjust/route.ts');
    expect(retiredAdjust).toContain('TIMESHEET_ADJUST_RETIRED_CODE');
    expect(retiredAdjust).not.toContain('filterTimesheetRowsForReportScope');
    expect(retiredAdjust).not.toContain('applyTimesheetAdjustmentMutation');
  });

  it('APPROVAL-CONSUMER-001 applies the no-self decision in UI and dashboard metrics', () => {
    const approvalsPage = readProjectFile('app/(dashboard)/approvals/page.tsx');
    const dashboardApprovals = readProjectFile('lib/server/dashboard-approvals.ts');

    expect(approvalsPage).toContain('canActorAuthoriseTimesheetTarget');
    expect(approvalsPage).toContain('profileId: timesheet.user_id');
    expect(approvalsPage).toContain('hasAccountsOverride: hasAccountsVisibilityOverride || isAdminTier');
    expect(dashboardApprovals).toContain('canActorAuthoriseTimesheetTarget');
    expect(dashboardApprovals).toContain('profileId: row.user_id');
    expect(dashboardApprovals).toContain('hasAccountsOverride: hasAccountsVisibilityOverride || isAdminTier');
    expect(dashboardApprovals).toContain('include_user_overrides: effectiveRole.is_viewing_as !== true');
    expect(dashboardApprovals).toContain('include_secondary_overrides: effectiveRole.is_viewing_as !== true');
  });

  it('REPORT-DATA-001 scopes IDs before service-role report hydration', () => {
    const reportRoutes = [
      'app/api/reports/timesheets/summary/route.ts',
      'app/api/reports/timesheets/payroll/route.ts',
    ];

    for (const path of reportRoutes) {
      const route = readProjectFile(path);
      expect(route).toContain('getTimesheetReportScopedProfileIds');
      expect(route).toContain('const admin = createAdminClient()');
      expect(route).toContain("Array.from(scopedProfileIds)");
      expect(route).toContain('loadEmployeeWorkShiftPatternMap');
      expect(route).toContain('admin,');
    }
  });
});
