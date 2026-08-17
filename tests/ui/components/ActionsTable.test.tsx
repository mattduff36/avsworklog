/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionsTable } from '@/app/(dashboard)/actions/components/ActionsTable';
import { PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import type { ReminderActionWithAsset } from '@/types/reminders';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function buildLegacyAction(): ReminderActionWithAsset {
  return {
    id: 'action-legacy-1',
    workflow_key: PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY,
    source_type: 'system_generated',
    dedupe_key: 'plant_legacy_missing_site:legacy-1:4323GH',
    status: 'open',
    priority: 'high',
    title: 'Add a site address for legacy job 4323-GH',
    description: 'A plant daily check used this legacy job code. Add a valid site address within 48 hours.',
    asset_type: null,
    van_id: null,
    plant_id: null,
    hgv_id: null,
    metadata: {
      job_code: '4323-GH',
      customer_name: 'Omexom',
      quote_title: 'ATV hire',
      inspection_id: 'inspection-1',
      inspection_date: '2026-08-17',
    },
    created_by: null,
    resolved_by: null,
    ignored_until: null,
    ignored_forever: false,
    ignored_at: null,
    ignored_by: null,
    first_detected_at: '2026-08-17T09:00:00.000Z',
    last_detected_at: '2026-08-17T09:00:00.000Z',
    due_at: '2026-08-19T09:00:00.000Z',
    resolved_at: null,
    created_at: '2026-08-17T09:00:00.000Z',
    updated_at: '2026-08-17T09:00:00.000Z',
    asset_label: null,
    asset_route: null,
    reminders_count: {
      total: 0,
      pending: 0,
      actioned: 0,
      cancelled: 0,
    },
  };
}

describe('ActionsTable legacy job presentation', () => {
  it('UI-001 shows job details, unassigned state, and the 48-hour due target without ignore or resolve controls', () => {
    render(
      <ActionsTable
        actions={[buildLegacyAction()]}
        presentation="legacy-job"
        loading={false}
        filters={{ search: '', assignment: 'all' }}
        onFiltersChange={vi.fn()}
        onAssign={vi.fn()}
        onIgnore={vi.fn()}
      />
    );

    expect(screen.getByText('4323-GH')).toBeInTheDocument();
    expect(screen.getByText('Omexom · ATV hire')).toBeInTheDocument();
    expect(screen.getByText('17-08-2026')).toBeInTheDocument();
    expect(screen.getByText(/Due 19-08-2026/)).toBeInTheDocument();
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ignore/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Add site address')).not.toBeInTheDocument();
  });
});
