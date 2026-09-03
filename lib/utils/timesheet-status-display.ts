import type { TimesheetStatus } from '@/types/timesheet';
import type { TimesheetStatusFilter } from '@/types/common';
import {
  formatTimesheetStatusLabel,
  hasManagerApprovedGate,
  hasPayrollReceivedGate,
} from '@/lib/utils/timesheet-gates';

export function getTimesheetStatusLabel(status: string): string {
  return formatTimesheetStatusLabel(status);
}

export function timesheetHasPayrollReceivedChip(status: string): boolean {
  return hasPayrollReceivedGate(status);
}

export function timesheetHasManagerApprovedChip(status: string): boolean {
  return hasManagerApprovedGate(status);
}

export function getApprovalsTimesheetStatuses(
  filter: TimesheetStatusFilter
): readonly TimesheetStatus[] {
  const map: Record<TimesheetStatusFilter, readonly TimesheetStatus[]> = {
    all: ['submitted', 'approved', 'rejected', 'processed', 'adjusted', 'manager_approved'],
    draft: ['draft'],
    pending: ['submitted'],
    approved: ['approved'],
    rejected: ['rejected'],
    processed: ['processed'],
    adjusted: ['adjusted'],
    manager_approved: ['manager_approved'],
    awaiting_payroll: ['submitted', 'manager_approved'],
    awaiting_manager: ['submitted', 'approved'],
  };
  return map[filter];
}

export function timesheetMatchesStatusFilter(
  status: string,
  filter: TimesheetStatusFilter
): boolean {
  return getApprovalsTimesheetStatuses(filter).includes(status as TimesheetStatus);
}
