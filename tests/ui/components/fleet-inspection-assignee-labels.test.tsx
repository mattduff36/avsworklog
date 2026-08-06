/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY,
  HgvInspectionsListTable,
} from '@/app/(dashboard)/hgv-inspections/components/HgvInspectionsListTable';
import {
  DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY,
  VanInspectionsListTable,
} from '@/app/(dashboard)/van-inspections/components/VanInspectionsListTable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const sharedInspection = {
  id: 'inspection-1',
  user_id: 'user-1',
  status: 'submitted' as const,
  inspection_date: '2026-08-03',
  inspection_end_date: '2026-08-03',
  submitted_at: '2026-08-03T10:00:00.000Z',
  profile: {
    full_name: 'Peter Woodward',
    employee_id: '127',
  },
};

describe('fleet inspection labels with visible assignees', () => {
  it('shows only the van VRN when the employee is in the same row', () => {
    render(
      <VanInspectionsListTable
        inspections={[{
          ...sharedInspection,
          vans: {
            reg_number: 'BN26 VDG',
            nickname: 'Peter Woodward',
            van_categories: { name: 'Van' },
          },
        }]}
        columnVisibility={DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY}
        downloadingId={null}
        deleting={false}
        getInspectionHref={() => '/van-inspections/inspection-1'}
        canDeleteInspection={() => false}
        onDownloadPDF={vi.fn()}
        onOpenDeleteDialog={vi.fn()}
      />
    );

    expect(screen.getByText('BN26 VDG')).toBeInTheDocument();
    expect(screen.queryByText('BN26 VDG (Peter Woodward)')).not.toBeInTheDocument();
  });

  it('does not repeat the HGV nickname beside the employee', () => {
    render(
      <HgvInspectionsListTable
        inspections={[{
          ...sharedInspection,
          hgv: {
            reg_number: 'YK24 HGV',
            nickname: 'Peter Woodward',
          },
        }]}
        columnVisibility={DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY}
        downloadingId={null}
        deletingId={null}
        getInspectionHref={() => '/hgv-inspections/inspection-1'}
        canDeleteInspection={() => false}
        onDownloadPDF={vi.fn()}
        onDeleteInspection={vi.fn()}
      />
    );

    expect(screen.getByText('YK24 HGV')).toBeInTheDocument();
    expect(screen.queryByText('Nickname')).not.toBeInTheDocument();
  });

  it('keeps the van nickname when the employee is unknown', () => {
    render(
      <VanInspectionsListTable
        inspections={[{
          ...sharedInspection,
          profile: null,
          vans: {
            reg_number: 'BN26 VDG',
            nickname: 'Peter Woodward',
            van_categories: { name: 'Van' },
          },
        }]}
        columnVisibility={DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY}
        downloadingId={null}
        deleting={false}
        getInspectionHref={() => '/van-inspections/inspection-1'}
        canDeleteInspection={() => false}
        onDownloadPDF={vi.fn()}
        onOpenDeleteDialog={vi.fn()}
      />
    );

    expect(screen.getByText('BN26 VDG (Peter Woodward)')).toBeInTheDocument();
  });

  it('keeps the HGV nickname when the employee is unknown', () => {
    render(
      <HgvInspectionsListTable
        inspections={[{
          ...sharedInspection,
          profile: null,
          hgv: {
            reg_number: 'YK24 HGV',
            nickname: 'Peter Woodward',
          },
        }]}
        columnVisibility={DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY}
        downloadingId={null}
        deletingId={null}
        getInspectionHref={() => '/hgv-inspections/inspection-1'}
        canDeleteInspection={() => false}
        onDownloadPDF={vi.fn()}
        onDeleteInspection={vi.fn()}
      />
    );

    expect(screen.getByText('YK24 HGV (Peter Woodward)')).toBeInTheDocument();
  });
});
