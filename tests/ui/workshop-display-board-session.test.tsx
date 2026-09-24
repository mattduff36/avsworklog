/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayBoardDeviceCommandPayload } from '@/lib/display-board/device-notify';
import type { DisplayBoardPayload } from '@/lib/server/display-board';
import {
  WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY,
} from '@/lib/display-board/workshop-board-config';

const realtimeMocks = vi.hoisted(() => ({
  deviceCommandHandler: null as ((command: DisplayBoardDeviceCommandPayload) => void) | null,
  deviceBroadcastEnabled: false,
}));

vi.mock('@/lib/hooks/useRealtime', () => ({
  useWorkshopDisplayBoardRealtime: vi.fn(),
  useDisplayBoardDeviceBroadcast: vi.fn((
    _boardKey: string,
    _deviceId: string | undefined,
    handler: (command: DisplayBoardDeviceCommandPayload) => void,
    enabled: boolean,
  ) => {
    realtimeMocks.deviceBroadcastEnabled = enabled;
    realtimeMocks.deviceCommandHandler = enabled ? handler : null;
  }),
}));

import WorkshopDisplayBoardPage from '@/app/displayboard-workshop/page';

const deviceToken = 'persistent-workshop-device-token';

const payload: DisplayBoardPayload = {
  config: {
    board_key: 'workshop',
    name: 'Workshop Display Board',
    fallback_poll_interval_seconds: 60,
    realtime_debounce_ms: 750,
    is_enabled: true,
  },
  device: { id: 'workshop-device-1' },
  display: { text_size_step: 3 },
  maintenance: {
    summary: { total: 0, overdue: 0, due_soon: 0 },
    overdue_items: [],
    due_soon_items: [],
  },
  workshop: {
    counts: { pending: 0, in_progress: 0, on_hold: 0, high_priority: 0 },
    pending: [],
    in_progress: [],
    on_hold: [],
  },
  generated_at: '2026-09-24T12:00:00.000Z',
};

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

async function advance(milliseconds = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe('Workshop display board pairing persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.localStorage.setItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY, deviceToken);
    realtimeMocks.deviceCommandHandler = null;
    realtimeMocks.deviceBroadcastEnabled = false;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('DB-AUTH-001 DB-RECOVERY-001 keeps pairing through a network failure and recovers', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }));

    render(<WorkshopDisplayBoardPage />);
    await advance();

    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBe(deviceToken);
    expect(screen.getByText('Connection interrupted. Pairing kept; retrying…'))
      .toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    await advance(15_000);

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBe(deviceToken);
  });

  it('DB-AUTH-002 DB-AUTH-003 keeps pairing and stale data for non-401 failures', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new SyntaxError('invalid JSON')),
      } as unknown as Response);

    render(<WorkshopDisplayBoardPage />);
    await advance();
    expect(screen.getByText('Live')).toBeInTheDocument();

    await act(async () => {
      realtimeMocks.deviceCommandHandler?.({ kind: 'refresh' } as DisplayBoardDeviceCommandPayload);
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBe(deviceToken);
    expect(screen.getByText('Connection interrupted. Pairing kept; retrying…'))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live Display Board' })).toBeInTheDocument();
  });

  it('DB-AUTH-004 clears the current credential on an explicit 401 even with invalid JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockRejectedValue(new SyntaxError('invalid JSON')),
    } as unknown as Response);

    render(<WorkshopDisplayBoardPage />);
    await advance();

    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBeNull();
    expect(screen.getByText('This display board is not authorised.')).toBeInTheDocument();
  });

  it('DB-AUTH-005 does not let a stale 401 clear a replacement credential', async () => {
    let releaseBody: ((value: { error: string }) => void) | undefined;
    const bodyPromise = new Promise<{ error: string }>((resolve) => {
      releaseBody = resolve;
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockReturnValue(bodyPromise),
    } as unknown as Response)
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }));

    render(<WorkshopDisplayBoardPage />);
    await advance();
    window.localStorage.setItem(
      WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY,
      'replacement-workshop-device-token',
    );

    await act(async () => {
      releaseBody?.({ error: 'Old token rejected' });
      await bodyPromise;
    });

    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBe('replacement-workshop-device-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('DB-RECOVERY-002 coalesces overlapping refresh requests', async () => {
    let releaseRefresh: ((value: Response) => void) | undefined;
    const refreshPromise = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }))
      .mockReturnValueOnce(refreshPromise)
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }));

    render(<WorkshopDisplayBoardPage />);
    await advance();
    expect(screen.getByText('Live')).toBeInTheDocument();

    await act(async () => {
      realtimeMocks.deviceCommandHandler?.({ kind: 'refresh' });
      realtimeMocks.deviceCommandHandler?.({ kind: 'refresh' });
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseRefresh?.(response(200, { status: 'ok', payload }));
      await refreshPromise;
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('DB-REVOKE-002 queues revoke validation behind an active refresh', async () => {
    let releaseRefresh: ((value: Response) => void) | undefined;
    const refreshPromise = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }))
      .mockReturnValueOnce(refreshPromise)
      .mockResolvedValueOnce(response(401, { status: 'unauthorised' }));

    render(<WorkshopDisplayBoardPage />);
    await advance();
    expect(screen.getByText('Live')).toBeInTheDocument();

    await act(async () => {
      realtimeMocks.deviceCommandHandler?.({ kind: 'refresh' });
      realtimeMocks.deviceCommandHandler?.({ kind: 'revoke' });
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseRefresh?.(response(200, { status: 'ok', payload }));
      await refreshPromise;
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBeNull();
    expect(screen.getByText('This display board is not authorised.')).toBeInTheDocument();
  });

  it('DB-REVOKE-003 keeps revoke broadcasts active while showing stale data', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }))
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(response(401, { status: 'unauthorised' }));

    render(<WorkshopDisplayBoardPage />);
    await advance();
    expect(screen.getByText('Live')).toBeInTheDocument();

    await act(async () => {
      realtimeMocks.deviceCommandHandler?.({ kind: 'refresh' });
      await Promise.resolve();
    });
    expect(screen.getByText('Connection interrupted. Pairing kept; retrying…'))
      .toBeInTheDocument();
    expect(realtimeMocks.deviceBroadcastEnabled).toBe(true);
    expect(realtimeMocks.deviceCommandHandler).not.toBeNull();

    await act(async () => {
      realtimeMocks.deviceCommandHandler?.({ kind: 'revoke' });
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBeNull();
    expect(screen.getByText('This display board is not authorised.')).toBeInTheDocument();
  });

  it('DB-REVOKE-001 validates a revoke broadcast and clears pairing on server 401', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, { status: 'ok', payload }))
      .mockResolvedValueOnce(response(401, { status: 'unauthorised' }));

    render(<WorkshopDisplayBoardPage />);
    await advance();
    expect(screen.getByText('Live')).toBeInTheDocument();

    await act(async () => {
      realtimeMocks.deviceCommandHandler?.({ kind: 'revoke' });
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY))
      .toBeNull();
    expect(screen.getByText('This display board is not authorised.')).toBeInTheDocument();
  });
});
