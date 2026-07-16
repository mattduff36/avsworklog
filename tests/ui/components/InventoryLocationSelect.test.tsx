/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryLocationSelect } from '@/app/(dashboard)/inventory/components/InventoryLocationSelect';
import type { InventoryLocation } from '@/app/(dashboard)/inventory/types';

const assignedLocation: InventoryLocation = {
  id: 'assigned-location',
  name: 'Van Stock',
  description: null,
  is_active: true,
  linked_van_id: 'van-id',
  linked_hgv_id: null,
  linked_plant_id: null,
  location_type: 'van',
  source_type: 'fleet',
  source_id: null,
  external_reference: null,
  sync_status: 'synced',
  source_synced_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  created_by: null,
  updated_by: null,
  linked_asset_type: 'van',
  linked_asset_label: 'FE24 TYH',
  linked_asset_nickname: 'Jeff Mark',
  assigned_user_names: ['Matt Duffill'],
};

describe('InventoryLocationSelect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps known locations searchable by assigned person during server search', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ locations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <InventoryLocationSelect
        value=""
        onValueChange={vi.fn()}
        locations={[assignedLocation]}
        serverSearch
      />,
    );

    fireEvent.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', {
      name: /\[FE24 TYH - Jeff Mark\] - Matt Duffill/i,
    })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search locations...'), {
      target: { value: 'Matt Duffill' },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('search=Matt+Duffill'),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('option', {
        name: /\[FE24 TYH - Jeff Mark\] - Matt Duffill/i,
      })).toBeInTheDocument();
    });
  });
});
