/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useState } from 'react';
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

function RichLocationSelectHarness() {
  const [value, setValue] = useState('');

  return (
    <InventoryLocationSelect
      value={value}
      onValueChange={setValue}
      locations={[assignedLocation]}
      getOptionDescription={(location) => (
        `${location.location_type.toUpperCase()} · ${location.linked_asset_label} · ${location.assigned_user_names?.join(', ')}`
      )}
    />
  );
}

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

  it('renders contextual second-line details in options and the selected trigger', () => {
    render(<RichLocationSelectHarness />);

    fireEvent.click(screen.getByRole('combobox'));
    const option = screen.getByRole('option', {
      name: /\[FE24 TYH - Jeff Mark\] - Matt Duffill.*VAN.*FE24 TYH.*Matt Duffill/i,
    });
    expect(option).toBeInTheDocument();
    expect(option).toHaveAttribute('data-location-type', 'van');
    expect(option).toHaveClass('bg-[hsl(var(--inspection-primary)/0.08)]');
    fireEvent.click(option);

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('VAN · FE24 TYH · Matt Duffill');
    expect(trigger).toHaveClass('bg-[hsl(var(--inspection-primary)/0.10)]');
  });

  it('uses the visible viewport for the mobile location picker', async () => {
    const viewportListeners = new Map<string, Set<EventListener>>();
    const visualViewport = {
      width: 390,
      height: 500,
      offsetTop: 40,
      offsetLeft: 0,
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        const listeners = viewportListeners.get(event) || new Set<EventListener>();
        listeners.add(listener);
        viewportListeners.set(event, listeners);
      }),
      removeEventListener: vi.fn((event: string, listener: EventListener) => {
        viewportListeners.get(event)?.delete(listener);
      }),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 639px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    vi.stubGlobal('visualViewport', visualViewport);

    render(
      <InventoryLocationSelect
        value=""
        onValueChange={vi.fn()}
        locations={[assignedLocation]}
      />,
    );

    fireEvent.click(screen.getByRole('combobox'));
    const picker = await screen.findByRole('dialog', { name: 'Choose inventory location' });
    expect(picker).toHaveAttribute('data-mobile-scroll-lock', 'true');
    expect(picker.style.position).toBe('absolute');
    expect(picker.style.zIndex).toBe('1');
    expect(picker.parentElement).toHaveAttribute('data-mobile-location-picker-layer', 'true');
    expect(picker.parentElement?.style.zIndex).toBe('220');
    expect(picker.style.height).toContain('484px');
    expect(screen.getByRole('listbox', { name: 'Inventory locations' }))
      .toHaveAttribute('data-mobile-scroll-lock', 'true');

    visualViewport.height = 320;
    viewportListeners.get('resize')?.forEach((listener) => listener(new Event('resize')));

    await waitFor(() => {
      expect(picker.style.height).toContain('304px');
    });
  });

  it('keeps touch selection stable while the mobile keyboard is open', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 639px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    render(<RichLocationSelectHarness />);

    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', {
      name: /\[FE24 TYH - Jeff Mark\] - Matt Duffill.*VAN.*FE24 TYH.*Matt Duffill/i,
    });

    expect(fireEvent.pointerDown(option, { pointerType: 'touch' })).toBe(false);
    fireEvent.click(option);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose inventory location' }))
        .not.toBeInTheDocument();
    });
    expect(screen.getByRole('combobox')).toHaveTextContent('VAN · FE24 TYH · Matt Duffill');
  });
});
