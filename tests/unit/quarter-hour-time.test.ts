import { describe, expect, it } from 'vitest';
import {
  QUARTER_HOUR_MINUTES,
  getQuarterHourHours,
  getQuarterHourMinutesForHour,
  isQuarterHourTimeAllowed,
  normalizeQuarterHourTime,
} from '@/lib/utils/quarter-hour-time';

describe('quarter-hour time options', () => {
  it('only exposes payroll minute choices', () => {
    expect([...QUARTER_HOUR_MINUTES]).toEqual(['00', '15', '30', '45']);
  });

  it('normalizes existing browser-style values to a quarter hour', () => {
    expect(normalizeQuarterHourTime('08:08:30')).toBe('08:15');
    expect(normalizeQuarterHourTime('17:53')).toBe('18:00');
    expect(normalizeQuarterHourTime('not-a-time')).toBe('');
  });

  it('filters minute choices by a normal work window', () => {
    expect(getQuarterHourMinutesForHour('08', '08:15', '09:00')).toEqual(['15', '30', '45']);
    expect(getQuarterHourMinutesForHour('09', '08:15', '09:00')).toEqual(['00']);
    expect(getQuarterHourMinutesForHour('07', '08:15', '09:00')).toEqual([]);
  });

  it('supports overnight work windows', () => {
    const hours = getQuarterHourHours('22:00', '02:00');

    expect(hours).toEqual(expect.arrayContaining(['00', '01', '02', '22', '23']));
    expect(hours).not.toContain('03');
    expect(hours).not.toContain('21');
    expect(isQuarterHourTimeAllowed('23:45', '22:00', '02:00')).toBe(true);
    expect(isQuarterHourTimeAllowed('12:00', '22:00', '02:00')).toBe(false);
  });
});
