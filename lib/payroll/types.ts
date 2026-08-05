export type PayrollRuleSetKey = 'lorries' | 'civils' | 'plant' | 'others';

export type PayrollTreatment = 'basic' | 'overtime' | 'double_time';

export type PayrollAssignmentSource = 'profile' | 'team' | 'fallback';

export interface PayrollDayBand {
  treatment: PayrollTreatment;
  upToMinutes?: number;
  remainderTreatment?: PayrollTreatment;
}

export interface PayrollRuleConfiguration {
  key: PayrollRuleSetKey;
  name: string;
  breakThresholdMinutes: number;
  breakDeductionMinutes: number;
  bankHolidayTreatment: PayrollTreatment;
  nightShiftTreatment: PayrollTreatment | null;
  dayBands: Record<number, PayrollDayBand>;
  operatorTravelEnabled: boolean;
  iprUnitsPerWorkedDay: number;
  iprWeeklyCap: number;
}

export interface PayrollAssignment {
  ruleSetKey: PayrollRuleSetKey;
  source: PayrollAssignmentSource;
  sourceId: string | null;
}

export interface PayrollDayInput {
  dayOfWeek: number;
  timeStarted: string | null;
  timeFinished: string | null;
  workedMinutesOverride?: number | null;
  nightShift?: boolean;
  bankHoliday?: boolean;
  didNotWork?: boolean;
  paidLeaveUnits?: number;
  unpaidLeaveUnits?: number;
  operatorTravelHours?: number | null;
  subsistence?: boolean;
}

export interface PayrollWeekInput {
  weekEnding: string;
  rule: PayrollRuleConfiguration;
  days: PayrollDayInput[];
}

export interface PayrollDayBreakdown {
  dayOfWeek: number;
  roundedTimeStarted: string | null;
  roundedTimeFinished: string | null;
  elapsedMinutes: number;
  breakMinutes: number;
  payableMinutes: number;
  basicMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  operatorTravelMinutes: number;
  iprUnits: number;
  subsistence: boolean;
  treatmentReason: 'did_not_work' | 'bank_holiday' | 'night_shift' | 'calendar';
}

export interface PayrollWeekBreakdown {
  ruleSetKey: PayrollRuleSetKey;
  weekEnding: string;
  basicMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  payableMinutes: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  operatorTravelMinutes: number;
  iprUnits: number;
  subsistenceDays: number;
  subsistenceDayNames: string[];
  days: PayrollDayBreakdown[];
}

export interface LegacyPayrollDayInput {
  dayOfWeek: number;
  workedHours: number;
  nightShift?: boolean;
  bankHoliday?: boolean;
}

export interface LegacyPayrollBreakdown {
  basicHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  totalHours: number;
}
