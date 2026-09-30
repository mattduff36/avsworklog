export const DAILY_ALLOCATION_SESSION_START_MINUTES = 7 * 60;
export const DAILY_ALLOCATION_SESSION_SPLIT_MINUTES = 12 * 60;
export const DAILY_ALLOCATION_SESSION_END_MINUTES = 16 * 60 + 30;

export type DailyAllocationSession = 'full' | 'am' | 'pm';

export function dailyAllocationSessionWindow(session: DailyAllocationSession): {
  startMinutes: number;
  endMinutes: number;
} {
  if (session === 'am') {
    return {
      startMinutes: DAILY_ALLOCATION_SESSION_START_MINUTES,
      endMinutes: DAILY_ALLOCATION_SESSION_SPLIT_MINUTES,
    };
  }
  if (session === 'pm') {
    return {
      startMinutes: DAILY_ALLOCATION_SESSION_SPLIT_MINUTES,
      endMinutes: DAILY_ALLOCATION_SESSION_END_MINUTES,
    };
  }
  return {
    startMinutes: DAILY_ALLOCATION_SESSION_START_MINUTES,
    endMinutes: DAILY_ALLOCATION_SESSION_END_MINUTES,
  };
}

export function dailyAllocationSessionLabel(session: DailyAllocationSession): string {
  if (session === 'am') return 'AM';
  if (session === 'pm') return 'PM';
  return 'Full day';
}

export function classifyDailyAllocationSession(
  startMinutes: number,
  endMinutes: number,
): DailyAllocationSession | null {
  const windows: DailyAllocationSession[] = ['full', 'am', 'pm'];
  return windows.find((session) => {
    const window = dailyAllocationSessionWindow(session);
    return window.startMinutes === startMinutes && window.endMinutes === endMinutes;
  }) || null;
}
