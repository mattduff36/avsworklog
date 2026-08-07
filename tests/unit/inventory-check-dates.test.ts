import { describe, expect, it, vi } from 'vitest';
import {
  createInventoryCheckSubmissionId,
  getInventoryLondonDateString,
  isFutureInventoryCheckDate,
  isValidInventoryCheckDate,
} from '@/lib/inventory/check-dates';

describe('INV-CHECK-TZ-001 inventory London check dates', () => {
  it('uses Europe/London calendar dates around BST midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:30:00+01:00'));
    expect(getInventoryLondonDateString()).toBe('2026-06-01');

    vi.setSystemTime(new Date('2026-06-01T00:30:00.000Z'));
    expect(getInventoryLondonDateString()).toBe('2026-06-01');

    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
    expect(getInventoryLondonDateString()).toBe('2026-01-01');

    vi.useRealTimers();
  });

  it('rejects impossible calendar dates and detects future London dates', () => {
    expect(isValidInventoryCheckDate('2026-02-31')).toBe(false);
    expect(isValidInventoryCheckDate('2026-06-01')).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00+01:00'));
    expect(isFutureInventoryCheckDate('2026-06-01')).toBe(false);
    expect(isFutureInventoryCheckDate('2026-06-02')).toBe(true);
    vi.useRealTimers();
  });

  it('creates UUID submission ids even without crypto.randomUUID', () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });

    try {
      const submissionId = createInventoryCheckSubmissionId();
      expect(submissionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  });
});
