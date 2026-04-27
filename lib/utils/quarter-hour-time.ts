import { roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';

export const QUARTER_HOUR_MINUTES = ['00', '15', '30', '45'] as const;

export const QUARTER_HOUR_HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0')
);

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(value: string): number | null {
  const match = value.match(TIME_PATTERN);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizeQuarterHourTime(value: string | null | undefined): string {
  if (!value) return '';

  const rounded = roundTimeToNearestQuarterHour(value);
  if (!TIME_PATTERN.test(rounded)) return '';

  const minutes = rounded.slice(3, 5);
  if (!QUARTER_HOUR_MINUTES.includes(minutes as (typeof QUARTER_HOUR_MINUTES)[number])) {
    return '';
  }

  return rounded;
}

export function isQuarterHourTimeAllowed(
  value: string,
  min?: string | null,
  max?: string | null
): boolean {
  const valueMinutes = toMinutes(value);
  if (valueMinutes === null) return false;

  const minMinutes = min ? toMinutes(normalizeQuarterHourTime(min)) : null;
  const maxMinutes = max ? toMinutes(normalizeQuarterHourTime(max)) : null;

  if (minMinutes === null && maxMinutes === null) return true;
  if (minMinutes !== null && maxMinutes === null) return valueMinutes >= minMinutes;
  if (minMinutes === null && maxMinutes !== null) return valueMinutes <= maxMinutes;
  if (minMinutes === null || maxMinutes === null) return true;

  if (minMinutes <= maxMinutes) {
    return valueMinutes >= minMinutes && valueMinutes <= maxMinutes;
  }

  return valueMinutes >= minMinutes || valueMinutes <= maxMinutes;
}

export function getQuarterHourMinutesForHour(
  hour: string,
  min?: string | null,
  max?: string | null
): string[] {
  if (!QUARTER_HOUR_HOURS.includes(hour)) return [];

  return QUARTER_HOUR_MINUTES.filter((minute) =>
    isQuarterHourTimeAllowed(`${hour}:${minute}`, min, max)
  );
}

export function getQuarterHourHours(min?: string | null, max?: string | null): string[] {
  return QUARTER_HOUR_HOURS.filter((hour) =>
    getQuarterHourMinutesForHour(hour, min, max).length > 0
  );
}
