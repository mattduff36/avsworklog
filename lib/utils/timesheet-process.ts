export type TimesheetProcessDecision =
  | { type: 'process' }
  | { type: 'already_processed' }
  | { type: 'conflict'; message: string };

export const TIMESHEET_PROCESS_STATUS_CONFLICT_CODE = 'timesheet_process_status_conflict';

const LEGACY_PROCESS_CONFLICT = /^Only approved timesheets can be processed\.?$/i;
const STATUS_CHANGED_CONFLICT = /^Timesheet status changed before it could be processed\.?$/i;
const PENDING_PAYROLL_CONFLICT =
  /^This timesheet is still pending Payroll Received, so it cannot be marked Manager Approved yet\.?$/i;

const PROCESS_CONFLICT_MESSAGES = [
  'This timesheet was rejected, so it cannot be marked Manager Approved.',
  'This timesheet has been adjusted and needs Payroll Received before it can be marked Manager Approved.',
  'This timesheet is still a draft, so it cannot be marked Manager Approved.',
  'This timesheet can no longer be marked as Manager Approved.',
];

import { resolveTimesheetManagerApprovedAction } from '@/lib/utils/timesheet-gates';

export function resolveTimesheetProcessAction(status: string): TimesheetProcessDecision {
  const decision = resolveTimesheetManagerApprovedAction(status);
  if (decision.type === 'already_done') {
    return { type: 'already_processed' };
  }
  if (decision.type === 'apply') {
    return { type: 'process' };
  }
  return { type: 'conflict', message: decision.message };
}

export function isTimesheetProcessConflict(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  if (
    LEGACY_PROCESS_CONFLICT.test(message) ||
    STATUS_CHANGED_CONFLICT.test(message) ||
    PENDING_PAYROLL_CONFLICT.test(message)
  ) {
    return true;
  }
  return PROCESS_CONFLICT_MESSAGES.includes(message);
}
