import { describe, expect, it, vi } from 'vitest';
import {
  INVENTORY_CHECK_REFRESH_WARNING,
  runInventoryCheckRefresh,
} from '@/lib/inventory/check-refresh';

describe('INV-CHECK-REFRESH-001 inventory check refresh helper', () => {
  it('does not treat a refresh failure as a save failure', async () => {
    const onRefreshFailure = vi.fn();
    const result = await runInventoryCheckRefresh(
      async () => {
        throw new Error('network down');
      },
      onRefreshFailure,
    );

    expect(result).toBe('refresh_failed');
    expect(onRefreshFailure).toHaveBeenCalledWith(INVENTORY_CHECK_REFRESH_WARNING);
  });

  it('reports refreshed when the callback succeeds', async () => {
    const onRefreshFailure = vi.fn();
    const result = await runInventoryCheckRefresh(async () => undefined, onRefreshFailure);
    expect(result).toBe('refreshed');
    expect(onRefreshFailure).not.toHaveBeenCalled();
  });

  it('skips when no refresh callback is provided', async () => {
    const onRefreshFailure = vi.fn();
    const result = await runInventoryCheckRefresh(undefined, onRefreshFailure);
    expect(result).toBe('skipped');
    expect(onRefreshFailure).not.toHaveBeenCalled();
  });
});
