import type { AbsenceStatusFilter, TimesheetStatusFilter } from '@/types/common';
import type { TimesheetStatus } from '@/types/timesheet';
import type { AbsenceSecondaryRoleTier } from '@/types/absence-permissions';
import { getApprovalsTimesheetStatuses as mapApprovalsTimesheetStatuses } from '@/lib/utils/timesheet-status-display';

export interface ApprovalsDefaultStatusFilters {
  timesheets: TimesheetStatusFilter;
  absences: AbsenceStatusFilter;
}

export function isAccountsTeam(teamName: string | null | undefined): boolean {
  return (teamName || '').trim().toLowerCase() === 'accounts';
}

export function getApprovalsDefaultStatusFilters(
  teamName: string | null | undefined
): ApprovalsDefaultStatusFilters {
  if (isAccountsTeam(teamName)) {
    return {
      timesheets: 'awaiting_payroll',
      absences: 'approved',
    };
  }

  return {
    timesheets: 'awaiting_manager',
    absences: 'pending',
  };
}

export function shouldIncludeTimesheetInAllSubmittedFilter(status: string): boolean {
  return status.trim().toLowerCase() !== 'draft';
}

export function canLoadApprovalsFilterDirectory(
  canViewApprovals: boolean,
  roleTier: AbsenceSecondaryRoleTier | null | undefined
): boolean {
  return Boolean(
    canViewApprovals &&
    roleTier &&
    roleTier !== 'employee'
  );
}

export function getApprovalsTimesheetStatuses(
  filter: TimesheetStatusFilter
): readonly TimesheetStatus[] {
  return mapApprovalsTimesheetStatuses(filter);
}
