export const DAILY_TIMELINE_HOUR_WIDTH = 96;
export const DAILY_TIMELINE_JOB_COLUMN_WIDTH = 240;

/** Narrowest hour column that still fits `05:00` and a 30-minute drop target. */
export const DAILY_TIMELINE_MIN_FIT_HOUR_WIDTH = 48;

export function dailyTimelineRangeLeft(headerLeft: number): number {
  return headerLeft + DAILY_TIMELINE_JOB_COLUMN_WIDTH;
}

export function dailyTimelineFitMinContainerWidth(hourCount: number): number {
  return DAILY_TIMELINE_JOB_COLUMN_WIDTH + hourCount * DAILY_TIMELINE_MIN_FIT_HOUR_WIDTH;
}

export function dailyTimelineFitsContainer(containerWidth: number, hourCount: number): boolean {
  if (hourCount <= 0) return false;
  return containerWidth >= dailyTimelineFitMinContainerWidth(hourCount);
}

export function dailyTimelineHourWidth(containerWidth: number, hourCount: number): number {
  if (hourCount <= 0) return DAILY_TIMELINE_HOUR_WIDTH;
  if (!dailyTimelineFitsContainer(containerWidth, hourCount)) {
    return DAILY_TIMELINE_HOUR_WIDTH;
  }
  return (containerWidth - DAILY_TIMELINE_JOB_COLUMN_WIDTH) / hourCount;
}
