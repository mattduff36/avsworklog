import { eachDayOfInterval } from 'date-fns';
import { formatDateISO } from '@/lib/utils/date';
import { getWorkingDayFraction, getWorkingSessionFraction } from '@/lib/utils/work-shifts';
import type { WorkShiftPattern, WorkShiftSession } from '@/types/work-shifts';

export interface AbsenceCalendarDisplayInput {
  date: string;
  endDate: string | null;
  isHalfDay: boolean;
  halfDaySession: WorkShiftSession | null;
}

export function parseIsoDateAsLocalMidnight(isoDate: string): Date {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(isoDate);
  }

  return new Date(year, month - 1, day);
}

export function getWorkingDisplayDatesForAbsence(
  absence: AbsenceCalendarDisplayInput,
  pattern?: WorkShiftPattern | null
): string[] {
  const start = parseIsoDateAsLocalMidnight(absence.date);
  const end = absence.endDate ? parseIsoDateAsLocalMidnight(absence.endDate) : start;

  if (end < start) {
    return [];
  }

  if (absence.isHalfDay) {
    const requestedSession = absence.halfDaySession || 'AM';
    return getWorkingSessionFraction(start, requestedSession, pattern) > 0
      ? [formatDateISO(start)]
      : [];
  }

  return eachDayOfInterval({ start, end }).flatMap((day) =>
    getWorkingDayFraction(day, pattern) > 0 ? [formatDateISO(day)] : []
  );
}
