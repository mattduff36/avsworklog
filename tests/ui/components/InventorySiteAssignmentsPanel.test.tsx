/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  InventorySiteAssignmentsPanel,
  type InventorySiteAssignment,
} from '@/app/(dashboard)/inventory/components/InventorySiteAssignmentsPanel';
import type { InventoryLocation } from '@/app/(dashboard)/inventory/types';

const site: InventoryLocation = {
  id: 'site-1',
  name: 'Riverside',
  description: null,
  is_active: true,
  linked_van_id: null,
  linked_hgv_id: null,
  linked_plant_id: null,
  location_type: 'site',
  source_type: 'quote',
  source_id: 'quote-1',
  external_reference: '12345',
  sync_status: 'synced',
  source_synced_at: null,
  created_at: '2026-07-21T00:00:00.000Z',
  updated_at: '2026-07-21T00:00:00.000Z',
  created_by: null,
  updated_by: null,
};

const assignment: InventorySiteAssignment = {
  user_id: 'user-1',
  location_id: site.id,
  assigned_by: null,
  assigned_at: '2026-07-21T00:00:00.000Z',
  note: null,
  user: {
    id: 'user-1',
    full_name: 'Alex Smith',
    employee_id: '100',
  },
  location: site,
};

describe('InventorySiteAssignmentsPanel', () => {
  it('uses the Site presentation for assignment rows and location badges', () => {
    render(
      <InventorySiteAssignmentsPanel
        users={[assignment.user!]}
        activeSites={[site]}
        assignments={[assignment]}
        onAssign={vi.fn(async () => undefined)}
        onRemove={vi.fn(async () => undefined)}
        onIncludeLegacyQuotesChange={vi.fn(async () => undefined)}
      />,
    );

    const assignmentRow = screen.getByText('Alex Smith #100')
      .closest('[data-location-type="site"]');
    expect(assignmentRow).toHaveClass('bg-[hsl(var(--avs-yellow)/0.10)]');
    expect(screen.getByText('12345 - Riverside')).toHaveClass(
      'border-[hsl(var(--avs-yellow)/0.40)]',
      'text-avs-yellow',
    );
  });
});
