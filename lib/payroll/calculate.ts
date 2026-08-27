import { isOvernightShift, roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';
import type {
  PayrollDayBand,
  PayrollDayBreakdown,
  PayrollDayInput,
  PayrollTreatment,
  PayrollWeekBreakdown,
  PayrollWeekInput,
} from './types';
import { validatePayrollRule } from './schema';

const MINUTES_PER_DAY = 24 * 60;
const DAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

interface TreatmentTotals {
  basicMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
}

function normalizeUnits(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round((value ?? 0) * 2) / 2);
}

function parseMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function calculateElapsedMinutes(start: string | null, finish: string | null): {
  roundedStart: string | null;
  roundedFinish: string | null;
  elapsedMinutes: number;
} {
  if (!start || !finish) {
    return { roundedStart: null, roundedFinish: null, elapsedMinutes: 0 };
  }

  const roundedStart = roundTimeToNearestQuarterHour(start);
  const roundedFinish = roundTimeToNearestQuarterHour(finish);
  let startMinutes = parseMinutes(roundedStart);
  let finishMinutes = parseMinutes(roundedFinish);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(finishMinutes)) {
    throw new Error('Invalid timesheet time value.');
  }
  if (finishMinutes < startMinutes) finishMinutes += MINUTES_PER_DAY;
  startMinutes = Math.max(0, startMinutes);

  return {
    roundedStart,
    roundedFinish,
    elapsedMinutes: Math.max(0, finishMinutes - startMinutes),
  };
}

function addTreatment(
  totals: TreatmentTotals,
  treatment: PayrollTreatment,
  minutes: number
): void {
  if (treatment === 'basic') totals.basicMinutes += minutes;
  if (treatment === 'overtime') totals.overtimeMinutes += minutes;
  if (treatment === 'double_time') totals.doubleTimeMinutes += minutes;
}

function splitByBand(band: PayrollDayBand, payableMinutes: number): TreatmentTotals {
  const totals: TreatmentTotals = { basicMinutes: 0, overtimeMinutes: 0, doubleTimeMinutes: 0 };
  const firstMinutes = band.upToMinutes === undefined
    ? payableMinutes
    : Math.min(payableMinutes, band.upToMinutes);
  addTreatment(totals, band.treatment, firstMinutes);

  const remainder = payableMinutes - firstMinutes;
  if (remainder > 0) {
    if (!band.remainderTreatment) {
      throw new Error('Payroll rule is missing a remainder treatment.');
    }
    addTreatment(totals, band.remainderTreatment, remainder);
  }
  return totals;
}

function calculateDay(input: PayrollDayInput, week: PayrollWeekInput): PayrollDayBreakdown {
  const paidLeaveUnits = normalizeUnits(input.paidLeaveUnits);
  const unpaidLeaveUnits = normalizeUnits(input.unpaidLeaveUnits);
  const didNotWork = input.didNotWork === true;
  const elapsed = calculateElapsedMinutes(input.timeStarted, input.timeFinished);
  const override = Math.max(0, Math.round(input.workedMinutesOverride ?? 0));
  const elapsedMinutes = elapsed.elapsedMinutes > 0 ? elapsed.elapsedMinutes : override;
  const breakMinutes = !didNotWork && elapsedMinutes > week.rule.breakThresholdMinutes
    ? week.rule.breakDeductionMinutes
    : 0;
  const payableMinutes = didNotWork ? 0 : Math.max(0, elapsedMinutes - breakMinutes);
  const operatorTravelMinutes = week.rule.operatorTravelEnabled
    ? Math.max(0, Math.round((input.operatorTravelHours ?? 0) * 60))
    : 0;

  let treatmentReason: PayrollDayBreakdown['treatmentReason'] = 'calendar';
  let totals: TreatmentTotals = { basicMinutes: 0, overtimeMinutes: 0, doubleTimeMinutes: 0 };

  if (didNotWork || payableMinutes === 0) {
    treatmentReason = 'did_not_work';
  } else if (input.bankHoliday) {
    treatmentReason = 'bank_holiday';
    addTreatment(totals, week.rule.bankHolidayTreatment, payableMinutes);
  } else if (
    week.rule.key !== 'lorries' &&
    week.rule.nightShiftTreatment &&
    (input.nightShift || isOvernightShift(input.timeStarted, input.timeFinished))
  ) {
    treatmentReason = 'night_shift';
    addTreatment(totals, week.rule.nightShiftTreatment, payableMinutes);
  } else {
    const band = week.rule.dayBands[input.dayOfWeek];
    if (!band) throw new Error(`Payroll rule has no band for day ${input.dayOfWeek}.`);
    totals = splitByBand(band, payableMinutes);
  }

  return {
    dayOfWeek: input.dayOfWeek,
    roundedTimeStarted: elapsed.roundedStart,
    roundedTimeFinished: elapsed.roundedFinish,
    elapsedMinutes,
    breakMinutes,
    payableMinutes,
    ...totals,
    paidLeaveUnits,
    unpaidLeaveUnits,
    operatorTravelMinutes,
    iprUnits: payableMinutes > 0 ? week.rule.iprUnitsPerWorkedDay : 0,
    subsistence: !didNotWork && input.subsistence === true,
    treatmentReason,
  };
}

export function calculatePayrollWeek(input: PayrollWeekInput): PayrollWeekBreakdown {
  const errors = validatePayrollRule(input.rule);
  if (errors.length > 0) {
    throw new Error(`Invalid payroll rule: ${errors.join(' ')}`);
  }

  const days = [...input.days]
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek)
    .map((day) => calculateDay(day, input));
  const sum = (selector: (day: PayrollDayBreakdown) => number) =>
    days.reduce((total, day) => total + selector(day), 0);
  const iprUnits = Math.min(
    input.rule.iprWeeklyCap,
    Math.round(sum((day) => day.iprUnits) * 10) / 10
  );
  const subsistenceDayNames = days
    .filter((day) => day.subsistence)
    .map((day) => DAY_NAMES[day.dayOfWeek] ?? String(day.dayOfWeek));

  return {
    ruleSetKey: input.rule.key,
    weekEnding: input.weekEnding,
    basicMinutes: sum((day) => day.basicMinutes),
    overtimeMinutes: sum((day) => day.overtimeMinutes),
    doubleTimeMinutes: sum((day) => day.doubleTimeMinutes),
    payableMinutes: sum((day) => day.payableMinutes),
    paidLeaveUnits: sum((day) => day.paidLeaveUnits),
    unpaidLeaveUnits: sum((day) => day.unpaidLeaveUnits),
    operatorTravelMinutes: sum((day) => day.operatorTravelMinutes),
    iprUnits,
    subsistenceDays: subsistenceDayNames.length,
    subsistenceDayNames,
    days,
  };
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
