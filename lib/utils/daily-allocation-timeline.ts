import { addDays, eachDayOfInterval, format, isValid, parseISO, startOfWeek } from 'date-fns';

const ALLOCATION_TIME_ZONE = 'Europe/London';

export const DAILY_ALLOCATION_DEFAULT_START_HOUR = 5;
export const DAILY_ALLOCATION_DEFAULT_END_HOUR = 20;
export const DAILY_ALLOCATION_MIN_DURATION_MINUTES = 30;
export const DAILY_ALLOCATION_SNAP_MINUTES = 30;

export function formatDailyAllocationDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function isDailyAllocationDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = parseISO(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parsed);
}

export function getDailyAllocationWeekRange(value?: string | null): { start: string; end: string } {
  const parsed = value ? parseISO(value) : new Date();
  const safeDate = isValid(parsed) ? parsed : new Date();
  const start = startOfWeek(safeDate, { weekStartsOn: 1 });
  return {
    start: formatDailyAllocationDate(start),
    end: formatDailyAllocationDate(addDays(start, 6)),
  };
}

export function enumerateDailyAllocationDates(startDate: string, endDate: string): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end) || end < start) return [];
  return eachDayOfInterval({ start, end }).map(formatDailyAllocationDate);
}

export interface DailyAllocationCoordinateInput {
  clientX: number;
  rangeLeft: number;
  hourWidth: number;
  startHour: number;
  endHour: number;
}

export interface DailyAllocationVisitWindow {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
}

export function mapDailyAllocationClientXToMinutes(
  input: DailyAllocationCoordinateInput
): number {
  const rawMinutes =
    input.startHour * 60
    + ((input.clientX - input.rangeLeft) / input.hourWidth) * 60;
  const snappedMinutes =
    Math.round(rawMinutes / DAILY_ALLOCATION_SNAP_MINUTES) * DAILY_ALLOCATION_SNAP_MINUTES;
  return Math.min(
    Math.max(snappedMinutes, input.startHour * 60),
    input.endHour * 60 - DAILY_ALLOCATION_MIN_DURATION_MINUTES
  );
}

export function getDailyAllocationInitialVisitWindow(
  startMinutes: number,
  estimatedMinutes: number | null,
  endHour = DAILY_ALLOCATION_DEFAULT_END_HOUR
): DailyAllocationVisitWindow {
  const requestedDuration =
    estimatedMinutes && Number.isFinite(estimatedMinutes)
      ? Math.min(Math.max(Math.round(estimatedMinutes), DAILY_ALLOCATION_MIN_DURATION_MINUTES), 180)
      : 180;
  const endMinutes = Math.min(startMinutes + requestedDuration, endHour * 60);
  const durationMinutes = Math.max(endMinutes - startMinutes, DAILY_ALLOCATION_MIN_DURATION_MINUTES);
  return {
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
    durationMinutes,
  };
}

export function getDailyAllocationVisitDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ALLOCATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDailyAllocationVisitTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ALLOCATION_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function getDailyAllocationTimeMinutes(value: string | Date): number {
  const [hours = '0', minutes = '0'] = formatDailyAllocationVisitTime(value).split(':');
  const hour = hours === '24' ? 0 : Number(hours);
  return hour * 60 + Number(minutes);
}

export function isDailyAllocationLondonGridInstant(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ALLOCATION_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minute = Number(values.minute);
  const second = Number(values.second);
  const fraction = Number(values.fractionalSecond || '0');
  return Number.isInteger(minute) && minute % 30 === 0 && second === 0 && fraction === 0;
}

export function isDailyAllocationTrustedInterval(startsAt: string, endsAt: string): boolean {
  if (!isDailyAllocationLondonGridInstant(startsAt) || !isDailyAllocationLondonGridInstant(endsAt)) {
    return false;
  }
  if (getDailyAllocationVisitDate(startsAt) !== getDailyAllocationVisitDate(endsAt)) {
    return false;
  }
  return new Date(endsAt).getTime() - new Date(startsAt).getTime() >= DAILY_ALLOCATION_MIN_DURATION_MINUTES * 60_000;
}

