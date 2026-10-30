/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    unallocated_details: '',
    unallocated_entry_open: false,
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
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(window.navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pauses hidden passive polling and immediately resumes visibility without overlapping slow requests', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const view = render(<YardKioskController />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(new Response(JSON.stringify({ device: createDevice(false) })));
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const signal = (fetchMock.mock.calls[1][1] as RequestInit).signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(new Response(JSON.stringify({ device: createDevice(true) })));
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendBeaconMock).not.toHaveBeenCalled();
  });

  it('does not start a hidden initial poll and keeps unauthorized responses recoverable', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
      .mockImplementation(async () => new Response(JSON.stringify({ device: createDevice(false) })));
    const view = render(<YardKioskController />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { fireEvent(document, new Event('visibilitychange')); });
    expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText('Read-only mirror')).toBeInTheDocument();
    view.unmount();
  });

  it('continues the separate eight-second lease renewal while hidden and stops after explicit release', async () => {
    vi.useFakeTimers();
    let held = true;
    fetchMock.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (JSON.parse(init.body as string).operation === 'release') held = false;
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify({ device: createDevice(held) }));
    });
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<YardKioskController />); });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    const operations = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')
      .map(([, init]) => JSON.parse((init as RequestInit).body as string).operation);
    expect(operations()).toEqual(['renew']);
    // One initial status read and one explicit post-renewal refresh; no passive hidden reads.
    expect(fetchMock.mock.calls.filter(([, init]) => !(init as RequestInit)?.method)).toHaveLength(2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Release control' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(operations()).toEqual(['renew', 'release']);
    view.unmount();
    expect(sendBeaconMock).not.toHaveBeenCalled();
  });

  it.each(['another controller', 'expired lease', 'revoked device'])('stops ownership renewal after status reports %s', async (scenario) => {
    vi.useFakeTimers();
    let changed = false;
    fetchMock.mockImplementation(async () => {
      const device = createDevice(true);
      if (changed) {
        if (scenario === 'another controller') device.control_lease.session_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        if (scenario === 'expired lease') device.control_lease.expires_at = '2000-01-01T00:00:00Z';
        if (scenario === 'revoked device') { device.presence = 'revoked'; device.control_lease.is_active = false; }
      }
      return new Response(JSON.stringify({ device }));
    });
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<YardKioskController />); });
    expect(screen.getByText('You have control')).toBeInTheDocument();
    changed = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByText('You have control')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
    view.unmount();
    expect(sendBeaconMock).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('yard-kiosk-virtual-screen')).toHaveClass(
      'h-[600px]',
      'w-[1024px]',
    );
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
