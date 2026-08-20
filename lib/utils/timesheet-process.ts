export type TimesheetProcessDecision =
  | { type: 'process' }
  | { type: 'already_processed' }
  | { type: 'conflict'; message: string };

export const TIMESHEET_PROCESS_STATUS_CONFLICT_CODE = 'timesheet_process_status_conflict';

const LEGACY_PROCESS_CONFLICT = /^Only approved timesheets can be processed\.?$/i;
const STATUS_CHANGED_CONFLICT = /^Timesheet status changed before it could be processed\.?$/i;

const PROCESS_CONFLICT_MESSAGES: Record<string, string> = {
  submitted:
    'This timesheet is still pending Payroll Received, so it cannot be marked Manager Approved yet.',
  rejected: 'This timesheet was rejected, so it cannot be marked Manager Approved.',
  adjusted:
    'This timesheet has been adjusted and needs reapproval before it can be marked Manager Approved.',
  draft: 'This timesheet is still a draft, so it cannot be marked Manager Approved.',
};

export function resolveTimesheetProcessAction(status: string): TimesheetProcessDecision {
  if (status === 'processed') {
    return { type: 'already_processed' };
  }
  if (status === 'approved') {
    return { type: 'process' };
  }

  return {
    type: 'conflict',
    message:
      PROCESS_CONFLICT_MESSAGES[status] ||
      'This timesheet can no longer be marked as Manager Approved.',
  };
}

export function isTimesheetProcessConflict(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  if (LEGACY_PROCESS_CONFLICT.test(message) || STATUS_CHANGED_CONFLICT.test(message)) {
    return true;
  }
  return Object.values(PROCESS_CONFLICT_MESSAGES).includes(message)
    || message === 'This timesheet can no longer be marked as Manager Approved.';
}
