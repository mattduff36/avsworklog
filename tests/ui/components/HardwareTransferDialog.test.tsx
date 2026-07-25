/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HardwareTransferDialog } from '@/app/(dashboard)/inventory/components/HardwareTransferDialog';
import type {
  InventoryHardwareItem,
  InventoryLocation,
} from '@/app/(dashboard)/inventory/types';

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
    linked_van_id: locationType === 'van' ? id : null,
    linked_hgv_id: null,
    linked_plant_id: null,
    location_type: locationType,
    source_type: locationType === 'van' ? 'fleet' : 'system',
    source_id: null,
    external_reference: null,
    sync_status: 'synced',
    source_synced_at: null,
    created_at: '2026-07-21T00:00:00.000Z',
    updated_at: '2026-07-21T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    linked_asset_type: locationType === 'van' ? 'van' : null,
    linked_asset_label: locationType === 'van' ? 'TE57 VAN' : null,
    linked_asset_nickname: locationType === 'van' ? 'Service Van' : null,
    assigned_user_names: locationType === 'van' ? ['Alex Smith'] : [],
  };
}

describe('HardwareTransferDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses rich location options and submits a prefilled transfer without a note', async () => {
    const cones: InventoryHardwareItem = {
      id: 'cones',
      name: 'Cones',
      name_normalized: 'cones',
      is_active: true,
      created_at: '2026-07-21T00:00:00.000Z',
      updated_at: '2026-07-21T00:00:00.000Z',
      created_by: null,
      updated_by: null,
    };
    const yard = makeLocation('yard', 'Yard', 'yard');
    const van = makeLocation('van', 'Van - TE57 VAN', 'van');
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <HardwareTransferDialog
        open
        items={[cones]}
        balances={[{
          id: 'cones-yard',
          hardware_item_id: cones.id,
          location_id: yard.id,
          quantity: 24,
          location: yard,
        }]}
        locations={[yard, van]}
        prefill={{ itemId: cones.id, fromLocationId: yard.id }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/note/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Source location' }))
      .toHaveTextContent('24 available');

    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Destination location' }));
    const destination = screen.getByRole('option', { name: /Service Van.*Van.*Alex Smith/i });
    fireEvent.click(destination);
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        lines: [{
          item_id: cones.id,
          from_location_id: yard.id,
          to_location_id: van.id,
          quantity: 5,
        }],
      });
    });
  });

  it('scrolls the focused field above the keyboard without resizing the footer', async () => {
    const resizeListeners = new Set<EventListener>();
    const visualViewport = {
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        if (event === 'resize') resizeListeners.add(listener);
      }),
      removeEventListener: vi.fn((event: string, listener: EventListener) => {
        if (event === 'resize') resizeListeners.delete(listener);
      }),
    };
    vi.stubGlobal('innerHeight', 844);
    vi.stubGlobal('visualViewport', visualViewport);

    render(
      <HardwareTransferDialog
        open
        items={[]}
        balances={[]}
        locations={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const scrollArea = dialog.querySelector<HTMLElement>('[data-hardware-transfer-scroll-area="true"]');
    const quantityInput = within(dialog).getByLabelText('Quantity');
    const scrollBy = vi.fn();
    if (!scrollArea) throw new Error('Hardware transfer scroll area was not rendered');
    Object.defineProperty(scrollArea, 'scrollBy', { configurable: true, value: scrollBy });
    vi.spyOn(quantityInput, 'getBoundingClientRect').mockReturnValue({
      bottom: 700,
    } as DOMRect);

    expect(dialog).toHaveAttribute('data-mobile-keyboard-resize', 'false');
    fireEvent.focus(quantityInput);
    visualViewport.height = 400;
    resizeListeners.forEach((listener) => listener(new Event('resize')));

    await waitFor(() => {
      expect(scrollArea?.style.getPropertyValue('--hardware-transfer-keyboard-overlap')).toBe('444px');
      expect(scrollBy).toHaveBeenCalledWith({
        top: 316,
        behavior: 'smooth',
      });
    });
  });
});
