export const INVENTORY_CHECK_TIMEZONE = 'Europe/London';
export const FUTURE_CHECK_CONFIRMATION_REQUIRED = 'FUTURE_CHECK_CONFIRMATION_REQUIRED';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getInventoryLondonDateString(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: INVENTORY_CHECK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidInventoryCheckDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

export function isFutureInventoryCheckDate(value: string, now = new Date()): boolean {
  if (!isValidInventoryCheckDate(value)) return false;
  return value > getInventoryLondonDateString(now);
}

export function createInventoryCheckSubmissionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // RFC4122-ish UUID v4 fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const randomNibble = Math.floor(Math.random() * 16);
    const value = char === 'x' ? randomNibble : ((randomNibble & 0x3) | 0x8);
    return value.toString(16);
  });
}
