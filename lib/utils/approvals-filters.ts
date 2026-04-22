import type { AbsenceStatusFilter, TimesheetStatusFilter } from '@/types/common';

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
      timesheets: 'pending',
      absences: 'approved',
    };
  }

  return {
    timesheets: 'approved',
    absences: 'pending',
  };
}

export function shouldIncludeTimesheetInAllSubmittedFilter(status: string): boolean {
  return status.trim().toLowerCase() !== 'draft';
}
