export const DAILY_TIMELINE_HOUR_WIDTH = 96;
export const DAILY_TIMELINE_JOB_COLUMN_WIDTH = 240;

export function dailyTimelineRangeLeft(headerLeft: number): number {
  return headerLeft + DAILY_TIMELINE_JOB_COLUMN_WIDTH;
}

export function dailyTimelineHourWidth(containerWidth: number, hourCount: number): number {
  if (hourCount <= 0) return DAILY_TIMELINE_HOUR_WIDTH;
  return Math.max(
    DAILY_TIMELINE_HOUR_WIDTH,
    (containerWidth - DAILY_TIMELINE_JOB_COLUMN_WIDTH) / hourCount
  );
}
