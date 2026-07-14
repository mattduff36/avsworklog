/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HardwareOverviewPanel } from '@/app/(dashboard)/inventory/components/HardwareOverviewPanel';
import type {
  InventoryHardwareItem,
  InventoryLocation,
} from '@/app/(dashboard)/inventory/types';

interface MockInventoryLocationSelectProps {
  ariaLabel?: string;
  locations: InventoryLocation[];
  value: string;
}

vi.mock('@/app/(dashboard)/inventory/components/InventoryLocationSelect', () => ({
  InventoryLocationSelect: ({
    ariaLabel,
    locations,
    value,
  }: MockInventoryLocationSelectProps) => (
    <button type="button" aria-label={ariaLabel}>
      {locations.find((location) => location.id === value)?.name || 'No destination'}
    </button>
  ),
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

function makeLocation(
  id: string,
  name: string,
  locationType: InventoryLocation['location_type'] = 'manual',
): InventoryLocation {
  return {
    id,
    name,
    description: null,
    is_active: true,
    linked_van_id: null,
    linked_hgv_id: null,
    linked_plant_id: null,
    location_type: locationType,
    source_type: locationType === 'manual' ? 'manual' : 'system',
    source_id: null,
    external_reference: null,
    sync_status: locationType === 'manual' ? 'manual' : 'synced',
    source_synced_at: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

describe('HardwareOverviewPanel', () => {
  const yard = makeLocation('yard', 'Yard', 'yard');
  const van = makeLocation('van-7', 'Van - TE57 VAN', 'van');
  const cones = makeHardwareItem('cones', 'Cones');
  const plates = makeHardwareItem('plates', 'Road Plates');

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: yard }),
    } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows all active items, company totals, expansion, search, and Yard-zero filtering', () => {
    render(
      <HardwareOverviewPanel
        items={[plates, cones]}
        balances={[
          {
            id: 'cones-yard',
            hardware_item_id: cones.id,
            location_id: yard.id,
            quantity: 24,
            location: yard,
          },
          {
            id: 'cones-van',
            hardware_item_id: cones.id,
            location_id: van.id,
            quantity: 7,
            location: van,
          },
          {
            id: 'plates-van',
            hardware_item_id: plates.id,
            location_id: van.id,
            quantity: 5,
            location: van,
          },
        ]}
        locations={[yard, van]}
        onAdjust={vi.fn()}
        onTransfer={vi.fn()}
      />,
    );

    expect(screen.getByText('31 total')).toBeInTheDocument();
    expect(screen.getByText('5 total')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cones/i }));
    const balances = screen.getByRole('table', {
      name: 'Locations and quantities for Cones',
    });
    expect(within(balances).getByText('Yard')).toBeInTheDocument();
    expect(within(balances).getByText('Van - TE57 VAN')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search Hardware or location...'), {
      target: { value: 'Road' },
    });
    expect(screen.queryByRole('button', { name: /cones/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /road plates/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search Hardware or location...'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show only items with zero Yard stock' }));
    expect(screen.queryByRole('button', { name: /cones/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /road plates/i })).toBeInTheDocument();
  });

  it('selects eligible non-Yard balances for remove and recount operations', async () => {
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(
      <HardwareOverviewPanel
        items={[plates]}
        balances={[{
          id: 'plates-van',
          hardware_item_id: plates.id,
          location_id: van.id,
          quantity: 5,
          location: van,
        }]}
        locations={[yard, van]}
        onAdjust={onAdjust}
        onTransfer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /road plates/i }));
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Select Road Plates, quantity 5, at Van - TE57 VAN',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply Adjustment' }));

    await waitFor(() => {
      expect(onAdjust).toHaveBeenCalledWith({
        operation_type: 'remove',
        reason: 'Used',
        note: '',
        lines: [{
          item_id: plates.id,
          location_id: van.id,
          quantity: 2,
        }],
      });
    });
  });

  it('adds stock to a zero-total item and opens the transfer workflow', async () => {
    const emptyItem = makeHardwareItem('empty', 'Empty Hardware');
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(
      <HardwareOverviewPanel
        items={[emptyItem]}
        balances={[]}
        locations={[yard, van]}
        onAdjust={onAdjust}
        onTransfer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add stock' }));
    const addDialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(within(addDialog).getByRole('button', { name: 'Destination location' })).toHaveTextContent('Yard');
    });
    fireEvent.change(within(addDialog).getByLabelText('Quantity'), { target: { value: '12' } });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add stock' }));

    await waitFor(() => {
      expect(onAdjust).toHaveBeenCalledWith({
        operation_type: 'add',
        reason: 'Delivery',
        note: '',
        lines: [{
          item_id: emptyItem.id,
          location_id: yard.id,
          quantity: 12,
        }],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Transfer Stock' }));
    expect(screen.getByRole('heading', { name: 'Transfer Hardware' })).toBeInTheDocument();
  });
});
