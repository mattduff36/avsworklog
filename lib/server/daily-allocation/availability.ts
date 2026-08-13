import { cloneWorkShiftPattern, STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';
import { WORK_SHIFT_DAY_ORDER, type WorkShiftPattern } from '@/types/work-shifts';
import type {
  AbsenceAllocationBehaviour,
  DailyAllocationAbsenceSnapshot,
  DailyAllocationAvailability,
  DailyAllocationBoardConflict,
  DailyAllocationConflictOverride,
  DailyAllocationLabourAssignment,
  DailyAllocationPlantAssignment,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

export type AbsenceRowInput = {
  id: string;
  profile_id: string;
  reason_id: string | null;
  status: string | null;
  is_half_day: boolean | null;
  half_day_session: string | null;
  date: string;
  end_date: string | null;
  absence_reasons:
    | {
        id: string;
        name: string;
        color: string | null;
        is_paid: boolean | null;
        allocation_behaviour: string | null;
      }
    | Array<{
        id: string;
        name: string;
        color: string | null;
        is_paid: boolean | null;
        allocation_behaviour: string | null;
      }>
    | null;
};

export type ShiftRowInput = {
  profile_id: string;
  monday_am: boolean;
  monday_pm: boolean;
  tuesday_am: boolean;
  tuesday_pm: boolean;
  wednesday_am: boolean;
  wednesday_pm: boolean;
  thursday_am: boolean;
  thursday_pm: boolean;
  friday_am: boolean;
  friday_pm: boolean;
  saturday_am: boolean;
  saturday_pm: boolean;
  sunday_am: boolean;
  sunday_pm: boolean;
};

export function classifyAbsence(input: {
  status: string | null;
  is_half_day: boolean | null;
  allocation_behaviour: AbsenceAllocationBehaviour | null;
}): DailyAllocationAvailability | 'pending' | null {
  const behaviour = input.allocation_behaviour || 'block';
  if (input.status === 'pending') return 'pending';
  if (input.status !== 'approved' && input.status !== 'processed') return null;
  if (behaviour === 'ignore') return null;
  if (behaviour === 'block' || !input.is_half_day) return 'full_day_absence';
  return 'half_day_absence';
}

export function isoDowFromWorkDate(workDate: string): number {
  const [year, month, day] = workDate.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

export function shiftPatternFromRow(row: ShiftRowInput | null | undefined): WorkShiftPattern {
  if (!row) return cloneWorkShiftPattern(STANDARD_WORK_SHIFT_PATTERN);
  return cloneWorkShiftPattern(row);
}

export function isShiftSessionWorking(
  pattern: WorkShiftPattern | null | undefined,
  workDate: string,
  session: 'AM' | 'PM'
): boolean {
  const isoDow = isoDowFromWorkDate(workDate);
  if (!pattern) return isoDow >= 1 && isoDow <= 5;
  const day = WORK_SHIFT_DAY_ORDER[isoDow - 1];
  return session === 'AM' ? pattern[`${day}_am`] : pattern[`${day}_pm`];
}

function londonMinutesFromMidnight(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const second = Number(parts.find((part) => part.type === 'second')?.value || 0);
  return hour * 60 + minute + second / 60;
}

export function intervalOverlapsLondonSession(
  startsAt: string,
  endsAt: string,
  session: 'AM' | 'PM'
): boolean {
  const start = londonMinutesFromMidnight(startsAt);
  const end = londonMinutesFromMidnight(endsAt);
  const sessionStart = session === 'AM' ? 0 : 12 * 60;
  const sessionEnd = session === 'AM' ? 12 * 60 : 24 * 60;
  return start < sessionEnd && end > sessionStart;
}

export function intervalsOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function pickAbsenceReason(absence: AbsenceRowInput) {
  return Array.isArray(absence.absence_reasons) ? absence.absence_reasons[0] : absence.absence_reasons;
}

export function toAbsenceSnapshot(absence: AbsenceRowInput): DailyAllocationAbsenceSnapshot {
  const reason = pickAbsenceReason(absence);
  return {
    absence_id: absence.id,
    reason_id: reason?.id || absence.reason_id,
    reason_name: reason?.name || 'Absence',
    colour: reason?.color || null,
    is_paid: Boolean(reason?.is_paid),
    is_half_day: Boolean(absence.is_half_day),
    half_day_session: (absence.half_day_session as 'AM' | 'PM' | null) || null,
    status: (absence.status as DailyAllocationAbsenceSnapshot['status']) || 'approved',
    allocation_behaviour: (reason?.allocation_behaviour || 'block') as AbsenceAllocationBehaviour,
  };
}

export function absencesCoveringDate(absences: AbsenceRowInput[], profileId: string, workDate: string): AbsenceRowInput[] {
  return absences.filter((absence) => (
    absence.profile_id === profileId
    && absence.date <= workDate
    && (absence.end_date || absence.date) >= workDate
  ));
}

export function classifyDayAbsences(absences: AbsenceRowInput[]): {
  availability: DailyAllocationAvailability;
  blocking: DailyAllocationAbsenceSnapshot | null;
  pending: DailyAllocationAbsenceSnapshot | null;
} {
  const pendingRow = absences.find((absence) => absence.status === 'pending') || null;
  const blockingEntry = absences
    .map((absence) => {
      const reason = pickAbsenceReason(absence);
      const availability = classifyAbsence({
        status: absence.status,
        is_half_day: absence.is_half_day,
        allocation_behaviour: (reason?.allocation_behaviour || 'block') as AbsenceAllocationBehaviour,
      });
      return { absence, availability };
    })
    .filter((entry) => entry.availability === 'full_day_absence' || entry.availability === 'half_day_absence')
    .sort((left, right) => Number(left.availability === 'half_day_absence') - Number(right.availability === 'half_day_absence'))[0]
    || null;

  return {
    availability: blockingEntry?.availability === 'full_day_absence' || blockingEntry?.availability === 'half_day_absence'
      ? blockingEntry.availability
      : 'available',
    blocking: blockingEntry ? toAbsenceSnapshot(blockingEntry.absence) : null,
    pending: pendingRow ? toAbsenceSnapshot(pendingRow) : null,
  };
}

function matchingOverride(
  overrides: DailyAllocationConflictOverride[],
  planDayId: string,
  profileId: string,
  visitId: string | null,
  kind: DailyAllocationConflictOverride['conflict_kind']
): DailyAllocationConflictOverride | null {
  return overrides.find((override) => (
    override.plan_day_id === planDayId
    && override.profile_id === profileId
    && override.conflict_kind === kind
    && (override.visit_id == null || visitId == null || override.visit_id === visitId)
  )) || null;
}

export function buildBoardConflicts(input: {
  visits: DailyAllocationVisit[];
  labour: DailyAllocationLabourAssignment[];
  plant: DailyAllocationPlantAssignment[];
  overrides: DailyAllocationConflictOverride[];
  absences: AbsenceRowInput[];
  shiftsByProfile: Map<string, WorkShiftPattern>;
}): DailyAllocationBoardConflict[] {
  const conflicts: DailyAllocationBoardConflict[] = [];
  const visitById = new Map(input.visits.map((visit) => [visit.id, visit]));

  for (const assignment of input.labour) {
    const visit = visitById.get(assignment.visit_id);
    if (!visit) continue;
    const dayAbsences = absencesCoveringDate(input.absences, assignment.profile_id, assignment.work_date);
    const classified = classifyDayAbsences(dayAbsences);
    const startsAt = assignment.starts_at || visit.starts_at;
    const endsAt = assignment.ends_at || visit.ends_at;

    if (classified.availability === 'full_day_absence') {
      conflicts.push({
        code: 'employee_absent',
        severity: 'hard',
        work_date: assignment.work_date,
        visit_id: assignment.visit_id,
        profile_id: assignment.profile_id,
        plant_assignment_id: null,
        override_id: null,
        message: 'Employee has a blocking full-day absence.',
      });
    } else if (classified.availability === 'half_day_absence' && classified.blocking?.half_day_session) {
      if (intervalOverlapsLondonSession(startsAt, endsAt, classified.blocking.half_day_session)) {
        conflicts.push({
          code: 'employee_half_day',
          severity: 'hard',
          work_date: assignment.work_date,
          visit_id: assignment.visit_id,
          profile_id: assignment.profile_id,
          plant_assignment_id: null,
          override_id: null,
          message: `Employee has a blocking ${classified.blocking.half_day_session} absence.`,
        });
      }
    }

    if (classified.pending) {
      const override = matchingOverride(
        input.overrides,
        assignment.plan_day_id,
        assignment.profile_id,
        assignment.visit_id,
        'pending_absence'
      );
      conflicts.push({
        code: 'pending_absence',
        severity: 'warning',
        work_date: assignment.work_date,
        visit_id: assignment.visit_id,
        profile_id: assignment.profile_id,
        plant_assignment_id: null,
        override_id: override?.id || null,
        message: 'A pending absence exists for this date.',
      });
    }

    const pattern = input.shiftsByProfile.get(assignment.profile_id) || null;
    const needsOffShift = (
      (intervalOverlapsLondonSession(startsAt, endsAt, 'AM') && !isShiftSessionWorking(pattern, assignment.work_date, 'AM'))
      || (intervalOverlapsLondonSession(startsAt, endsAt, 'PM') && !isShiftSessionWorking(pattern, assignment.work_date, 'PM'))
    );
    if (needsOffShift) {
      const override = matchingOverride(
        input.overrides,
        assignment.plan_day_id,
        assignment.profile_id,
        assignment.visit_id,
        'off_shift'
      );
      conflicts.push({
        code: 'off_shift',
        severity: 'warning',
        work_date: assignment.work_date,
        visit_id: assignment.visit_id,
        profile_id: assignment.profile_id,
        plant_assignment_id: null,
        override_id: override?.id || null,
        message: 'Employee is not scheduled to work during this visit.',
      });
    }

    const overlapping = input.labour.filter((candidate) => (
      candidate.id !== assignment.id
      && candidate.profile_id === assignment.profile_id
      && candidate.work_date === assignment.work_date
      && intervalsOverlap(startsAt, endsAt, candidate.starts_at, candidate.ends_at)
    ));
    for (const candidate of overlapping) {
      if (candidate.id > assignment.id) continue;
      conflicts.push({
        code: 'employee_overlap',
        severity: 'hard',
        work_date: assignment.work_date,
        visit_id: assignment.visit_id,
        profile_id: assignment.profile_id,
        plant_assignment_id: null,
        override_id: null,
        message: 'Employee is assigned to overlapping visits.',
      });
    }
  }

  for (const assignment of input.plant) {
    const overlapping = input.plant.filter((candidate) => {
      if (candidate.id === assignment.id || candidate.work_date !== assignment.work_date) return false;
      const sameRegistered = Boolean(assignment.plant_id) && assignment.plant_id === candidate.plant_id;
      const sameHired = assignment.plant_kind === 'hired'
        && candidate.plant_kind === 'hired'
        && (assignment.hired_serial || '').trim().toUpperCase() === (candidate.hired_serial || '').trim().toUpperCase()
        && (assignment.hired_company || '').trim().toUpperCase() === (candidate.hired_company || '').trim().toUpperCase();
      if (!sameRegistered && !sameHired) return false;
      return intervalsOverlap(assignment.starts_at, assignment.ends_at, candidate.starts_at, candidate.ends_at);
    });
    for (const candidate of overlapping) {
      if (candidate.id > assignment.id) continue;
      const visit = visitById.get(assignment.visit_id);
      const otherVisit = visitById.get(candidate.visit_id);
      const differentJob = Boolean(
        visit
        && otherVisit
        && (visit.job_source_id !== otherVisit.job_source_id || visit.job_code !== otherVisit.job_code)
      );
      conflicts.push({
        code: differentJob ? 'plant_job' : 'plant_overlap',
        severity: 'hard',
        work_date: assignment.work_date,
        visit_id: assignment.visit_id,
        profile_id: null,
        plant_assignment_id: assignment.id,
        override_id: null,
        message: differentJob
          ? 'Plant is allocated to more than one job on this date.'
          : 'Plant is assigned to overlapping visits.',
      });
    }
  }

  return conflicts;
}
