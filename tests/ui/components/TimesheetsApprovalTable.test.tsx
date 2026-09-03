/// <reference types="@testing-library/jest-dom/vitest" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    const proto = Element.prototype as unknown as {
      hasPointerCapture?: (pointerId: number) => boolean;
      setPointerCapture?: (pointerId: number) => void;
      releasePointerCapture?: (pointerId: number) => void;
    };
    proto.hasPointerCapture ??= () => false;
    proto.setPointerCapture ??= () => undefined;
    proto.releasePointerCapture ??= () => undefined;
  });

  it('shows Edit and Manager Approved actions for payroll received timesheets', () => {
    const onProcess = vi.fn();

    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('approved')]}
        actorKind="admin"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={onProcess}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      />
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manager Approved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manager Approved' })).toHaveTextContent('Approved');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(pushMock).toHaveBeenCalledWith('/timesheets/timesheet-approved');
    expect(onProcess).not.toHaveBeenCalled();
  });

  it('TS-UI-001 shows Manager Approved on pending and hides Payroll Received for non-Accounts', () => {
    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('submitted')]}
        actorKind="manager"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      />
    );

    expect(screen.getByRole('button', { name: 'Manager Approved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payroll Received' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('hides Manager Approved for Accounts on pending sheets', () => {
    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('submitted')]}
        actorKind="accounts"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      />
    );

    expect(screen.getByRole('button', { name: 'Payroll Received' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payroll Received' })).toHaveTextContent('Received');
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manager Approved' })).not.toBeInTheDocument();
  });

  it('TS-UI-002 keeps Accounts Edit on Complete and hides Reject', () => {
    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('processed')]}
        actorKind="accounts"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
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
        actorKind="manager"
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

  it('opens a preview without navigating', async () => {
    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('submitted')]}
        actorKind="manager"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview timesheet' }));

    await waitFor(() => {
      expect(screen.getByText('Week preview')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Open timesheet' })).toHaveAttribute(
      'href',
      '/timesheets/timesheet-submitted'
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('selects visible rows without navigating', () => {
    const onToggleSelected = vi.fn();

    render(
      <TimesheetsApprovalTable
        timesheets={[buildTimesheet('submitted')]}
        actorKind="manager"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={DEFAULT_COLUMN_VISIBILITY}
        selectedIds={new Set()}
        onToggleSelected={onToggleSelected}
        onToggleVisibleSelected={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zak Edlin' }));

    expect(onToggleSelected).toHaveBeenCalledWith('timesheet-submitted', true);
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
        actorKind="accounts"
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
    expect(busyRow!.querySelector('[aria-label="Payroll Received"]')).toBeDisabled();
    expect(idleRow!.querySelector('[aria-label="Payroll Received"]')).not.toBeDisabled();
    expect(busyRow!.querySelector('button') && Array.from(busyRow!.querySelectorAll('button')).find((button) => button.textContent === 'Reject')).toBeDisabled();
    expect(Array.from(idleRow!.querySelectorAll('button')).find((button) => button.textContent === 'Reject')).not.toBeDisabled();
  });
});
