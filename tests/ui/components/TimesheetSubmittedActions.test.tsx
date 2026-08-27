/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TimesheetSubmittedActions } from '@/app/(dashboard)/approvals/components/TimesheetSubmittedActions';

describe('TimesheetSubmittedActions', () => {
  it('PAY-APPROVAL-BUSY-UI-001 disables approve and reject when busy (card/table shared surface)', () => {
    render(
      <TimesheetSubmittedActions
        timesheetId="timesheet-busy"
        busy
        onApprove={vi.fn()}
        onReject={vi.fn()}
        rejectClassName="reject"
        approveClassName="approve"
      />
    );

    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Payroll Received' })).toBeDisabled();
  });

  it('keeps actions enabled when not busy', () => {
    render(
      <TimesheetSubmittedActions
        timesheetId="timesheet-idle"
        busy={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        rejectClassName="reject"
        approveClassName="approve"
      />
    );

    expect(screen.getByRole('button', { name: 'Reject' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Payroll Received' })).not.toBeDisabled();
  });

  it('PAY-UI-PAYROLL-BUTTON-001 hides Payroll Received for non-payroll actors', () => {
    render(
      <TimesheetSubmittedActions
        timesheetId="timesheet-manager"
        busy={false}
        showPayrollReceived={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        rejectClassName="reject"
        approveClassName="approve"
      />
    );

    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payroll Received' })).not.toBeInTheDocument();
  });
});
