/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HardwareStockPanel } from '@/app/(dashboard)/inventory/components/HardwareStockPanel';
import type {
  InventoryHardwareItem,
  InventoryLocation,
} from '@/app/(dashboard)/inventory/types';

interface MockInventoryLocationSelectProps {
  ariaLabel?: string;
  locations: InventoryLocation[];
  value: string;
  onValueChange: (value: string) => void;
}

vi.mock('@/app/(dashboard)/inventory/components/InventoryLocationSelect', () => ({
  InventoryLocationSelect: ({
    ariaLabel,
    locations,
    value,
    onValueChange,
  }: MockInventoryLocationSelectProps) => {
    const selected = locations.find((location) => location.id === value);
    const alternative = locations.find((location) => location.id !== value);
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => {
          if (alternative) onValueChange(alternative.id);
        }}
      >
        {selected?.name || 'No destination'}
      </button>
    );
  },
}));

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
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: makeLocation('yard-default', 'Yard') }),
    } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits zero-total locations while retaining zero-stock catalogue items', () => {
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
    expect(screen.getAllByText('Zulu Hardware').length).toBeGreaterThan(0);
    expect(screen.getByText('Total: 0 units')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add stock' })).toHaveLength(2);
    expect(screen.queryByLabelText('Sort order')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sort \d+/)).not.toBeInTheDocument();
    expect(screen.getByText('Alpha Hardware (5)')).toBeInTheDocument();
    expect(screen.getByText('Zulu Hardware (0)')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Quantity' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alpha Hardware, quantity 5')).toBeInTheDocument();

    const catalogueNames = screen.getAllByText(/Hardware$/);
    const alphaIndex = catalogueNames.findIndex((node) => node.textContent === alpha.name);
    const zuluIndex = catalogueNames.findIndex((node) => node.textContent === zulu.name);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zuluIndex).toBeGreaterThan(alphaIndex);
  });

  it('adds a positive whole-number delivery from a zero-stock catalogue row', async () => {
    const item = makeHardwareItem('cones', 'Cones');
    const destination = makeLocation('empty', 'Empty Yard');
    const onAdjust = vi.fn().mockResolvedValue(undefined);

    render(
      <HardwareStockPanel
        items={[item]}
        balances={[]}
        locations={[destination]}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onAdjust={onAdjust}
        onTransfer={vi.fn()}
      />,
    );

    expect(screen.getByText('Total: 0 units')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add stock' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Destination location' })).toHaveTextContent('Yard');
    });
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add stock' }));

    await waitFor(() => {
      expect(onAdjust).toHaveBeenCalledWith({
        operation_type: 'add',
        reason: 'Delivery',
        note: '',
        lines: [{
          item_id: 'cones',
          location_id: 'yard-default',
          quantity: 12,
        }],
      });
    });
  });

  it('uses the shared Yard-defaulted dialog for matrix stock entry', async () => {
    const item = makeHardwareItem('cones', 'Cones');
    const yard = makeLocation('stocked-yard', 'Yard');
    const onAdjust = vi.fn().mockResolvedValue(undefined);

    render(
      <HardwareStockPanel
        items={[item]}
        balances={[{
          id: 'balance-1',
          hardware_item_id: item.id,
          location_id: yard.id,
          quantity: 10,
          location: yard,
        }]}
        locations={[yard]}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onAdjust={onAdjust}
        onTransfer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Select Cones, quantity 10, at Yard',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Add Hardware Quantity' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Destination location' })).toHaveTextContent('Yard');
    });
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '6' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply Adjustment' }));

    await waitFor(() => {
      expect(onAdjust).toHaveBeenCalledWith({
        operation_type: 'add',
        reason: 'Delivery',
        note: '',
        lines: [{
          item_id: 'cones',
          location_id: 'yard-default',
          quantity: 6,
        }],
      });
    });
  });
});
