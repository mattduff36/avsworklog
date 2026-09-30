import { describe, expect, it } from 'vitest';
import {
  classifyDailyAllocationSession,
  dailyAllocationSessionLabel,
  dailyAllocationSessionWindow,
} from '@/lib/utils/daily-allocation-sessions';

describe('daily allocation sessions', () => {
  it('uses the fixed London working day', () => {
    expect(dailyAllocationSessionWindow('full')).toEqual({ startMinutes: 7 * 60, endMinutes: 16 * 60 + 30 });
    expect(dailyAllocationSessionWindow('am')).toEqual({ startMinutes: 7 * 60, endMinutes: 12 * 60 });
    expect(dailyAllocationSessionWindow('pm')).toEqual({ startMinutes: 12 * 60, endMinutes: 16 * 60 + 30 });
    expect(classifyDailyAllocationSession(7 * 60, 16 * 60 + 30)).toBe('full');
    expect(dailyAllocationSessionLabel('am')).toBe('AM');
  });
});
