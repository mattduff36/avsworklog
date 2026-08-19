/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YardTransfersPanel } from '@/app/(dashboard)/actions/components/YardTransfersPanel';
import { INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';

const fetchMock = vi.fn();

describe('Yard transfers panel', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('lists typed details and opens allocate for an existing or new location', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/api/actions?') && url.includes(INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY)) {
        return {
          ok: true,
          json: async () => ({
            actions: [{
              id: '11111111-1111-4111-8111-111111111111',
              workflow_key: INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
              status: 'open',
              title: 'Allocate yard take: Job van',
              description: 'Job van',
              metadata: {
                location_details: 'Job van',
                serialized_items: [{ id: 'item-1' }],
                hardware_lines: [{ id: 'hw-1' }],
              },
              created_at: '2026-08-19T10:00:00.000Z',
              reminders_count: { total: 0, pending: 0, actioned: 0, cancelled: 0 },
            }],
          }),
        };
      }
      if (url.includes('/api/actions/fleet-assets')) {
        return { ok: true, json: async () => ({ assets: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<YardTransfersPanel refreshToken={0} />);

    await waitFor(() => {
      expect(screen.getByText('Job van')).toBeInTheDocument();
    });
    expect(screen.getByText('1 items, 1 hardware')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allocate' }));
    expect(await screen.findByText('Allocate Yard take')).toBeInTheDocument();
    expect(screen.getByLabelText('Use an existing location')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Create a location'));
    expect(screen.getByLabelText('Location name')).toBeInTheDocument();
  });
});
