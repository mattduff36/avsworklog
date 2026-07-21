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
  locationType: InventoryLocation['location_type'],
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
}

describe('HardwareStockPanel', () => {
  const yard = makeLocation('yard', 'Yard', 'yard');
  const van = makeLocation('van-7', 'Van - TE57 VAN', 'van');
  const site = makeLocation('site', 'Empty Site', 'site');

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: yard }),
    } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows every active item with positive balances at all locations', () => {
    const explicitZero = makeHardwareItem('explicit-zero', 'Explicit Zero');
    const missingYard = makeHardwareItem('missing-yard', 'Missing Yard');
    const positiveYard = makeHardwareItem('positive-yard', 'Positive Yard');

    render(
      <HardwareStockPanel
        items={[positiveYard, missingYard, explicitZero]}
        balances={[
          {
            id: 'explicit-yard',
            hardware_item_id: explicitZero.id,
            location_id: yard.id,
            quantity: 0,
            location: yard,
          },
          {
            id: 'explicit-van',
            hardware_item_id: explicitZero.id,
            location_id: van.id,
            quantity: 5,
            location: van,
          },
          {
            id: 'explicit-site',
            hardware_item_id: explicitZero.id,
            location_id: site.id,
            quantity: 0,
            location: site,
          },
          {
            id: 'positive-yard',
            hardware_item_id: positiveYard.id,
            location_id: yard.id,
            quantity: 2,
            location: yard,
          },
        ]}
        locations={[yard, van, site]}
        onAdjust={vi.fn()}
      />,
    );

    const matrix = screen.getByRole('table', {
      name: 'All active Hardware items',
    });
    expect(matrix).toHaveClass('min-w-[900px]', 'table-fixed');
    expect(within(matrix).getByRole('columnheader', { name: 'Total' }))
      .toHaveClass('w-[15%]', 'text-center');
    expect(within(matrix).getByRole('columnheader', { name: 'Actions' }))
      .toHaveClass('w-[30%]', 'text-right');
    expect(within(matrix).getByRole('button', { name: 'Explicit Zero' })).toBeInTheDocument();
    expect(within(matrix).getByRole('button', { name: 'Missing Yard' })).toBeInTheDocument();
    expect(within(matrix).getByRole('button', { name: 'Positive Yard' })).toBeInTheDocument();
    expect(within(matrix).getAllByRole('button', { name: /Add .* stock/ })).toHaveLength(3);
    expect(within(matrix).getByRole('button', {
      name: 'Remove Missing Yard stock',
    })).toBeDisabled();
    expect(within(matrix).getByRole('button', {
      name: 'Recount Missing Yard stock',
    })).toBeEnabled();
    expect(within(matrix).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Select an item to adjust all shown locations/i)).not.toBeInTheDocument();

    fireEvent.click(within(matrix).getByRole('button', { name: 'Explicit Zero' }));
    const balances = within(matrix).getByRole('table', {
      name: 'Location balances for Explicit Zero',
    });
    expect(within(balances).getByRole('columnheader', { name: 'Location' })).toBeInTheDocument();
    expect(within(balances).getByRole('columnheader', { name: 'Quantity' })).toBeInTheDocument();
    expect(within(balances).getByRole('row', { name: /Van - TE57 VAN 5/ })).toBeInTheDocument();
    expect(within(balances).queryByText('Yard')).not.toBeInTheDocument();
    expect(within(balances).queryByText('Empty Site')).not.toBeInTheDocument();

    fireEvent.click(within(matrix).getByRole('button', { name: 'Missing Yard' }));
    expect(within(matrix).getByText('No positive stock is currently held.')).toBeInTheDocument();

    fireEvent.click(within(matrix).getByRole('button', { name: 'Positive Yard' }));
    const yardBalances = within(matrix).getByRole('table', {
      name: 'Location balances for Positive Yard',
    });
    expect(within(yardBalances).getByRole('row', { name: /Yard 2/ })).toBeInTheDocument();
  });

  it('adds stock from an accessible settings item action', async () => {
    const item = makeHardwareItem('cones', 'Cones');
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(
      <HardwareStockPanel
        items={[item]}
        balances={[]}
        locations={[yard, van]}
        onAdjust={onAdjust}
      />,
    );

    const addStockButton = screen.getByRole('button', { name: 'Add Cones stock' });
    expect(addStockButton).toHaveClass('bg-inventory', 'text-white', 'hover:bg-inventory-dark');
    fireEvent.click(addStockButton);
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
          item_id: item.id,
          location_id: yard.id,
          quantity: 12,
        }],
      });
    });
  });

  it('removes stock directly from an item action', async () => {
    const item = makeHardwareItem('plates', 'Road Plates');
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(
      <HardwareStockPanel
        items={[item]}
        balances={[{
          id: 'plates-van',
          hardware_item_id: item.id,
          location_id: van.id,
          quantity: 5,
          location: van,
        }]}
        locations={[yard, van]}
        onAdjust={onAdjust}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Road Plates stock' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Adjustment location' })).toHaveTextContent(
      'Van - TE57 VAN',
    );
    expect(within(dialog).getByText('Available: 5')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove stock' }));

    await waitFor(() => {
      expect(onAdjust).toHaveBeenCalledWith({
        operation_type: 'remove',
        reason: 'Used',
        note: '',
        lines: [{
          item_id: item.id,
          location_id: van.id,
          quantity: 2,
        }],
      });
    });
  });

  it('recounts a zero-stock item directly from its item action', async () => {
    const item = makeHardwareItem('generator', 'Generator');
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(
      <HardwareStockPanel
        items={[item]}
        balances={[]}
        locations={[yard, van]}
        onAdjust={onAdjust}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recount Generator stock' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Adjustment location' })).toHaveTextContent('Yard');
    fireEvent.change(within(dialog).getByLabelText('New counted quantity'), {
      target: { value: '0' },
    });
    const saveRecountButton = within(dialog).getByRole('button', { name: 'Save recount' });
    expect(saveRecountButton).toHaveClass('bg-inventory', 'text-white', 'hover:bg-inventory-dark');
    fireEvent.click(saveRecountButton);

    await waitFor(() => {
      expect(onAdjust).toHaveBeenCalledWith({
        operation_type: 'recount',
        reason: 'Stocktake correction',
        note: '',
        lines: [{
          item_id: item.id,
          location_id: yard.id,
          quantity: 0,
        }],
      });
    });
  });
});
