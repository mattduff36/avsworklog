export const DAILY_ALLOCATION_VIEW_STORAGE_KEY_PREFIX = 'avs:daily-allocation-board-view:v1';

export const DAILY_ALLOCATION_BOARD_VIEWS = {
  daily: 'daily',
  weekly: 'weekly',
} as const;

export type DailyAllocationBoardView =
  (typeof DAILY_ALLOCATION_BOARD_VIEWS)[keyof typeof DAILY_ALLOCATION_BOARD_VIEWS];

export function getDailyAllocationViewStorageKey(userId: string): string {
  return `${DAILY_ALLOCATION_VIEW_STORAGE_KEY_PREFIX}:${userId}`;
}

export function isDailyAllocationBoardView(value: unknown): value is DailyAllocationBoardView {
  return value === DAILY_ALLOCATION_BOARD_VIEWS.daily
    || value === DAILY_ALLOCATION_BOARD_VIEWS.weekly;
}

export function readDailyAllocationViewPreference(userId: string): DailyAllocationBoardView {
  if (typeof window === 'undefined' || !userId) return DAILY_ALLOCATION_BOARD_VIEWS.daily;

  try {
    const storedView = localStorage.getItem(getDailyAllocationViewStorageKey(userId));
    return storedView === DAILY_ALLOCATION_BOARD_VIEWS.weekly
      ? DAILY_ALLOCATION_BOARD_VIEWS.weekly
      : DAILY_ALLOCATION_BOARD_VIEWS.daily;
  } catch {
    return DAILY_ALLOCATION_BOARD_VIEWS.daily;
  }
}

export function writeDailyAllocationViewPreference(
  userId: string,
  view: DailyAllocationBoardView
): void {
  if (typeof window === 'undefined' || !userId) return;
  if (!isDailyAllocationBoardView(view)) return;

  try {
    localStorage.setItem(getDailyAllocationViewStorageKey(userId), view);
  } catch {
    // Ignore unavailable or restricted localStorage.
  }
}
