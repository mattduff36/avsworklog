import { describe, expect, it } from 'vitest';
import {
  normalizeNotificationError,
  parseNotificationLimit,
} from '@/lib/server/notifications';

describe('parseNotificationLimit', () => {
  it('falls back to the default limit for invalid values', () => {
    expect(parseNotificationLimit(null)).toBe(50);
    expect(parseNotificationLimit('')).toBe(50);
    expect(parseNotificationLimit('abc')).toBe(50);
    expect(parseNotificationLimit('-10')).toBe(50);
  });

  it('caps large values at the maximum limit', () => {
    expect(parseNotificationLimit('250')).toBe(100);
  });

  it('returns valid limits unchanged', () => {
    expect(parseNotificationLimit('25')).toBe(25);
    expect(parseNotificationLimit('100')).toBe(100);
  });
});

describe('normalizeNotificationError', () => {
  it('returns Error instances as-is', () => {
    const error = new Error('boom');
    expect(normalizeNotificationError(error)).toBe(error);
  });

  it('wraps string errors', () => {
    expect(normalizeNotificationError('failed').message).toBe('failed');
  });

  it('falls back to an unknown error message', () => {
    expect(normalizeNotificationError({ detail: 'no message' }).message).toBe('Unknown error');
  });
});
