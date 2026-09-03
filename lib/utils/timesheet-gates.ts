import type { TimesheetStatus } from '@/types/timesheet';

export const TIMESHEET_GATE_STATUS_CONFLICT_CODE = 'timesheet_gate_status_conflict';
export const TIMESHEET_PAYROLL_EDIT_STALE_CODE = 'timesheet_payroll_edit_stale';
export const TIMESHEET_PAYROLL_EDIT_PAY_IMPACT_MISMATCH_CODE =
  'timesheet_payroll_edit_pay_impact_mismatch';
export const TIMESHEET_PAYROLL_EDIT_SNAPSHOTLESS_CODE = 'timesheet_payroll_edit_snapshotless_legacy';
export const TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE =
  'timesheet_payroll_edit_idempotency_conflict';
export const TIMESHEET_ADJUST_RETIRED_CODE = 'timesheet_adjust_retired';

export const TIMESHEET_ADJUST_RETIRED_MESSAGE =
  'Timesheet Adjust is no longer used. Accounts can correct the sheet with payroll edit.';

export function isTimesheetStatus(value: string): value is TimesheetStatus {
  return (
    value === 'draft' ||
    value === 'submitted' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'processed' ||
    value === 'adjusted' ||
    value === 'manager_approved'
  );
}

export function hasPayrollReceivedGate(status: string): boolean {
  return status === 'approved' || status === 'processed';
}

export function hasManagerApprovedGate(status: string): boolean {
  return status === 'manager_approved' || status === 'processed';
}

export function isTimesheetComplete(status: string): boolean {
  return status === 'processed';
}

export function canRejectTimesheetStatus(status: string): boolean {
  return status === 'submitted' || status === 'approved' || status === 'manager_approved';
}

export function deriveTimesheetStatusFromGates(input: {
  payrollReceived: boolean;
  managerApproved: boolean;
}): 'submitted' | 'approved' | 'manager_approved' | 'processed' {
  if (input.payrollReceived && input.managerApproved) return 'processed';
  if (input.payrollReceived) return 'approved';
  if (input.managerApproved) return 'manager_approved';
  return 'submitted';
}

export type TimesheetGateDecision =
  | { type: 'apply'; nextStatus: TimesheetStatus }
  | { type: 'already_done' }
  | { type: 'conflict'; message: string };

export function resolveTimesheetPayrollReceivedAction(status: string): TimesheetGateDecision {
  if (hasPayrollReceivedGate(status)) {
    return { type: 'already_done' };
  }
  if (status === 'submitted') {
    return { type: 'apply', nextStatus: 'approved' };
  }
  if (status === 'manager_approved') {
    return { type: 'apply', nextStatus: 'processed' };
  }
  if (status === 'adjusted') {
    return { type: 'apply', nextStatus: 'approved' };
  }
  return {
    type: 'conflict',
    message: `Timesheet cannot be marked Payroll Received from status "${status}".`,
  };
}

export function resolveTimesheetManagerApprovedAction(status: string): TimesheetGateDecision {
  if (hasManagerApprovedGate(status)) {
    return { type: 'already_done' };
  }
  if (status === 'submitted') {
    return { type: 'apply', nextStatus: 'manager_approved' };
  }
  if (status === 'approved') {
    return { type: 'apply', nextStatus: 'processed' };
  }
  const messages: Record<string, string> = {
    rejected: 'This timesheet was rejected, so it cannot be marked Manager Approved.',
    adjusted:
      'This timesheet has been adjusted and needs Payroll Received before it can be marked Manager Approved.',
    draft: 'This timesheet is still a draft, so it cannot be marked Manager Approved.',
  };
  return {
    type: 'conflict',
    message: messages[status] || 'This timesheet can no longer be marked as Manager Approved.',
  };
}

export function resolveTimesheetRejectAction(status: string): TimesheetGateDecision {
  if (canRejectTimesheetStatus(status)) {
    return { type: 'apply', nextStatus: 'rejected' };
  }
  if (status === 'rejected') {
    return { type: 'conflict', message: 'This timesheet is already rejected.' };
  }
  if (status === 'processed') {
    return {
      type: 'conflict',
      message:
        'This timesheet is Complete. Accounts must edit pay first if it needs to go back to the employee.',
    };
  }
  return {
    type: 'conflict',
    message: 'This timesheet cannot be rejected in its current status.',
  };
}

export function statusAfterClearingManagerGate(status: string): TimesheetStatus {
  if (hasPayrollReceivedGate(status)) return 'approved';
  return 'submitted';
}

export function formatTimesheetStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'submitted':
      return 'Pending';
    case 'approved':
      return 'Payroll Received';
    case 'manager_approved':
      return 'Manager Approved';
    case 'processed':
      return 'Complete';
    case 'rejected':
      return 'Rejected';
    case 'adjusted':
      return 'Adjusted';
    default:
      return status;
  }
}
