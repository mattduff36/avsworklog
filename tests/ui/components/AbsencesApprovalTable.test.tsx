/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  AbsencesApprovalTable,
  type AbsenceColumnVisibility,
} from '@/app/(dashboard)/approvals/components/AbsencesApprovalTable';
import type { AbsenceWithRelations } from '@/types/absence';

vi.mock('@/lib/hooks/useAbsence', () => ({
  useAbsenceSummaryForEmployee: () => ({
    data: { remaining: 10 },
    isLoading: false,
  }),
}));

const defaultColumnVisibility: AbsenceColumnVisibility = {
  employeeId: false,
  reason: true,
  duration: true,
  remainingAllowance: false,
  paidStatus: false,
  submittedAt: true,
};

function buildAbsence(id: string, status: AbsenceWithRelations['status']): AbsenceWithRelations {
  return {
    id,
    profile_id: 'profile-1',
    date: '2026-04-01',
    end_date: null,
    reason_id: 'reason-1',
    duration_days: 1,
    is_half_day: false,
    half_day_session: null,
    notes: null,
    status,
    created_by: 'user-1',
    approved_by: 'user-2',
    approved_at: '2026-04-01T10:00:00.000Z',
    processed_by: status === 'processed' ? 'user-3' : null,
    processed_at: status === 'processed' ? '2026-04-01T11:00:00.000Z' : null,
    is_bank_holiday: false,
    auto_generated: false,
    generation_source: null,
    holiday_key: null,
    bulk_batch_id: null,
    allow_timesheet_work_on_leave: false,
    created_at: '2026-04-01T09:00:00.000Z',
    updated_at: '2026-04-01T09:00:00.000Z',
    absence_reasons: {
      id: 'reason-1',
      name: 'Annual Leave',
      is_paid: true,
      color: '#7c3aed',
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    profiles: {
      full_name: 'Alex Able',
      employee_id: 'E001',
      team_id: 'team-1',
    },
  };
}

describe('AbsencesApprovalTable', () => {
  it('shows Approve/Reject actions for pending absences', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onProcess = vi.fn();

    render(
      <AbsencesApprovalTable
        absences={[buildAbsence('absence-pending', 'pending')]}
        onApprove={onApprove}
        onReject={onReject}
        onProcess={onProcess}
        columnVisibility={defaultColumnVisibility}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onApprove).toHaveBeenCalledWith('absence-pending');
    expect(onReject).toHaveBeenCalledWith('absence-pending');
    expect(onProcess).not.toHaveBeenCalled();
  });

  it('shows Process action for approved absences', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onProcess = vi.fn();

    render(
      <AbsencesApprovalTable
        absences={[buildAbsence('absence-approved', 'approved')]}
        onApprove={onApprove}
        onReject={onReject}
        onProcess={onProcess}
        columnVisibility={defaultColumnVisibility}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Process' }));

    expect(onProcess).toHaveBeenCalledWith('absence-approved');
    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('shows no actions for processed absences', () => {
    render(
      <AbsencesApprovalTable
        absences={[buildAbsence('absence-processed', 'processed')]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={defaultColumnVisibility}
      />
    );

    expect(screen.getByText('No actions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Process' })).not.toBeInTheDocument();
  });
});
