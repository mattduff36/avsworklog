import type { AbsenceStatusFilter, TimesheetStatusFilter } from '@/types/common';
import type { Timesheet } from '@/types/timesheet';

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

const APPROVALS_TIMESHEET_STATUS_MAP: Record<TimesheetStatusFilter, readonly Timesheet['status'][]> = {
  all: ['submitted', 'approved', 'rejected', 'processed', 'adjusted'],
  draft: ['draft'],
  pending: ['submitted'],
  approved: ['approved'],
  rejected: ['rejected'],
  processed: ['processed'],
  adjusted: ['adjusted'],
};

export function getApprovalsTimesheetStatuses(filter: TimesheetStatusFilter): readonly Timesheet['status'][] {
  return APPROVALS_TIMESHEET_STATUS_MAP[filter];
}
