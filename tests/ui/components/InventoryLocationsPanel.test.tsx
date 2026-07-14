/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryLocationsPanel } from '@/app/(dashboard)/inventory/components/InventoryLocationsPanel';

const yardLocation = {
  id: 'yard',
  name: 'Main Yard',
  description: null,
  is_active: true,
  linked_van_id: null,
  linked_hgv_id: null,
  linked_plant_id: null,
  location_type: 'yard' as const,
  source_type: 'system' as const,
  source_id: null,
  external_reference: null,
  sync_status: 'synced' as const,
  source_synced_at: null,
  item_count: 4,
  created_at: '2026-07-14T00:00:00.000Z',
  updated_at: '2026-07-14T00:00:00.000Z',
  created_by: null,
  updated_by: null,
};

describe('InventoryLocationsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not request or render locations below three characters', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <InventoryLocationsPanel
        fleetAssets={[]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search inventory locations'), {
      target: { value: 'ya' },
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Enter at least 3 characters to search locations.')).toBeInTheDocument();
  });

  it('searches after the threshold and clears stale results below it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ locations: [yardLocation] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <InventoryLocationsPanel
        fleetAssets={[]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Search inventory locations');
    fireEvent.change(input, { target: { value: 'yard' } });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inventory/locations?search=yard&limit=50',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
    expect(screen.getAllByText('Main Yard').length).toBeGreaterThan(0);

    fireEvent.change(input, { target: { value: 'ya' } });

    expect(screen.queryByText('Main Yard')).not.toBeInTheDocument();
    expect(screen.getByText('Enter at least 3 characters to search locations.')).toBeInTheDocument();
  });
});
