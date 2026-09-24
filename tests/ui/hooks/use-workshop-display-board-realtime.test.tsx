/** @vitest-environment happy-dom */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => {
  const subscribe = vi.fn().mockReturnValue({});
  const on = vi.fn().mockReturnValue({ subscribe });
  const channel = vi.fn().mockReturnValue({ on });
  const removeChannel = vi.fn();
  const createClient = vi.fn().mockReturnValue({ channel, removeChannel });
  return { channel, createClient, on, removeChannel, subscribe };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: supabaseMocks.createClient,
}));

import { useWorkshopDisplayBoardRealtime } from '@/lib/hooks/useRealtime';

describe('useWorkshopDisplayBoardRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';
    supabaseMocks.subscribe.mockReturnValue({});
    supabaseMocks.on.mockReturnValue({ subscribe: supabaseMocks.subscribe });
    supabaseMocks.channel.mockReturnValue({ on: supabaseMocks.on });
    supabaseMocks.createClient.mockReturnValue({
      channel: supabaseMocks.channel,
      removeChannel: supabaseMocks.removeChannel,
    });
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('DB-RT-001 excludes device heartbeat updates from board refresh subscriptions', () => {
    const { unmount } = renderHook(() => {
      useWorkshopDisplayBoardRealtime(vi.fn());
    });

    const subscribedTables = supabaseMocks.on.mock.calls.map((call) => call[1].table);
    expect(subscribedTables).toEqual([
      'actions',
      'vehicle_maintenance',
      'asset_maintenance_category_values',
    ]);
    expect(subscribedTables).not.toContain('display_board_devices');

    unmount();
  });
});
