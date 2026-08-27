import {
  resolvePersistedNightShiftFlag,
  syncManualNightShiftAfterTimesChange,
} from '@/lib/utils/time-calculations';

export function applyTimesheetFormTimeChange<T extends {
  night_shift: boolean;
  time_started: string | null;
  time_finished: string | null;
}>(
  previous: T,
  field: 'time_started' | 'time_finished',
  value: string | null
): T {
  const next = {
    ...previous,
    [field]: value,
  };

  return {
    ...next,
    night_shift: syncManualNightShiftAfterTimesChange({
      nightShift: previous.night_shift,
      previousStarted: previous.time_started,
      previousFinished: previous.time_finished,
      nextStarted: next.time_started,
      nextFinished: next.time_finished,
    }),
  };
}

export function persistTimesheetNightShiftFromFormEntry(entry: {
  night_shift: boolean;
  time_started: string | null;
  time_finished: string | null;
  did_not_work?: boolean;
}): boolean {
  return resolvePersistedNightShiftFlag({
    nightShift: entry.night_shift,
    timeStarted: entry.time_started,
    timeFinished: entry.time_finished,
    didNotWork: entry.did_not_work,
  });
}
