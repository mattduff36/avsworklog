/** @vitest-environment happy-dom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkshopTaskLocationButton } from '@/components/workshop-tasks/WorkshopTaskLocationButton';
import { AssetWhereaboutsDialog } from '@/components/workshop-tasks/AssetWhereaboutsDialog';

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/workshop-tasks',
  useSearchParams: () => new URLSearchParams(),
}));

describe('workshop location UI proof', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the workshop brand loader while location details load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(
      <AssetWhereaboutsDialog
        open
        onOpenChange={vi.fn()}
        task={{ plant_id: '11111111-1111-4111-8111-111111111111' }}
        assetLabel="331"
      />
    );

    expect(await screen.findByLabelText('Loading location details...')).toBeInTheDocument();
  });

  it('WT-WHERE-UI-STOP does not open the task modal', () => {
    const onOpenTaskModal = vi.fn();
    const onOpenWhereabouts = vi.fn();
    render(
      <div onClick={onOpenTaskModal}>
        <WorkshopTaskLocationButton
          task={{ plant_id: 'plant-1' }}
          onOpen={onOpenWhereabouts}
        />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Location' }));
    expect(onOpenWhereabouts).toHaveBeenCalledTimes(1);
    expect(onOpenTaskModal).not.toHaveBeenCalled();
  });

  it('WT-WHERE-UI-LAZY-FLEET fetches only on open and hides the fleet link without access', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        asset: {
          id: '11111111-1111-4111-8111-111111111111',
          type: 'plant',
          label: '331',
          plantId: '331',
          regNumber: null,
        },
        lastCheckAt: '2026-09-03',
        lastDriverName: 'Jo Driver',
        lastDriverPhone: '01234 567890',
        meter: { value: 12, unit: 'hours', source: 'maintenance' },
        fleetHistoryHref: '/fleet/plant/plant-1/history',
        canOpenFleetHistory: false,
        events: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <AssetWhereaboutsDialog
        open={false}
        onOpenChange={vi.fn()}
        task={{ plant_id: '11111111-1111-4111-8111-111111111111' }}
        assetLabel="331"
      />
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <AssetWhereaboutsDialog
        open
        onOpenChange={vi.fn()}
        task={{ plant_id: '11111111-1111-4111-8111-111111111111' }}
        assetLabel="331"
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/workshop-tasks/assets/plant/11111111-1111-4111-8111-111111111111/whereabouts'
    );
    await waitFor(() => expect(screen.getByText('Jo Driver')).toBeInTheDocument());
    expect(screen.queryByText('Open fleet history')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        asset: {
          id: '11111111-1111-4111-8111-111111111111',
          type: 'plant',
          label: '331',
          plantId: '331',
          regNumber: null,
        },
        lastCheckAt: '2026-09-03',
        lastDriverName: 'Jo Driver',
        lastDriverPhone: '01234 567890',
        meter: { value: 12, unit: 'hours', source: 'maintenance' },
        fleetHistoryHref: '/fleet/plant/plant-1/history',
        canOpenFleetHistory: true,
        events: [],
      }),
    });
    rerender(
      <AssetWhereaboutsDialog
        open={false}
        onOpenChange={vi.fn()}
        task={{ plant_id: '11111111-1111-4111-8111-111111111111' }}
        assetLabel="331"
      />
    );
    rerender(
      <AssetWhereaboutsDialog
        open
        onOpenChange={vi.fn()}
        task={{ plant_id: '11111111-1111-4111-8111-111111111111' }}
        assetLabel="331"
      />
    );
    await waitFor(() => expect(screen.getByText('Open fleet history')).toBeInTheDocument());
  });

  it('FD-WHERE-UI-001 ignores a stale payload when the selected asset changes', async () => {
    const plantId = '11111111-1111-4111-8111-111111111111';
    const vanId = '22222222-2222-4222-8222-222222222222';
    let resolvePlant: ((value: { ok: boolean; json: () => Promise<unknown> }) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/plant/${plantId}/`)) {
        return new Promise((resolve) => {
          resolvePlant = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          asset: { id: vanId, type: 'van', label: 'Van 12', plantId: null, regNumber: 'AB12CDE' },
          lastCheckAt: '2026-09-02',
          lastDriverName: 'Van Driver',
          lastDriverPhone: null,
          meter: null,
          fleetHistoryHref: `/fleet/vans/${vanId}/history`,
          canOpenFleetHistory: false,
          events: [],
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <AssetWhereaboutsDialog
        open
        onOpenChange={vi.fn()}
        task={{ plant_id: plantId }}
        assetLabel="331"
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <AssetWhereaboutsDialog
        open
        onOpenChange={vi.fn()}
        task={{ van_id: vanId }}
        assetLabel="Van 12"
      />
    );

    resolvePlant?.({
      ok: true,
      json: async () => ({
        asset: { id: plantId, type: 'plant', label: '331', plantId: '331', regNumber: null },
        lastCheckAt: '2026-09-03',
        lastDriverName: 'Plant Driver',
        lastDriverPhone: '01234 567890',
        meter: null,
        fleetHistoryHref: `/fleet/plant/${plantId}/history`,
        canOpenFleetHistory: false,
        events: [],
      }),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Van Driver')).toBeInTheDocument());
    expect(screen.queryByText('Plant Driver')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Location' })).toBeInTheDocument();
    expect(screen.getByText('Van 12')).toBeInTheDocument();
  });

  it('shows one primary location line per event and keeps driver in the summary only', async () => {
    const plantId = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        asset: { id: plantId, type: 'plant', label: '331', plantId: '331', regNumber: null },
        lastCheckAt: '2026-09-03',
        lastDriverName: 'Jane Barlow',
        lastDriverPhone: null,
        meter: null,
        fleetHistoryHref: `/fleet/plant/${plantId}/history`,
        canOpenFleetHistory: false,
        events: [
          {
            id: 'inspection:1',
            source: 'inspection',
            occurredAt: '2026-09-04T12:26:00.000Z',
            jobCode: '40139-GH',
            siteAddress: 'Tarmac Mountsorrel — Railhead',
            customerName: 'Tarmac Trading Limited',
            jobTitle: 'Railhead Concrete Traction Strip',
            driverName: 'Jane Barlow',
            inspectionId: 'insp-1',
          },
        ],
      }),
    }));

    render(
      <AssetWhereaboutsDialog
        open
        onOpenChange={vi.fn()}
        task={{ plant_id: plantId }}
        assetLabel="331"
      />
    );

    await waitFor(() => expect(screen.getByText('40139-GH')).toBeInTheDocument());
    expect(screen.getByText('Last driver')).toBeInTheDocument();
    expect(screen.getAllByText('Jane Barlow')).toHaveLength(1);
    expect(screen.queryByText('Tarmac Trading Limited — Railhead Concrete Traction Strip')).not.toBeInTheDocument();
    expect(screen.queryByText('Tarmac Mountsorrel — Railhead')).not.toBeInTheDocument();
    expect(screen.queryByText(/Driver:/)).not.toBeInTheDocument();
  });
});
