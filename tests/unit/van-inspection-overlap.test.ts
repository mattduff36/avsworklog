import { describe, expect, it } from 'vitest';
import {
  findVanInspectionOverlap,
  formatVanInspectionDayList,
  getInspectionDaysFromRows,
  getStartedVanInspectionDays,
} from '@/lib/utils/van-inspection-overlap';

describe('van inspection overlap helpers', () => {
  it('collects unique started days from checkbox state keys', () => {
    expect(
      getStartedVanInspectionDays({
        '1-1': 'ok',
        '1-2': 'attention',
        '4-3': 'na',
      })
    ).toEqual([1, 4]);
  });

  it('groups unique day rows by inspection id', () => {
    const result = getInspectionDaysFromRows([
      { inspection_id: 'a', day_of_week: 3 },
      { inspection_id: 'a', day_of_week: 1 },
      { inspection_id: 'a', day_of_week: 3 },
      { inspection_id: 'b', day_of_week: 7 },
      { inspection_id: 'b', day_of_week: null },
    ]);

    expect(result.get('a')).toEqual([1, 3]);
    expect(result.get('b')).toEqual([7]);
  });

  it('prioritizes submitted overlaps over drafts', () => {
    const conflict = findVanInspectionOverlap([1, 2, 3], [
      { id: 'draft-1', status: 'draft', days: [1, 2], updated_at: '2026-04-09T10:00:00.000Z' },
      { id: 'submitted-1', status: 'submitted', days: [3], updated_at: '2026-04-09T09:00:00.000Z' },
    ]);

    expect(conflict).toEqual({
      id: 'submitted-1',
      status: 'submitted',
      overlappingDays: [3],
      inspectionDays: [3],
      conflictCount: 2,
    });
  });

  it('returns null when selected days do not overlap', () => {
    const conflict = findVanInspectionOverlap([4, 5], [
      { id: 'draft-1', status: 'draft', days: [1, 2, 3] },
    ]);

    expect(conflict).toBeNull();
  });

  it('formats day names for conflict messages', () => {
    expect(formatVanInspectionDayList([1, 3, 7])).toBe('Monday, Wednesday, Sunday');
  });
});
