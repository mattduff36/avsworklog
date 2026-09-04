import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkshopTaskLocationButton } from '@/components/workshop-tasks/WorkshopTaskLocationButton';
import { AssetWhereaboutsDialog } from '@/components/workshop-tasks/AssetWhereaboutsDialog';

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

const ASSET_ID = '11111111-1111-4111-8111-111111111111';

describe('workshop location UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not open the task modal', () => {
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

  it('fetches only on open and hides the fleet link without access', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        asset: { id: ASSET_ID, type: 'plant', label: '331', plantId: '331', regNumber: null },
        lastCheckAt: '2026-09-03',
        lastDriverName: 'Jo Driver',
        lastDriverPhone: '01234 567890',
        meter: { value: 12, unit: 'hours', source: 'maintenance' },
        fleetHistoryHref: `/fleet/plant/${ASSET_ID}/history`,
        canOpenFleetHistory: false,
        events: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <AssetWhereaboutsDialog
        open={false}
        onOpenChange={vi.fn()}
        task={{ plant_id: ASSET_ID }}
        assetLabel="331"
      />
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <AssetWhereaboutsDialog
        open
        onOpenChange={vi.fn()}
        task={{ plant_id: ASSET_ID }}
        assetLabel="331"
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/api/workshop-tasks/assets/plant/${ASSET_ID}/whereabouts`
    );
    await waitFor(() => expect(screen.getByText('Jo Driver')).toBeInTheDocument());
    expect(screen.queryByText('Open fleet history')).not.toBeInTheDocument();
  });
});
