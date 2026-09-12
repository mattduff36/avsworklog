export const DAILY_ALLOCATION_PRIMARY_STORAGE_KEY_PREFIX =
  'avs:daily-allocation-board-primary:v1';

export const DAILY_ALLOCATION_BOARD_PRIMARIES = {
  job: 'job',
  employee: 'employee',
  plant: 'plant',
} as const;

export type DailyAllocationBoardPrimary =
  (typeof DAILY_ALLOCATION_BOARD_PRIMARIES)[keyof typeof DAILY_ALLOCATION_BOARD_PRIMARIES];

export function getDailyAllocationPrimaryStorageKey(userId: string): string {
  return `${DAILY_ALLOCATION_PRIMARY_STORAGE_KEY_PREFIX}:${userId}`;
}

export function isDailyAllocationBoardPrimary(
  value: unknown
): value is DailyAllocationBoardPrimary {
  return value === DAILY_ALLOCATION_BOARD_PRIMARIES.job
    || value === DAILY_ALLOCATION_BOARD_PRIMARIES.employee
    || value === DAILY_ALLOCATION_BOARD_PRIMARIES.plant;
}

export function readDailyAllocationPrimaryPreference(
  userId: string
): DailyAllocationBoardPrimary {
  if (typeof window === 'undefined' || !userId) {
    return DAILY_ALLOCATION_BOARD_PRIMARIES.job;
  }
  try {
    const value = localStorage.getItem(getDailyAllocationPrimaryStorageKey(userId));
    return isDailyAllocationBoardPrimary(value)
      ? value
      : DAILY_ALLOCATION_BOARD_PRIMARIES.job;
  } catch {
    return DAILY_ALLOCATION_BOARD_PRIMARIES.job;
  }
}

export function writeDailyAllocationPrimaryPreference(
  userId: string,
  primary: DailyAllocationBoardPrimary
): void {
  if (typeof window === 'undefined' || !userId || !isDailyAllocationBoardPrimary(primary)) return;
  try {
    localStorage.setItem(getDailyAllocationPrimaryStorageKey(userId), primary);
  } catch {
    // Restricted storage must not block board use.
  }
}
