export const DAILY_TIMELINE_HOUR_WIDTH = 96;
export const DAILY_TIMELINE_JOB_COLUMN_WIDTH = 240;

export function dailyTimelineRangeLeft(headerLeft: number): number {
  return headerLeft + DAILY_TIMELINE_JOB_COLUMN_WIDTH;
}
