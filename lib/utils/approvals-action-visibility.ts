import type { AbsenceStatusFilter, TimesheetStatusFilter } from '@/types/common';
import {
  canRejectTimesheetStatus,
  hasManagerApprovedGate,
  hasPayrollReceivedGate,
} from '@/lib/utils/timesheet-gates';

export type ApprovalsActorKind = 'admin' | 'accounts' | 'manager';

export interface TimesheetApprovalActionVisibility {
  showPayrollReceived: boolean;
  showManagerApproved: boolean;
  showReject: boolean;
  showEdit: boolean;
}

export interface AbsenceApprovalActionVisibility {
  showApprove: boolean;
  showReject: boolean;
  showProcess: boolean;
}

export function resolveApprovalsActorKind(input: {
  isAdminTier: boolean;
  isAccountsActor: boolean;
}): ApprovalsActorKind {
  if (input.isAdminTier) return 'admin';
  if (input.isAccountsActor) return 'accounts';
  return 'manager';
}

export function canShowTimesheetPayrollAction(status: string): boolean {
  return !hasPayrollReceivedGate(status) && status !== 'draft' && status !== 'rejected';
}

export function canShowTimesheetManagerAction(status: string): boolean {
  return (
    !hasManagerApprovedGate(status) &&
    status !== 'draft' &&
    status !== 'rejected' &&
    status !== 'adjusted'
  );
}

export function canShowTimesheetEditAction(status: string): boolean {
  return status !== 'draft';
}

export function getTimesheetApprovalActionVisibility(input: {
  actorKind: ApprovalsActorKind;
  status: string;
}): TimesheetApprovalActionVisibility {
  const { actorKind, status } = input;
  const isAdmin = actorKind === 'admin';
  const isAccounts = actorKind === 'accounts';
  const isManager = actorKind === 'manager';

  return {
    showPayrollReceived: (isAdmin || isAccounts) && canShowTimesheetPayrollAction(status),
    showManagerApproved: (isAdmin || isManager) && canShowTimesheetManagerAction(status),
    showReject: (isAdmin || isAccounts || isManager) && canRejectTimesheetStatus(status),
    showEdit: (isAdmin || isAccounts) && canShowTimesheetEditAction(status),
  };
}

export function getAbsenceApprovalActionVisibility(input: {
  actorKind: ApprovalsActorKind;
  status: string;
}): AbsenceApprovalActionVisibility {
  const { actorKind, status } = input;
  const isAdmin = actorKind === 'admin';
  const isAccounts = actorKind === 'accounts';
  const isManager = actorKind === 'manager';
  const pending = status === 'pending';
  const approved = status === 'approved';

  return {
    showApprove: (isAdmin || isManager) && pending,
    showReject: (isAdmin || isManager) && pending,
    showProcess: (isAdmin || isAccounts) && approved,
  };
}

export function getApprovalsTimesheetFilterOptions(
  actorKind: ApprovalsActorKind
): TimesheetStatusFilter[] {
  if (actorKind === 'admin') {
    return [
      'awaiting_payroll',
      'awaiting_manager',
      'pending',
      'approved',
      'manager_approved',
      'rejected',
      'processed',
      'adjusted',
      'all',
    ];
  }
  if (actorKind === 'accounts') {
    return ['awaiting_payroll', 'pending', 'approved', 'rejected', 'processed', 'adjusted', 'all'];
  }
  return ['awaiting_manager', 'pending', 'manager_approved', 'rejected', 'processed', 'all'];
}

export function getApprovalsAbsenceFilterOptions(
  actorKind: ApprovalsActorKind
): AbsenceStatusFilter[] {
  if (actorKind === 'admin') {
    return ['pending', 'approved', 'processed', 'rejected', 'all'];
  }
  if (actorKind === 'accounts') {
    return ['approved', 'processed', 'all'];
  }
  return ['pending', 'approved', 'rejected', 'all'];
}

export function resolveTimesheetPrimaryGate(input: {
  showPayrollReceived: boolean;
  showManagerApproved: boolean;
  filter?: TimesheetStatusFilter;
}): 'payroll' | 'manager' | null {
  if (input.showPayrollReceived && !input.showManagerApproved) return 'payroll';
  if (!input.showPayrollReceived && input.showManagerApproved) return 'manager';
  if (!input.showPayrollReceived && !input.showManagerApproved) return null;
  if (input.filter === 'awaiting_manager' || input.filter === 'approved') return 'manager';
  return 'payroll';
}

export function getTimesheetBulkToolbarVisibility(input: {
  actorKind: ApprovalsActorKind;
  selectedStatuses: string[];
  filter?: TimesheetStatusFilter;
}): { showPayrollReceived: boolean; showManagerApproved: boolean } {
  const fromSelection = input.selectedStatuses.reduce<{
    showPayrollReceived: boolean;
    showManagerApproved: boolean;
  }>(
    (current, status) => {
      const visibility = getTimesheetApprovalActionVisibility({
        actorKind: input.actorKind,
        status,
      });
      return {
        showPayrollReceived: current.showPayrollReceived || visibility.showPayrollReceived,
        showManagerApproved: current.showManagerApproved || visibility.showManagerApproved,
      };
    },
    { showPayrollReceived: false, showManagerApproved: false }
  );

  if (input.actorKind !== 'admin' || !input.filter) {
    return fromSelection;
  }

  if (input.filter === 'awaiting_payroll' || input.filter === 'manager_approved') {
    return {
      showPayrollReceived: fromSelection.showPayrollReceived,
      showManagerApproved: false,
    };
  }

  if (input.filter === 'awaiting_manager' || input.filter === 'approved') {
    return {
      showPayrollReceived: false,
      showManagerApproved: fromSelection.showManagerApproved,
    };
  }

  return fromSelection;
}

export function partitionTimesheetBulkSelection(input: {
  actorKind: ApprovalsActorKind;
  rows: Array<{ id: string; status: string }>;
  action: 'payroll' | 'manager';
}): { eligibleIds: string[]; skippedCount: number } {
  const eligibleIds: string[] = [];
  let skippedCount = 0;

  for (const row of input.rows) {
    const visibility = getTimesheetApprovalActionVisibility({
      actorKind: input.actorKind,
      status: row.status,
    });
    const eligible =
      input.action === 'payroll' ? visibility.showPayrollReceived : visibility.showManagerApproved;
    if (eligible) {
      eligibleIds.push(row.id);
    } else {
      skippedCount += 1;
    }
  }

  return { eligibleIds, skippedCount };
}
