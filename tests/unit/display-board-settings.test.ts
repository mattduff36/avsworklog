import { describe, expect, it } from 'vitest';
import { normalizeDisplayBoardSettings, type DisplayBoardConfig } from '@/lib/server/display-board';

const currentConfig: DisplayBoardConfig = {
  board_key: 'workshop',
  name: 'Workshop Display Board',
  fallback_poll_interval_seconds: 60,
  realtime_debounce_ms: 750,
  is_enabled: true,
};

describe('display board settings validation', () => {
  it('accepts valid polling and debounce values', () => {
    expect(normalizeDisplayBoardSettings({
      fallback_poll_interval_seconds: 90,
      realtime_debounce_ms: 1200,
      is_enabled: false,
    }, currentConfig)).toEqual({
      fallback_poll_interval_seconds: 90,
      realtime_debounce_ms: 1200,
      is_enabled: false,
    });
  });

  it('clamps polling and debounce values to safe bounds', () => {
    expect(normalizeDisplayBoardSettings({
      fallback_poll_interval_seconds: 5,
      realtime_debounce_ms: 10000,
    }, currentConfig)).toEqual({
      fallback_poll_interval_seconds: 15,
      realtime_debounce_ms: 5000,
      is_enabled: true,
    });
  });

  it('uses current values for invalid numeric input', () => {
    expect(normalizeDisplayBoardSettings({
      fallback_poll_interval_seconds: 'not-a-number',
      realtime_debounce_ms: null,
    }, currentConfig)).toEqual({
      fallback_poll_interval_seconds: 60,
      realtime_debounce_ms: 750,
      is_enabled: true,
    });
  });
});
