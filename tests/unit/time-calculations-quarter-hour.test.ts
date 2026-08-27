import { describe, expect, it } from 'vitest';
import {
  isDisplayedNightShift,
  resolvePersistedNightShiftFlag,
  roundTimeToNearestQuarterHour,
  syncManualNightShiftAfterTimesChange,
} from '@/lib/utils/time-calculations';

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

describe('night shift persist vs display', () => {
  it('PAY-MONEY-002 and PAY-VERIFY-002 persist only the manual tick, not overnight wrap', () => {
    expect(resolvePersistedNightShiftFlag({
      nightShift: false,
      didNotWork: false,
    })).toBe(false);
    expect(isDisplayedNightShift({
      nightShift: false,
      timeStarted: '16:00',
      timeFinished: '04:00',
    })).toBe(true);
    expect(isDisplayedNightShift({
      nightShift: false,
      timeStarted: '08:00',
      timeFinished: '16:00',
    })).toBe(false);
    expect(resolvePersistedNightShiftFlag({
      nightShift: true,
      didNotWork: true,
    })).toBe(false);
    expect(resolvePersistedNightShiftFlag({
      nightShift: true,
      timeStarted: '16:00',
      timeFinished: '04:00',
    })).toBe(false);
    expect(resolvePersistedNightShiftFlag({
      nightShift: true,
      timeStarted: '18:00',
      timeFinished: '23:00',
    })).toBe(true);
  });

  it('PAY-VERIFY-002 clears a stored Night Shift tick when an overnight entry is edited back to daytime', () => {
    expect(syncManualNightShiftAfterTimesChange({
      nightShift: true,
      previousStarted: '16:00',
      previousFinished: '04:00',
      nextStarted: '08:00',
      nextFinished: '16:00',
    })).toBe(false);
    expect(syncManualNightShiftAfterTimesChange({
      nightShift: true,
      previousStarted: '18:00',
      previousFinished: '23:00',
      nextStarted: '19:00',
      nextFinished: '23:00',
    })).toBe(true);
  });
});
