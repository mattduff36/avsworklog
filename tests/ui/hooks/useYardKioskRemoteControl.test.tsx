/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useYardKioskRemoteControl } from '@/lib/hooks/useYardKioskRemoteControl';
import type { YardKioskWorkflowSnapshot } from '@/lib/inventory/kiosk-remote-types';

const snapshot = {
  schema_version: 1 as const,
  revision: 1,
  state: { phase: 'mode' },
  bootstrap: {
    configured: true as const,
    yard: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Yard',
      description: null,
      location_type: 'yard' as const,
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
    active_filter: 'all' as const,
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
  recorded_at: '2026-08-05T12:00:00.000Z',
} satisfies YardKioskWorkflowSnapshot;

function HookHost() {
  useYardKioskRemoteControl({
    phase: 'mode',
    offline: false,
    lastErrorCode: null,
    workflowSnapshot: snapshot,
    onResetWorkflow: vi.fn(),
    onReloadStock: vi.fn(),
    onControlAction: vi.fn(),
    onRemoteNotice: vi.fn(),
  });
  return null;
}

describe('useYardKioskRemoteControl diagnostics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { replace: vi.fn() },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends the server diagnostic id into the recovery URL on DEVICE_REVOKED', async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({
        code: 'DEVICE_REVOKED',
        revoked: true,
        sessionExpired: false,
        diagnostic_id: 'YK-CLIENT-REF-1',
      }),
    } as Response);

    render(<HookHost />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.location.replace).toHaveBeenCalledWith(
      '/yard-kiosk/recover?code=DEVICE_REVOKED&ref=YK-CLIENT-REF-1',
    );
  });
});
