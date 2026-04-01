import { describe, expect, it } from 'vitest';
import {
  getReadingDigitGrowthWarning,
  READING_DIGIT_GROWTH_CONFIG,
} from '@/lib/utils/readingDigitGrowthWarning';

describe('getReadingDigitGrowthWarning', () => {
  it('does not warn when previous reading is missing', () => {
    const result = getReadingDigitGrowthWarning({
      enteredReading: 1234,
      previousReading: null,
      unitName: 'miles',
    });

    expect(result.requiresConfirmation).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('does not warn when digit count does not increase', () => {
    const result = getReadingDigitGrowthWarning({
      enteredReading: 456,
      previousReading: 123,
      unitName: 'KM',
    });

    expect(result.requiresConfirmation).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('warns when digit count increases with a large jump', () => {
    const result = getReadingDigitGrowthWarning({
      enteredReading: 1234,
      previousReading: 123,
      unitName: 'hours',
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.warning).toContain('FULL hours');
    expect(result.warning).toContain('123.4');
  });

  it('suppresses warning for small rollover increase', () => {
    const result = getReadingDigitGrowthWarning({
      enteredReading: 1002,
      previousReading: 998,
      unitName: 'KM',
    });

    expect(result.requiresConfirmation).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('warns when rollover-like increase exceeds threshold', () => {
    const result = getReadingDigitGrowthWarning({
      enteredReading: 1030,
      previousReading: 998,
      unitName: 'KM',
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.warning).toContain('1,030');
    expect(result.warning).toContain('998');
  });
});

describe('READING_DIGIT_GROWTH_CONFIG', () => {
  it('uses the agreed default rollover threshold', () => {
    expect(READING_DIGIT_GROWTH_CONFIG.ROLLOVER_INCREASE_THRESHOLD).toBe(25);
  });
});
