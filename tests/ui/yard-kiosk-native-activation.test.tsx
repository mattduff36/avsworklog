/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callNativeKiosk = vi.hoisted(() => vi.fn());

vi.mock('@/lib/inventory/kiosk-native', () => ({
  callNativeKiosk,
  hasNativeKioskBridge: () => true,
}));

import YardKioskNativeActivationPage from '@/app/yard-kiosk/native/page';

describe('Yard kiosk native activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        replace: vi.fn(),
        reload: vi.fn(),
      },
    });
    callNativeKiosk.mockImplementation(async (action: string) => {
      if (action === 'identity.status') {
        return {
          paired: true,
          device_id: '11111111-1111-4111-8111-111111111111',
        };
      }
      return {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears a revoked stored identity and returns to hardware pairing', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: 'This Android kiosk is not paired',
        code: 'DEVICE_UNPAIRED',
      }),
    } as Response);

    render(<YardKioskNativeActivationPage />);

    await waitFor(() => {
      expect(callNativeKiosk).toHaveBeenCalledWith('identity.clear');
      expect(window.location.replace).toHaveBeenCalledWith('/yard-kiosk/pair');
    });
  });
});