export function minutesToDailyAllocationTime(minutes: number): string {
  const bounded = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hour = Math.floor(bounded / 60);
  const minute = bounded % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function dailyAllocationIntervalsOverlap(
  first: { starts_at: string; ends_at: string },
  second: { starts_at: string; ends_at: string }
): boolean {
  return (
    new Date(first.starts_at).getTime() < new Date(second.ends_at).getTime()
    && new Date(second.starts_at).getTime() < new Date(first.ends_at).getTime()
  );
}

export interface DailyAllocationLaneItem {
  id: string;
  starts_at: string;
  ends_at: string;
}

export interface DailyAllocationLanePlacement<T extends DailyAllocationLaneItem> {
  item: T;
  lane: number;
}

export function assignDailyAllocationLanes<T extends DailyAllocationLaneItem>(
  items: readonly T[]
): { placements: DailyAllocationLanePlacement<T>[]; laneCount: number } {
  const ordered = [...items].sort((left, right) =>
    left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id)
  );
  const laneEnds: number[] = [];
  const placements: DailyAllocationLanePlacement<T>[] = ordered.map((item) => {
    const startMs = new Date(item.starts_at).getTime();
    const endMs = new Date(item.ends_at).getTime();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endMs);
    } else {
      laneEnds[lane] = endMs;
    }
    return { item, lane };
  });
  return {
    placements,
    laneCount: Math.max(1, laneEnds.length),
  };
}

export interface DailyAllocationTimelineRange {
  startHour: number;
  endHour: number;
}

export function getDailyAllocationTimelineRange(
  visits: readonly { starts_at: string; ends_at: string }[],
  date: string
): DailyAllocationTimelineRange {
  let startHour = DAILY_ALLOCATION_DEFAULT_START_HOUR;
  let endHour = DAILY_ALLOCATION_DEFAULT_END_HOUR;

  for (const visit of visits) {
    if (getDailyAllocationVisitDate(visit.starts_at) !== date) continue;
    startHour = Math.min(startHour, Math.floor(getDailyAllocationTimeMinutes(visit.starts_at) / 60));
    endHour = Math.max(endHour, Math.ceil(getDailyAllocationTimeMinutes(visit.ends_at) / 60));
  }

  startHour = Math.max(0, startHour);
  endHour = Math.min(24, Math.max(startHour + 1, endHour));
  return { startHour, endHour };
}

function readLondonParts(ms: number): {
  date: string;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ALLOCATION_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms)).map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? 0 : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function compareLondonWallClock(
  parts: { date: string; hour: number; minute: number; second: number },
  date: string,
  hour: number,
  minute: number
): number {
  if (parts.date !== date) {
    return parts.date < date ? -1 : 1;
  }
  const left = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const right = hour * 3600 + minute * 60;
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Convert a Europe/London wall-clock date and HH:mm time into a UTC ISO string.
 * Nonexistent spring-forward times snap forward to the next valid London minute.
 * Ambiguous fall-back times resolve to the earlier (BST) occurrence.
 */
export function toDailyAllocationLondonDateTimeIso(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (
    !year || !month || !day
    || Number.isNaN(hour) || Number.isNaN(minute)
  ) {
    return new Date(`${date}T${time}:00`).toISOString();
  }

  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const windows: Array<[number, number]> = [
    [nominalUtc - 3 * 60 * 60_000, nominalUtc + 3 * 60 * 60_000],
    [Date.UTC(year, month - 1, day - 1, 0, 0, 0), Date.UTC(year, month - 1, day + 1, 23, 59, 0)],
  ];

  for (const [scanStart, scanEnd] of windows) {
    let exact: number | null = null;
    let firstAtOrAfter: number | null = null;
    const alignedStart = scanStart - (scanStart % 60_000);
    for (let cursor = alignedStart; cursor <= scanEnd; cursor += 60_000) {
      const parts = readLondonParts(cursor);
      const cmp = compareLondonWallClock(parts, date, hour, minute);
      if (cmp === 0) {
        exact = cursor;
        break;
      }
      if (cmp > 0 && parts.date === date && firstAtOrAfter == null) {
        firstAtOrAfter = cursor;
      }
    }
    if (exact != null) {
      return new Date(exact).toISOString();
    }
    if (firstAtOrAfter != null) {
      return new Date(firstAtOrAfter).toISOString();
    }
  }

  return new Date(nominalUtc).toISOString();
}

/**
 * Inclusive London calendar-date range as UTC timestamptz bounds for starts_at filters.
 * Uses half-open [start, endExclusive) so early-morning BST visits are not dropped.
 */
export function getDailyAllocationLondonStartsAtRangeIso(
  startDate: string,
  endDate: string
): { startInclusiveIso: string; endExclusiveIso: string } {
  const endExclusiveDate = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd');
  return {
    startInclusiveIso: toDailyAllocationLondonDateTimeIso(startDate, '00:00'),
    endExclusiveIso: toDailyAllocationLondonDateTimeIso(endExclusiveDate, '00:00'),
  };
}

export function toDailyAllocationLondonIsoFromMinutes(date: string, minutes: number): string {
  return toDailyAllocationLondonDateTimeIso(date, minutesToDailyAllocationTime(minutes));
}
