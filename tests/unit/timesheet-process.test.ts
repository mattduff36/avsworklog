import { describe, expect, it } from 'vitest';
import {
  isTimesheetProcessConflict,
  resolveTimesheetProcessAction,
} from '@/lib/utils/timesheet-process';

describe('resolveTimesheetProcessAction', () => {
  it('PAY-PROCESS-DECISION-001 processes approved timesheets and is idempotent for processed', () => {
    expect(resolveTimesheetProcessAction('approved')).toEqual({ type: 'process' });
    expect(resolveTimesheetProcessAction('processed')).toEqual({ type: 'already_processed' });
  });

  it('PAY-PROCESS-DECISION-002 rejects every other status with a user-facing conflict', () => {
    expect(resolveTimesheetProcessAction('submitted')).toEqual({
      type: 'conflict',
      message:
        'This timesheet is still pending Payroll Received, so it cannot be marked Manager Approved yet.',
    });
    expect(resolveTimesheetProcessAction('rejected').type).toBe('conflict');
    expect(resolveTimesheetProcessAction('adjusted').type).toBe('conflict');
    expect(resolveTimesheetProcessAction('draft')).toEqual({
      type: 'conflict',
      message: 'This timesheet is still a draft, so it cannot be marked Manager Approved.',
    });
  });
});

describe('isTimesheetProcessConflict', () => {
  it('PAY-PROCESS-CONFLICT-001 matches current and legacy process conflicts only', () => {
    expect(
      isTimesheetProcessConflict(
        new Error('Only approved timesheets can be processed')
      )
    ).toBe(true);
    expect(
      isTimesheetProcessConflict(
        new Error(
          'This timesheet is still pending Payroll Received, so it cannot be marked Manager Approved yet.'
        )
      )
    ).toBe(true);
    expect(
      isTimesheetProcessConflict(
        new Error('Timesheet status changed before it could be processed')
      )
    ).toBe(true);
    expect(isTimesheetProcessConflict(new Error('Unauthorized'))).toBe(false);
    expect(
      isTimesheetProcessConflict(
        new Error('Timesheet cannot be approved from status "approved".')
      )
    ).toBe(false);
  });
});
