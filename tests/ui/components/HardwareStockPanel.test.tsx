/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HardwareStockPanel } from '@/app/(dashboard)/inventory/components/HardwareStockPanel';
import type {
  InventoryHardwareItem,
  InventoryLocation,
} from '@/app/(dashboard)/inventory/types';

function makeHardwareItem(id: string, name: string): InventoryHardwareItem {
  return {
    id,
    name,
    name_normalized: name.toLowerCase(),
    is_active: true,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

function makeLocation(id: string, name: string): InventoryLocation {
  return {
    id,
    name,
    description: null,
    is_active: true,
    linked_van_id: null,
    linked_hgv_id: null,
    linked_plant_id: null,
    location_type: 'manual',
    source_type: 'manual',
    source_id: null,
    external_reference: null,
    sync_status: 'manual',
    source_synced_at: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

describe('HardwareStockPanel', () => {
  it('materialises only stocked locations and removes manual catalogue ordering', () => {
    const alpha = makeHardwareItem('alpha', 'Alpha Hardware');
    const zulu = makeHardwareItem('zulu', 'Zulu Hardware');
    const stockedLocation = makeLocation('stocked', 'Stocked Yard');
    const emptyLocation = makeLocation('empty', 'Empty Yard');

    render(
      <HardwareStockPanel
        items={[zulu, alpha]}
        balances={[{
          id: 'balance-1',
          hardware_item_id: alpha.id,
          location_id: stockedLocation.id,
          quantity: 5,
          location: stockedLocation,
        }]}
        locations={[emptyLocation, stockedLocation]}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onAdjust={vi.fn()}
        onTransfer={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Stocked Yard').length).toBeGreaterThan(0);
    expect(screen.queryByText('Empty Yard')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sort order')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sort \d+/)).not.toBeInTheDocument();

    const catalogueNames = screen.getAllByText(/Hardware$/);
    const alphaIndex = catalogueNames.findIndex((node) => node.textContent === alpha.name);
    const zuluIndex = catalogueNames.findIndex((node) => node.textContent === zulu.name);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zuluIndex).toBeGreaterThan(alphaIndex);
  });
});
