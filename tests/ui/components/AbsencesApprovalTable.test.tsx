/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  AbsencesApprovalTable,
  DEFAULT_ABSENCE_COLUMN_VISIBILITY,
} from '@/app/(dashboard)/approvals/components/AbsencesApprovalTable';
import type { AbsenceWithRelations } from '@/types/absence';

function buildAbsence(status: AbsenceWithRelations['status']): AbsenceWithRelations {
  return {
    id: `absence-${status}`,
    profile_id: 'profile-1',
    date: '2026-06-10',
    end_date: '2026-06-10',
    duration_days: 1,
    status,
    created_at: '2026-06-09T08:00:00.000Z',
    is_half_day: false,
    notes: null,
    profiles: {
      full_name: 'Zak Edlin',
      employee_id: 'ZE001',
      team_id: 'team-1',
    },
    absence_reasons: {
      name: 'Annual Leave',
      is_paid: true,
    },
  } as AbsenceWithRelations;
}

describe('AbsencesApprovalTable', () => {
  it('shows Approve and Reject to managers on pending absences', () => {
    render(
      <AbsencesApprovalTable
        absences={[buildAbsence('pending')]}
        actorKind="manager"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={{ ...DEFAULT_ABSENCE_COLUMN_VISIBILITY, remainingAllowance: false }}
      />
    );

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Process' })).not.toBeInTheDocument();
  });

  it('shows Process only to Accounts on approved absences', () => {
    render(
      <AbsencesApprovalTable
        absences={[buildAbsence('approved')]}
        actorKind="accounts"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={{ ...DEFAULT_ABSENCE_COLUMN_VISIBILITY, remainingAllowance: false }}
      />
    );

    expect(screen.getByRole('button', { name: 'Process' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('hides pending actions from Accounts', () => {
    render(
      <AbsencesApprovalTable
        absences={[buildAbsence('pending')]}
        actorKind="accounts"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onProcess={vi.fn()}
        columnVisibility={{ ...DEFAULT_ABSENCE_COLUMN_VISIBILITY, remainingAllowance: false }}
      />
    );

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});
