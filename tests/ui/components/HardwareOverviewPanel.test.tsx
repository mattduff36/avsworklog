/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('shows every active item without stock actions or Yard filtering', () => {
    const emptyItem = makeHardwareItem('empty', 'Empty Hardware');
    render(
      <HardwareOverviewPanel
        items={[plates, cones, emptyItem]}
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
        onTransfer={vi.fn()}
      />,
    );

    expect(screen.getByText('31 total')).toBeInTheDocument();
    expect(screen.getByText('5 total')).toBeInTheDocument();
    expect(screen.getByText('0 total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cones/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /road plates/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /empty hardware/i })).toBeInTheDocument();
    expect(screen.queryByText('Yard stock = 0')).not.toBeInTheDocument();
    expect(screen.queryByText(/selected$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recount' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add stock' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cones/i }));
    const balances = screen.getByRole('table', {
      name: 'Locations and quantities for Cones',
    });
    expect(within(balances).getByText('Yard')).toBeInTheDocument();
    expect(within(balances).getByText('Van - TE57 VAN')).toBeInTheDocument();
    expect(within(balances).getByText('Yard').closest('[data-location-type="yard"]'))
      .toHaveClass('bg-[hsl(var(--workshop-primary)/0.10)]');
    expect(within(balances).getByText('Van - TE57 VAN').closest('[data-location-type="van"]'))
      .toHaveClass('bg-[hsl(var(--inspection-primary)/0.10)]');

    fireEvent.change(screen.getByPlaceholderText('Search Hardware or location...'), {
      target: { value: 'Cones' },
    });
    expect(screen.getByRole('button', { name: /cones/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /road plates/i })).not.toBeInTheDocument();
  });

  it('opens the transfer workflow', () => {
    const emptyItem = makeHardwareItem('empty', 'Empty Hardware');
    render(
      <HardwareOverviewPanel
        items={[emptyItem]}
        balances={[]}
        locations={[yard, van]}
        onTransfer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transfer Stock' }));
    expect(screen.getByRole('heading', { name: 'Transfer Hardware' })).toBeInTheDocument();
  });

  it('prefills the Hardware item and source from a location Move action', () => {
    render(
      <HardwareOverviewPanel
        items={[cones]}
        balances={[{
          id: 'cones-yard',
          hardware_item_id: cones.id,
          location_id: yard.id,
          quantity: 24,
          location: yard,
        }]}
        locations={[yard, van]}
        onTransfer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cones/i }));
    const balances = screen.getByRole('table', {
      name: 'Locations and quantities for Cones',
    });
    fireEvent.click(within(balances).getByRole('button', { name: 'Move' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-w-3xl');
    expect(within(dialog).getByRole('combobox', { name: 'Hardware item' })).toHaveTextContent('Cones');
    expect(within(dialog).getByRole('button', { name: 'Source location' })).toHaveTextContent('Yard');
    expect(within(dialog).queryByLabelText(/note/i)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Quantity')).toHaveValue(null);
  });

  it('does not search legacy quote locations until explicitly enabled', () => {
    const legacySite: InventoryLocation = {
      ...makeLocation('legacy-site', 'Legacy quote - 9999'),
      location_type: 'site',
      source_type: 'legacy_quote',
    };
    render(
      <HardwareOverviewPanel
        items={[cones, plates]}
        balances={[
          {
            id: 'cones-legacy',
            hardware_item_id: cones.id,
            location_id: legacySite.id,
            quantity: 4,
            location: legacySite,
          },
          {
            id: 'plates-van',
            hardware_item_id: plates.id,
            location_id: van.id,
            quantity: 5,
            location: van,
          },
        ]}
        locations={[legacySite, van]}
        onTransfer={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search Hardware or location...'), {
      target: { value: '9999' },
    });
    expect(screen.queryByRole('button', { name: /cones/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Include legacy locations' }));
    expect(screen.getByRole('button', { name: /cones/i })).toBeInTheDocument();
  });
});
