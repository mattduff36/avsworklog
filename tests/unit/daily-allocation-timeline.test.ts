import { describe, expect, it } from 'vitest';
import {
  assignDailyAllocationLanes,
  dailyAllocationIntervalsOverlap,
  enumerateDailyAllocationDates,
  getDailyAllocationInitialVisitWindow,
  getDailyAllocationLondonStartsAtRangeIso,
  getDailyAllocationTimelineRange,
  getDailyAllocationWeekRange,
  isDailyAllocationDate,
  isDailyAllocationLondonGridInstant,
  isDailyAllocationTrustedInterval,
  mapDailyAllocationClientXToMinutes,
  toDailyAllocationLondonDateTimeIso,
} from '@/lib/utils/daily-allocation-timeline';
import {
  DAILY_TIMELINE_HOUR_WIDTH,
  DAILY_TIMELINE_JOB_COLUMN_WIDTH,
  dailyTimelineRangeLeft,
} from '@/components/daily-allocation/board/daily-timeline-layout';

describe('DA2-TIME-001 daily allocation timeline', () => {
  it('normalizes any date to a Monday-Sunday week and enumerates inclusive dates', () => {
    expect(getDailyAllocationWeekRange('2026-08-13')).toEqual({
      start: '2026-08-10',
      end: '2026-08-16',
    });
    expect(enumerateDailyAllocationDates('2026-03-27', '2026-04-02')).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ]);
    expect(enumerateDailyAllocationDates('2026-08-16', '2026-08-10')).toEqual([]);
    expect(isDailyAllocationDate('13/08/2026')).toBe(false);
  });

  it('snaps pointer coordinates to half-hours and clamps to the visible range', () => {
    expect(mapDailyAllocationClientXToMinutes({
      clientX: 392,
      rangeLeft: 200,
      hourWidth: 96,
      startHour: 5,
      endHour: 20,
    })).toBe(420);
    expect(mapDailyAllocationClientXToMinutes({
      clientX: -100,
      rangeLeft: 200,
      hourWidth: 64,
      startHour: 5,
      endHour: 20,
    })).toBe(300);
    expect(mapDailyAllocationClientXToMinutes({
      clientX: 9999,
      rangeLeft: 200,
      hourWidth: 96,
      startHour: 5,
      endHour: 20,
    })).toBe(1170);
  });

  it('maps the first timeline pixel to 05:00 using the job column width, then snaps to 30 minutes', () => {
    const headerLeft = 80;
    const rangeLeft = dailyTimelineRangeLeft(headerLeft);
    expect(rangeLeft).toBe(headerLeft + DAILY_TIMELINE_JOB_COLUMN_WIDTH);
    expect(rangeLeft).not.toBe(headerLeft + DAILY_TIMELINE_HOUR_WIDTH);

    expect(mapDailyAllocationClientXToMinutes({
      clientX: rangeLeft,
      rangeLeft,
      hourWidth: DAILY_TIMELINE_HOUR_WIDTH,
      startHour: 5,
      endHour: 20,
    })).toBe(300);

    expect(mapDailyAllocationClientXToMinutes({
      clientX: rangeLeft + DAILY_TIMELINE_HOUR_WIDTH / 2,
      rangeLeft,
      hourWidth: DAILY_TIMELINE_HOUR_WIDTH,
      startHour: 5,
      endHour: 20,
    })).toBe(330);
  });

  it('enforces a 30-minute minimum duration against the 05:00-20:00 default range', () => {
    expect(getDailyAllocationInitialVisitWindow(1170, 400)).toEqual({
      startMinutes: 1170,
      endMinutes: 1200,
      durationMinutes: 30,
    });
    expect(getDailyAllocationInitialVisitWindow(420, 400).durationMinutes).toBe(180);
    expect(getDailyAllocationInitialVisitWindow(420, null).durationMinutes).toBe(180);
    expect(getDailyAllocationTimelineRange([], '2026-08-13')).toEqual({
      startHour: 5,
      endHour: 20,
    });
  });

  it('treats adjacent half-open intervals as non-overlapping and stacks true overlaps in lanes', () => {
    const morning = {
      starts_at: '2026-08-13T08:00:00.000Z',
      ends_at: '2026-08-13T09:00:00.000Z',
    };
    const adjacent = {
      starts_at: '2026-08-13T09:00:00.000Z',
      ends_at: '2026-08-13T10:00:00.000Z',
    };
    const overlapping = {
      starts_at: '2026-08-13T08:30:00.000Z',
      ends_at: '2026-08-13T09:30:00.000Z',
    };
    expect(dailyAllocationIntervalsOverlap(morning, adjacent)).toBe(false);
    expect(dailyAllocationIntervalsOverlap(morning, overlapping)).toBe(true);

    const lanes = assignDailyAllocationLanes([
      { id: 'a', ...morning },
      { id: 'b', ...adjacent },
      { id: 'c', ...overlapping },
    ]);
    expect(lanes.laneCount).toBe(2);
    const laneById = Object.fromEntries(
      lanes.placements.map((placement) => [placement.item.id, placement.lane])
    );
    expect(laneById.a).toBe(laneById.b);
    expect(laneById.c).not.toBe(laneById.a);
  });

  it('converts Europe/London wall-clock times, including DST spring-forward and fall-back', () => {
    expect(toDailyAllocationLondonDateTimeIso('2026-01-15', '08:00')).toBe('2026-01-15T08:00:00.000Z');
    expect(toDailyAllocationLondonDateTimeIso('2026-07-14', '08:00')).toBe('2026-07-14T07:00:00.000Z');
    expect(toDailyAllocationLondonDateTimeIso('2026-03-29', '01:30')).toBe('2026-03-29T01:00:00.000Z');
    expect(toDailyAllocationLondonDateTimeIso('2026-10-25', '01:30')).toBe('2026-10-25T00:30:00.000Z');
    expect(toDailyAllocationLondonDateTimeIso('2026-10-25', '01:59')).toBe('2026-10-25T00:59:00.000Z');
  });

  it('builds London-local starts_at bounds that include early BST visits', () => {
    const range = getDailyAllocationLondonStartsAtRangeIso('2026-07-14', '2026-07-14');
    expect(range.startInclusiveIso).toBe('2026-07-13T23:00:00.000Z');
    expect(range.endExclusiveIso).toBe('2026-07-14T23:00:00.000Z');
    const earlyVisitUtc = '2026-07-13T23:30:00.000Z';
    expect(earlyVisitUtc >= range.startInclusiveIso).toBe(true);
    expect(earlyVisitUtc < range.endExclusiveIso).toBe(true);
  });

  it('rejects 09:17 London instants and accepts adjacent 09:00/09:30 grid bounds', () => {
    const start = toDailyAllocationLondonDateTimeIso('2026-08-14', '09:00');
    const adjacentEnd = toDailyAllocationLondonDateTimeIso('2026-08-14', '09:30');
    const invalid = toDailyAllocationLondonDateTimeIso('2026-08-14', '09:17');
    const dstStart = toDailyAllocationLondonDateTimeIso('2026-03-29', '09:00');
    const dstEnd = toDailyAllocationLondonDateTimeIso('2026-03-29', '09:30');

    expect(isDailyAllocationLondonGridInstant(start)).toBe(true);
    expect(isDailyAllocationLondonGridInstant(adjacentEnd)).toBe(true);
    expect(isDailyAllocationLondonGridInstant(invalid)).toBe(false);
    expect(isDailyAllocationTrustedInterval(start, adjacentEnd)).toBe(true);
    expect(isDailyAllocationTrustedInterval(invalid, adjacentEnd)).toBe(false);
    expect(isDailyAllocationTrustedInterval(start, invalid)).toBe(false);
    expect(isDailyAllocationTrustedInterval(dstStart, dstEnd)).toBe(true);
    expect(dailyAllocationIntervalsOverlap(
      { starts_at: start, ends_at: adjacentEnd },
      { starts_at: adjacentEnd, ends_at: toDailyAllocationLondonDateTimeIso('2026-08-14', '10:00') }
    )).toBe(false);
  });
});
