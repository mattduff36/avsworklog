/// <reference types="@testing-library/jest-dom/vitest" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DEFAULT_COLUMN_VISIBILITY,
  TimesheetsApprovalTable,
} from '@/app/(dashboard)/approvals/components/TimesheetsApprovalTable';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

function buildTimesheet(status: string) {
  return {
    id: `timesheet-${status}`,
    user_id: 'profile-1',
    week_ending: '2026-06-14',
    status,
    submitted_at: '2026-06-16T08:00:00.000Z',
    user: {
      full_name: 'Zak Edlin',
      employee_id: 'ZE001',
    },
    timesheet_entries: [
      {
        day_of_week: 1,
        daily_total: 9,
        job_number: '40029-GH',
        working_in_yard: false,
        did_not_work: false,
      },
    ],
  } as Parameters<typeof TimesheetsApprovalTable>[0]['timesheets'][number];
}

describe('TimesheetsApprovalTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Edit and Manager Approved actions for payroll received timesheets', () => {
    const onProcess = vi.fn();

    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('approved')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={onProcess}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
        showPayrollEdit
      />
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manager Approved' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(pushMock).toHaveBeenCalledWith('/timesheets/timesheet-approved');
    expect(onProcess).not.toHaveBeenCalled();
  });

  it('TS-UI-001 shows Manager Approved on pending and hides Payroll Received for non-Accounts', () => {
    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('submitted')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
        showPayrollReceived={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Manager Approved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payroll Received' })).not.toBeInTheDocument();
  });

  it('TS-UI-002 keeps Accounts Edit on Complete and hides Reject', () => {
    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('processed')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
        showPayrollEdit
      />
    );

    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('keeps Manager Approved wired to the process action', () => {
    const onProcess = vi.fn();

    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('approved')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={onProcess}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manager Approved' }));

    expect(onProcess).toHaveBeenCalledWith('timesheet-approved');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('PAY-APPROVAL-BUSY-UI-001 disables Payroll Received only for the busy timesheet', () => {
    const busy = {
      ...buildTimesheet('submitted'),
      id: 'timesheet-busy',
      week_ending: '2026-06-21',
      user: { full_name: 'Busy User', employee_id: 'BU001' },
    };
    const idle = {
      ...buildTimesheet('submitted'),
      id: 'timesheet-idle',
      week_ending: '2026-06-14',
      user: { full_name: 'Idle User', employee_id: 'IU001' },
    };

    render(
      <TimesheetsApprovalTable
        timesheets={[busy, idle]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
        busyTimesheetIds={new Set([busy.id])}
      />
    );

    const busyRow = screen.getByText('Busy User').closest('tr');
    const idleRow = screen.getByText('Idle User').closest('tr');
    expect(busyRow).not.toBeNull();
    expect(idleRow).not.toBeNull();
    const busyButtons = Array.from(busyRow!.querySelectorAll('button'));
    const idleButtons = Array.from(idleRow!.querySelectorAll('button'));
    expect(busyButtons.find((button) => button.textContent?.includes('Reject'))).toBeDisabled();
    expect(busyButtons.find((button) => button.textContent?.includes('Payroll Received'))).toBeDisabled();
    expect(idleButtons.find((button) => button.textContent?.includes('Reject'))).not.toBeDisabled();
    expect(idleButtons.find((button) => button.textContent?.includes('Payroll Received'))).not.toBeDisabled();
  });
});
