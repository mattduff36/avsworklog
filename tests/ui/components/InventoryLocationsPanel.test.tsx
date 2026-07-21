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

  it('loads the first directory page immediately and appends more locations', async () => {
    const secondLocation = {
      ...yardLocation,
      id: 'site',
      name: 'North Site',
      location_type: 'site' as const,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          locations: [yardLocation],
          pagination: { offset: 0, limit: 25, total: 2, has_more: true },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          locations: [secondLocation],
          pagination: { offset: 1, limit: 25, total: 2, has_more: false },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <InventoryLocationsPanel
        fleetAssets={[]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inventory/locations?search=&limit=25&offset=0',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
    expect(screen.getAllByText('Main Yard').length).toBeGreaterThan(0);
    expect(screen.getByText('Showing 1 of 2 locations')).toBeInTheDocument();
    expect(document.querySelector('tr[data-location-type="yard"]')).toHaveClass(
      'bg-[hsl(var(--workshop-primary)/0.10)]',
    );
    const mobileYardCard = [...document.querySelectorAll('div[data-location-type="yard"]')]
      .find((element) => element.classList.contains('rounded-lg'));
    expect(mobileYardCard).toHaveClass('border-[hsl(var(--workshop-primary)/0.32)]');
    const yardBadge = [...document.querySelectorAll('[data-location-type="yard"]')]
      .find((element) => element.classList.contains('rounded-full'));
    expect(yardBadge).toHaveClass('text-[hsl(var(--workshop-light))]');

    fireEvent.click(screen.getByRole('button', { name: 'Show More' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getAllByText('North Site').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/inventory/locations?search=&limit=25&offset=1',
      { cache: 'no-store' },
    );
  });

  it('searches from the first character and resets the directory page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        locations: [yardLocation],
        pagination: { offset: 0, limit: 25, total: 1, has_more: false },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <InventoryLocationsPanel
        fleetAssets={[]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    fireEvent.change(screen.getByLabelText('Search inventory locations'), {
      target: { value: 'y' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inventory/locations?search=y&limit=25&offset=0',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
    expect(screen.getAllByText('Main Yard').length).toBeGreaterThan(0);
  });
});
