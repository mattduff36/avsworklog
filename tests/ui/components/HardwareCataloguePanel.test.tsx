/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HardwareCataloguePanel } from '@/app/(dashboard)/inventory/components/HardwareCataloguePanel';
import type { InventoryHardwareItem } from '@/app/(dashboard)/inventory/types';

function makeHardwareItem(
  id: string,
  name: string,
  canDelete?: boolean,
): InventoryHardwareItem {
  return {
    id,
    name,
    name_normalized: name.toLowerCase(),
    is_active: true,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    can_delete: canDelete,
  };
}

describe('HardwareCataloguePanel', () => {
  it('shows an alphabetical catalogue without operational stock actions', () => {
    const alpha = makeHardwareItem('alpha', 'Alpha Hardware');
    const zulu = makeHardwareItem('zulu', 'Zulu Hardware');

    render(
      <HardwareCataloguePanel
        items={[zulu, alpha]}
        balances={[{
          id: 'alpha-balance',
          hardware_item_id: alpha.id,
          location_id: 'yard',
          quantity: 5,
        }]}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    const names = screen.getAllByText(/Hardware$/);
    expect(names.findIndex((node) => node.textContent === alpha.name))
      .toBeLessThan(names.findIndex((node) => node.textContent === zulu.name));
    expect(screen.getByText('Total stock: 5 units')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add stock/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transfer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recount/i })).not.toBeInTheDocument();
  });

  it('creates and renames catalogue items', async () => {
    const item = makeHardwareItem('cones', 'Cones');
    const onCreateItem = vi.fn().mockResolvedValue(undefined);
    const onUpdateItem = vi.fn().mockResolvedValue(undefined);

    render(
      <HardwareCataloguePanel
        items={[item]}
        balances={[]}
        onCreateItem={onCreateItem}
        onUpdateItem={onUpdateItem}
        onRemoveItem={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Road Plates' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    await waitFor(() => {
      expect(onCreateItem).toHaveBeenCalledWith({ name: 'Road Plates' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Traffic Cones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith(item, { name: 'Traffic Cones' });
    });
  });

  it('shows the category-style delete icon only for unused items', () => {
    const stocked = makeHardwareItem('stocked', 'Stocked', false);
    const unused = makeHardwareItem('unused', 'Unused', true);
    const onRemoveItem = vi.fn().mockResolvedValue(undefined);

    render(
      <HardwareCataloguePanel
        items={[stocked, unused]}
        balances={[{
          id: 'stocked-balance',
          hardware_item_id: stocked.id,
          location_id: 'yard',
          quantity: 1,
        }]}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onRemoveItem={onRemoveItem}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete Stocked' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Unused' }));
    expect(onRemoveItem).toHaveBeenCalledWith(unused);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });
});
