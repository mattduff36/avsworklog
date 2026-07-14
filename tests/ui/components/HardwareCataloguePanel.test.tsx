/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HardwareCataloguePanel } from '@/app/(dashboard)/inventory/components/HardwareCataloguePanel';
import type { InventoryHardwareItem } from '@/app/(dashboard)/inventory/types';

function makeHardwareItem(
  id: string,
  name: string,
  isActive = true,
): InventoryHardwareItem {
  return {
    id,
    name,
    name_normalized: name.toLowerCase(),
    is_active: isActive,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    created_by: null,
    updated_by: null,
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

  it('blocks archiving stocked items and restores archived items', () => {
    const stocked = makeHardwareItem('stocked', 'Stocked');
    const archived = makeHardwareItem('archived', 'Archived', false);
    const onUpdateItem = vi.fn().mockResolvedValue(undefined);

    render(
      <HardwareCataloguePanel
        items={[stocked, archived]}
        balances={[{
          id: 'stocked-balance',
          hardware_item_id: stocked.id,
          location_id: 'yard',
          quantity: 1,
        }]}
        onCreateItem={vi.fn()}
        onUpdateItem={onUpdateItem}
      />,
    );

    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onUpdateItem).toHaveBeenCalledWith(archived, { is_active: true });
  });
});
