import { describe, expect, it } from 'vitest';
import { assertNoLockedAbsenceTimesheetImpacts } from '@/lib/utils/absence-timesheet-impact';
import {
  TIMESHEET_ADJUST_RETIRED_CODE,
  canRejectTimesheetStatus,
  deriveTimesheetStatusFromGates,
  resolveTimesheetManagerApprovedAction,
  resolveTimesheetPayrollReceivedAction,
  resolveTimesheetRejectAction,
  statusAfterClearingManagerGate,
} from '@/lib/utils/timesheet-gates';

// Candidate-bound supporting evidence for ws_303cb13a69947b08 Manager Approved lock.
describe('timesheet dual gates', () => {
  it('TS-GATE-001 allows Manager Approved from submitted and approved, and is idempotent afterwards', () => {
    expect(resolveTimesheetManagerApprovedAction('submitted')).toEqual({
      type: 'apply',
      nextStatus: 'manager_approved',
    });
    expect(resolveTimesheetManagerApprovedAction('approved')).toEqual({
      type: 'apply',
      nextStatus: 'processed',
    });
    expect(resolveTimesheetManagerApprovedAction('processed')).toEqual({ type: 'already_done' });
    expect(resolveTimesheetManagerApprovedAction('manager_approved')).toEqual({ type: 'already_done' });
  });

  it('TS-GATE-002 allows Payroll Received from submitted and manager_approved', () => {
    expect(resolveTimesheetPayrollReceivedAction('submitted')).toEqual({
      type: 'apply',
      nextStatus: 'approved',
    });
    expect(resolveTimesheetPayrollReceivedAction('manager_approved')).toEqual({
      type: 'apply',
      nextStatus: 'processed',
    });
    expect(resolveTimesheetPayrollReceivedAction('approved')).toEqual({ type: 'already_done' });
    expect(resolveTimesheetPayrollReceivedAction('draft').type).toBe('conflict');
  });

  it('TS-GATE-003 allows reject until Complete and forbids it afterwards', () => {
    expect(canRejectTimesheetStatus('submitted')).toBe(true);
    expect(canRejectTimesheetStatus('approved')).toBe(true);
    expect(canRejectTimesheetStatus('manager_approved')).toBe(true);
    expect(canRejectTimesheetStatus('processed')).toBe(false);
    expect(resolveTimesheetRejectAction('processed').type).toBe('conflict');
    expect(resolveTimesheetRejectAction('submitted')).toEqual({ type: 'apply', nextStatus: 'rejected' });
  });

  it('TS-FD-002 keeps either-order gates, absence lock after payroll received, and retired Adjust', () => {
    expect(resolveTimesheetManagerApprovedAction('submitted')).toEqual({
      type: 'apply',
      nextStatus: 'manager_approved',
    });
    expect(resolveTimesheetPayrollReceivedAction('manager_approved')).toEqual({
      type: 'apply',
      nextStatus: 'processed',
    });
    expect(canRejectTimesheetStatus('approved')).toBe(true);
    expect(canRejectTimesheetStatus('processed')).toBe(false);
    expect(TIMESHEET_ADJUST_RETIRED_CODE).toBe('timesheet_adjust_retired');
    expect(() =>
      assertNoLockedAbsenceTimesheetImpacts([
        { status: 'approved', weekEnding: '2026-08-09' } as never,
      ])
    ).toThrow(/locked timesheets/);
    expect(() =>
      assertNoLockedAbsenceTimesheetImpacts([
        { status: 'manager_approved', weekEnding: '2026-08-09' } as never,
      ])
    ).not.toThrow();
  });

  it('clears only the manager gate after a pay-impact edit', () => {
    expect(statusAfterClearingManagerGate('processed')).toBe('approved');
    expect(statusAfterClearingManagerGate('manager_approved')).toBe('submitted');
    expect(deriveTimesheetStatusFromGates({ payrollReceived: true, managerApproved: true })).toBe('processed');
  });
});
