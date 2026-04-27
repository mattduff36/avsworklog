import { describe, expect, it } from 'vitest';
import { roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';

describe('roundTimeToNearestQuarterHour', () => {
  it('keeps quarter-hour values unchanged', () => {
    expect(roundTimeToNearestQuarterHour('10:00')).toBe('10:00');
    expect(roundTimeToNearestQuarterHour('10:15')).toBe('10:15');
    expect(roundTimeToNearestQuarterHour('10:30')).toBe('10:30');
    expect(roundTimeToNearestQuarterHour('10:45')).toBe('10:45');
  });

  it('rounds to the nearest quarter-hour', () => {
    expect(roundTimeToNearestQuarterHour('10:07')).toBe('10:00');
    expect(roundTimeToNearestQuarterHour('10:08')).toBe('10:15');
    expect(roundTimeToNearestQuarterHour('10:22')).toBe('10:15');
    expect(roundTimeToNearestQuarterHour('10:23')).toBe('10:30');
  });

  it('normalizes browser time values that include seconds', () => {
    expect(roundTimeToNearestQuarterHour('08:07:00')).toBe('08:00');
    expect(roundTimeToNearestQuarterHour('08:08:30')).toBe('08:15');
  });

  it('handles hour/day rollovers when rounding', () => {
    expect(roundTimeToNearestQuarterHour('10:53')).toBe('11:00');
    expect(roundTimeToNearestQuarterHour('23:53')).toBe('00:00');
  });

  it('returns unknown formats unchanged', () => {
    expect(roundTimeToNearestQuarterHour('')).toBe('');
    expect(roundTimeToNearestQuarterHour('10')).toBe('10');
    expect(roundTimeToNearestQuarterHour('not-a-time')).toBe('not-a-time');
  });
});
