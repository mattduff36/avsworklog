/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YardKioskController } from '@/app/(dashboard)/inventory/kiosk-control/YardKioskController';

const controlSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const snapshot = {
  schema_version: 1,
  revision: 10,
  state: {
    phase: 'mode',
    direction: null,
    counterpart: null,
    stock: [],
    basket: [],
    searchQuery: '',
    category: 'all',
    loadingStock: false,
    error: null,
    userError: null,
    blockedItems: [],
    receipt: null,
  },
  bootstrap: {
    configured: true,
    yard: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Main Yard',
      description: null,
      location_type: 'yard',
      source_type: null,
      external_reference: null,
      primary_user_names: [],
      secondary_user_names: [],
    },
    locations: [],
    categories: [],
  },
  locations: [],
  offline: false,
  location_ui: {
    query: '',
    active_filter: 'all',
    page_index: 0,
    include_legacy_quotes: false,
    recent_ids: [],
    pinned_ids: [],
  },
  item_ui: {
    page_index: 0,
    hardware_item_id: null,
    hardware_quantity: 1,
  },
  recorded_at: '2026-07-22T12:00:00.000Z',
};

function createDevice(isHeld: boolean) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    device_label: 'Yard Tablet',
    presence: 'online',
    last_heartbeat_at: '2026-07-22T12:00:00.000Z',
    workflow_snapshot: snapshot,
    workflow_state_version: 10,
    last_snapshot_at: '2026-07-22T12:00:00.000Z',
    control_lease: {
      session_id: isHeld ? controlSessionId : null,
      holder_user_id: isHeld
        ? '33333333-3333-4333-8333-333333333333'
        : null,
      acquired_at: isHeld ? '2026-07-22T12:00:00.000Z' : null,
      expires_at: isHeld ? '2099-07-22T12:00:20.000Z' : null,
      is_active: isHeld,
    },
  };
}

describe('Yard kiosk manager controller', () => {
  const fetchMock = vi.fn();
  const sendBeaconMock = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(controlSessionId);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens as a read-only mirror and requests an explicit control lease', async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        device: createDevice(false),
      }), { status: 200 });
    });

    render(<YardKioskController />);

    expect(await screen.findByText('Read-only mirror')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/kiosk/control',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            operation: 'take',
            device_id: '22222222-2222-4222-8222-222222222222',
            control_session_id: controlSessionId,
          }),
        }),
      );
    });
  });

  it('renders the shared kiosk surface as interactive for the lease holder', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      device: createDevice(true),
    }), { status: 200 }));

    render(<YardKioskController />);

    expect(await screen.findByText('You have control')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^collect/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Release control' })).toBeEnabled();
  });

  it('does not release control when the one-second device poll refreshes state', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      success: true,
      device: createDevice(true),
    }), { status: 200 }));

    const view = render(<YardKioskController />);
    expect(await screen.findByText('You have control')).toBeInTheDocument();

    await waitFor(() => {
      const getRequests = fetchMock.mock.calls.filter(
        ([, init]) => !(init as RequestInit | undefined)?.method,
      );
      expect(getRequests.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 1_600 });
    expect(sendBeaconMock).not.toHaveBeenCalled();

    view.unmount();
    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
  });
});
