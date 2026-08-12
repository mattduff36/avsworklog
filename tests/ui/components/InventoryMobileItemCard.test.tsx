/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryMobileItemCard } from '@/app/(dashboard)/inventory/components/InventoryMobileItemCard';
import type { InventoryItem } from '@/app/(dashboard)/inventory/types';

const baseItem: InventoryItem = {
  id: 'item-1',
  item_number: 'AV5879',
  item_number_normalized: 'av5879',
  name: '110V 3 Way Splitter',
  category: 'tools',
  location_id: 'yard',
  location: {
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
    created_at: '2026-07-05T00:00:00.000Z',
    updated_at: '2026-07-05T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  },
  last_checked_at: '2024-09-04',
  check_interval_days: 180,
  status: 'active',
  retired_at: null,
  retire_reason: null,
  retired_by: null,
  source: null,
  source_reference: null,
  created_at: '2026-07-05T00:00:00.000Z',
  updated_at: '2026-07-05T00:00:00.000Z',
  created_by: null,
  updated_by: null,
};

describe('InventoryMobileItemCard', () => {
  it('INV-MOBILE-005/006: opens item details on activation, Move does not trigger navigation', () => {
    const onOpenDetails = vi.fn();
    const onMove = vi.fn();

    render(
      <InventoryMobileItemCard
        item={baseItem}
        onOpenDetails={onOpenDetails}
        onMove={onMove}
        selected={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open 110V 3 Way Splitter details/i }));
    expect(onOpenDetails).toHaveBeenCalledWith(baseItem);

    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(onMove).toHaveBeenCalledWith(baseItem);
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });

  it('INV-MOBILE-007: overflow Retire action opens the retire workflow without triggering navigation', async () => {
    const onOpenDetails = vi.fn();
    const onRetire = vi.fn();

    render(
      <InventoryMobileItemCard
        item={baseItem}
        onOpenDetails={onOpenDetails}
        onRetire={onRetire}
      />,
    );

    const trigger = screen.getByRole('button', { name: /More actions/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByText('Retire item')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Retire item'));

    expect(onRetire).toHaveBeenCalledWith(baseItem);
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('INV-MOBILE-008: retired cards expose Restore where permitted and hide Move/overflow', () => {
    const onRestore = vi.fn();
    const retiredItem: InventoryItem = { ...baseItem, status: 'retired', retire_reason: 'Sold', retired_at: '2026-01-01T00:00:00.000Z' };

    render(
      <InventoryMobileItemCard
        item={retiredItem}
        retiredMode
        onRestore={onRestore}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledWith(retiredItem);
  });

  it('selection checkbox toggles without triggering card navigation', () => {
    const onOpenDetails = vi.fn();
    const onToggleSelected = vi.fn();

    render(
      <InventoryMobileItemCard
        item={baseItem}
        onOpenDetails={onOpenDetails}
        onToggleSelected={onToggleSelected}
        selected={false}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Select 110V 3 Way Splitter/i }));
    expect(onToggleSelected).toHaveBeenCalledWith(true);
    expect(onOpenDetails).not.toHaveBeenCalled();
  });
});
