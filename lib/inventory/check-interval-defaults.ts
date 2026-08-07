export const DAYS_PER_INVENTORY_CHECK_MONTH = 30;

export const MINOR_PLANT_CHECK_INTERVAL_MONTHS = 1;
export const SMALL_TOOLS_CHECK_INTERVAL_MONTHS = 6;
export const TWELVE_MONTH_CHECK_INTERVAL_MONTHS = 12;

export const MINOR_PLANT_CHECK_INTERVAL_DAYS =
  MINOR_PLANT_CHECK_INTERVAL_MONTHS * DAYS_PER_INVENTORY_CHECK_MONTH;
export const SMALL_TOOLS_CHECK_INTERVAL_DAYS =
  SMALL_TOOLS_CHECK_INTERVAL_MONTHS * DAYS_PER_INVENTORY_CHECK_MONTH;
export const TWELVE_MONTH_CHECK_INTERVAL_DAYS =
  TWELVE_MONTH_CHECK_INTERVAL_MONTHS * DAYS_PER_INVENTORY_CHECK_MONTH;

/** Normalized item numbers that keep a 12-month Small Tools check interval. */
export const SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS = [
  'AVS569',
  'AVS572/571',
  'AVS694',
  'AVS695',
  'AVS708',
  'AVS710',
  'AVS719',
  'AVS720',
  'AVS721',
  'AVS726',
  'AVS795',
  'AVS796',
  'AVS849',
  'AVS866',
  'AVS893',
  'AVS966',
  'AVS967',
  'AVS983984',
] as const;

export type SmallToolsTwelveMonthCheckIntervalItemNumber =
  (typeof SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS)[number];

export function getDefaultCheckIntervalMonths(category?: string | null): number {
  return category === 'minor_plant'
    ? MINOR_PLANT_CHECK_INTERVAL_MONTHS
    : SMALL_TOOLS_CHECK_INTERVAL_MONTHS;
}

export function getDefaultCheckIntervalDays(category?: string | null): number {
  return getDefaultCheckIntervalMonths(category) * DAYS_PER_INVENTORY_CHECK_MONTH;
}

export function isTwelveMonthSmallToolsException(
  itemNumberNormalized: string | null | undefined
): boolean {
  if (!itemNumberNormalized) return false;
  return (SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS as readonly string[]).includes(
    itemNumberNormalized
  );
}
