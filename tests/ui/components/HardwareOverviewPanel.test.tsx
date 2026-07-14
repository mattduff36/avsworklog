/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HardwareOverviewPanel } from '@/app/(dashboard)/inventory/components/HardwareOverviewPanel';
import type {
  InventoryHardwareItem,
  InventoryLocation,
} from '@/app/(dashboard)/inventory/types';

const item: InventoryHardwareItem = {
  id: 'cones',
  name: 'Cones',
  name_normalized: 'cones',
  is_active: true,
  created_at: '2026-07-14T00:00:00.000Z',
  updated_at: '2026-07-14T00:00:00.000Z',
  created_by: null,
  updated_by: null,
};

const location: InventoryLocation = {
  id: 'yard',
  name: 'Yard',
  description: null,
  is_active: true,
  linked_van_id: null,
  linked_hgv_id: null,
  linked_plant_id: null,
  location_type: 'yard',
  source_type: 'system',
  source_id: null,
  external_reference: null,
  sync_status: 'synced',
  source_synced_at: null,
  created_at: '2026-07-14T00:00:00.000Z',
  updated_at: '2026-07-14T00:00:00.000Z',
  created_by: null,
  updated_by: null,
};

describe('HardwareOverviewPanel', () => {
  it('shows company totals and expandable location balances', () => {
    render(
      <HardwareOverviewPanel
        items={[item]}
        balances={[{
          id: 'balance-1',
          hardware_item_id: item.id,
          location_id: location.id,
          quantity: 24,
          location,
        }]}
      />,
    );

    expect(screen.getByText('24 total')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cones/i }));
    expect(screen.getByText('Yard')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
  });
});
