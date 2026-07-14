/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HardwareStockQuantityDialog,
  type HardwareStockQuantityDialogCopy,
} from '@/app/(dashboard)/inventory/components/HardwareStockQuantityDialog';
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

const copy: HardwareStockQuantityDialogCopy = {
  title: 'Add stock',
  description: 'Record incoming Hardware stock.',
  noteLabel: 'Delivery note',
  submitLabel: 'Add stock',
  submittingLabel: 'Adding stock...',
};

function makeItem(id = 'cones'): InventoryHardwareItem {
  return {
    id,
    name: 'Cones',
    name_normalized: 'cones',
    is_active: true,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

function makeLocation(id: string, name: string, locationType: InventoryLocation['location_type']): InventoryLocation {
  return {
    id,
    name,
    description: null,
    is_active: true,
    linked_van_id: null,
    linked_hgv_id: null,
    linked_plant_id: null,
    location_type: locationType,
    source_type: locationType === 'yard' ? 'system' : 'manual',
    source_id: null,
    external_reference: null,
    sync_status: locationType === 'yard' ? 'synced' : 'manual',
    source_synced_at: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

function mockYardLookup(location: InventoryLocation | null) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ location }),
  } as Response);
}

describe('HardwareStockQuantityDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the active Yard id and validates a positive whole quantity', async () => {
    const yard = makeLocation('yard-stable-id', 'Yard', 'yard');
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mockYardLookup(yard);

    render(
      <HardwareStockQuantityDialog
        open
        items={[makeItem()]}
        knownLocations={[]}
        copy={copy}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Add stock' });
    expect(submit).toBeDisabled();
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Destination location' })).toHaveTextContent('Yard');
    });

    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '1.5' } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '4' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        operation_type: 'add',
        reason: 'Delivery',
        note: '',
        lines: [{
          item_id: 'cones',
          location_id: 'yard-stable-id',
          quantity: 4,
        }],
      });
    });
  });

  it('allows the Yard default to be overridden', async () => {
    const yard = makeLocation('yard-stable-id', 'Yard', 'yard');
    const site = makeLocation('site-stable-id', 'North Site', 'site');
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mockYardLookup(yard);

    render(
      <HardwareStockQuantityDialog
        open
        items={[makeItem()]}
        knownLocations={[site]}
        copy={copy}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const locationButton = within(dialog).getByRole('button', { name: 'Destination location' });
    await waitFor(() => expect(locationButton).toHaveTextContent('Yard'));
    fireEvent.click(locationButton);
    expect(locationButton).toHaveTextContent('North Site');
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add stock' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        lines: [expect.objectContaining({ location_id: 'site-stable-id' })],
      }));
    });
  });

  it('restores Yard and clears form state when reopened', async () => {
    const yard = makeLocation('yard-stable-id', 'Yard', 'yard');
    const site = makeLocation('site-stable-id', 'North Site', 'site');
    mockYardLookup(yard);

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open stock dialog</button>
          {open ? (
            <HardwareStockQuantityDialog
              open
              items={[makeItem()]}
              knownLocations={[site]}
              copy={copy}
              onClose={() => setOpen(false)}
              onSubmit={vi.fn().mockResolvedValue(undefined)}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    let dialog = screen.getByRole('dialog');
    const firstLocationButton = within(dialog).getByRole('button', { name: 'Destination location' });
    await waitFor(() => expect(firstLocationButton).toHaveTextContent('Yard'));
    fireEvent.click(firstLocationButton);
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '8' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Open stock dialog' }));
    dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Destination location' })).toHaveTextContent('Yard');
    });
    expect(within(dialog).getByLabelText('Quantity')).toHaveValue(null);
    expect(within(dialog).getByRole('button', { name: 'Add stock' })).toBeDisabled();
  });

  it('keeps the searchable fallback unselected when Yard is unavailable', async () => {
    const site = makeLocation('site-stable-id', 'North Site', 'site');
    mockYardLookup(null);
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <HardwareStockQuantityDialog
        open
        items={[makeItem()]}
        knownLocations={[site]}
        copy={copy}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const locationButton = within(dialog).getByRole('button', { name: 'Destination location' });
    await waitFor(() => expect(locationButton).toHaveTextContent('No destination'));
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '3' } });
    expect(within(dialog).getByRole('button', { name: 'Add stock' })).toBeDisabled();
    fireEvent.click(locationButton);
    expect(locationButton).toHaveTextContent('North Site');
    expect(within(dialog).getByRole('button', { name: 'Add stock' })).toBeEnabled();
  });
});
