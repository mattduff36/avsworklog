/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY,
  HgvInspectionsListTable,
} from '@/app/(dashboard)/hgv-inspections/components/HgvInspectionsListTable';
import {
  DEFAULT_TIMESHEETS_LIST_COLUMN_VISIBILITY,
  TimesheetsListTable,
} from '@/app/(dashboard)/timesheets/components/TimesheetsListTable';
import type { Timesheet } from '@/types/timesheet';
import {
  TIMESHEET_LIST_SELECT,
  type TimesheetListDeleteTarget,
  type TimesheetListRow,
} from '@/types/timesheet-list';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const timesheetRows: TimesheetListRow[] = [
  {
    id: 'ts-draft',
    user_id: 'user-1',
    week_ending: '2026-10-04',
    status: 'draft',
    reg_number: null,
    submitted_at: null,
    manager_comments: null,
    profile: { full_name: 'Draft Employee', employee_id: '101', team_id: 'team-a' },
  },
  {
    id: 'ts-submitted',
    user_id: 'user-2',
    week_ending: '2026-10-11',
    status: 'submitted',
    reg_number: 'AB12 CDE',
    submitted_at: '2026-10-11T09:00:00.000Z',
    manager_comments: null,
    profile: { full_name: 'Submitted Employee', employee_id: null, team_id: 'team-a' },
  },
  {
    id: 'ts-manager',
    user_id: 'user-3',
    week_ending: '2026-10-18',
    status: 'manager_approved',
    reg_number: 'HG65 FWD',
    submitted_at: '2026-10-18T09:00:00.000Z',
    manager_comments: null,
    profile: { full_name: 'Approved Employee', employee_id: '303', team_id: 'team-b' },
  },
  {
    id: 'ts-rejected',
    user_id: 'user-4',
    week_ending: '2026-10-25',
    status: 'rejected',
    reg_number: null,
    submitted_at: '2026-10-25T09:00:00.000Z',
    manager_comments: 'Correct Friday hours',
    profile: { full_name: 'Rejected Employee', employee_id: '404', team_id: null },
  },
];

type ListIsNotFullTimesheet = TimesheetListRow extends Timesheet ? never : true;

describe('lightweight timesheet list rows', () => {
  it('renders list statuses, nullable fields, optional columns and id-only actions', () => {
    const listIsNotFullTimesheet: ListIsNotFullTimesheet = true;
    expect(listIsNotFullTimesheet).toBe(true);
    expect(TIMESHEET_LIST_SELECT).not.toContain('signature_data');
    expect(TIMESHEET_LIST_SELECT).toContain('manager_comments');
    expect(TIMESHEET_LIST_SELECT).toContain('profile:profiles!timesheets_user_id_fkey(full_name, employee_id, team_id)');

    const onDownloadPDF = vi.fn();
    const onOpenDeleteDialog = vi.fn();
    const { rerender } = render(
      <TimesheetsListTable
        timesheets={[]}
        columnVisibility={DEFAULT_TIMESHEETS_LIST_COLUMN_VISIBILITY}
        downloadingId={null}
        showDeleteActions
        onDownloadPDF={onDownloadPDF}
        onOpenDeleteDialog={onOpenDeleteDialog}
      />
    );

    expect(screen.queryByTitle('Delete timesheet')).not.toBeInTheDocument();

    rerender(
      <TimesheetsListTable
        timesheets={timesheetRows}
        columnVisibility={{ ...DEFAULT_TIMESHEETS_LIST_COLUMN_VISIBILITY, employeeId: true }}
        downloadingId={null}
        showDeleteActions
        onDownloadPDF={onDownloadPDF}
        onOpenDeleteDialog={onOpenDeleteDialog}
      />
    );

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Manager Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('AB12 CDE')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
    expect(screen.getByText('Not submitted')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'PDF' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'PDF' })[0]);
    expect(onDownloadPDF).toHaveBeenCalledWith(expect.any(Object), 'ts-manager');

    fireEvent.click(screen.getAllByTitle('Delete timesheet')[0]);
    const deleted = onOpenDeleteDialog.mock.calls[0][1] as TimesheetListDeleteTarget;
    expect(deleted.id).toBe('ts-rejected');
    expect(deleted.week_ending).toBe('2026-10-25');
    expect(deleted).not.toHaveProperty('signature_data');
  });

  it('keeps the HGV list date range on inspection_end_date', () => {
    render(
      <HgvInspectionsListTable
        inspections={[{
          id: 'hgv-1',
          user_id: 'user-1',
          status: 'submitted',
          inspection_date: '2026-10-19',
          inspection_end_date: '2026-10-25',
          submitted_at: '2026-10-25T10:00:00.000Z',
          hgv: { reg_number: 'YK24 HGV', nickname: null },
          profile: { full_name: 'Range Employee', employee_id: null },
        }]}
        columnVisibility={DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY}
        downloadingId={null}
        deletingId={null}
        getInspectionHref={() => '/hgv-inspections/hgv-1'}
        canDeleteInspection={() => false}
        onDownloadPDF={vi.fn()}
        onDeleteInspection={vi.fn()}
      />
    );

    expect(screen.getByText('19/10/2026 - 25/10/2026')).toBeInTheDocument();
  });


});
