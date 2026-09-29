/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callNativeKiosk = vi.hoisted(() => vi.fn());

vi.mock('@/lib/inventory/kiosk-native', () => ({
  callNativeKiosk,
  hasNativeKioskBridge: () => true,
}));

import YardKioskPairPage from '@/app/yard-kiosk/pair/page';

describe('Yard kiosk hardware pairing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    callNativeKiosk.mockResolvedValue({
      public_key_spki: 'public-key',
      certificate_chain: ['leaf', 'root'],
    });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'pairing',
          pairing: {
            id: '11111111-1111-4111-8111-111111111111',
            device_label: 'YardTablet1',
            confirmation_code: '060161',
            status: 'active',
            candidate_seen_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 300_000).toISOString(),
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enrolled: false,
          challenge_id: '22222222-2222-4222-8222-222222222222',
          challenge: 'x'.repeat(43),
          expires_at: new Date(Date.now() + 120_000).toISOString(),
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: 'Android key attestation root is not trusted',
          code: 'ANDROID_ATTESTATION_UNTRUSTED',
        }),
      } as Response));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a hardware enrollment rejection visible instead of polling it away', async () => {
    render(<YardKioskPairPage />);

    expect(await screen.findByText(
      'Android key attestation root is not trusted',
    )).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(screen.getByText(
      'Android key attestation root is not trusted',
    )).toBeInTheDocument();
    expect(screen.queryByText('060161')).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });
});
