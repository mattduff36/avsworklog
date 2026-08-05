import type {
  PayrollDayBand,
  PayrollRuleConfiguration,
  PayrollRuleSetKey,
  PayrollTreatment,
} from './types';

const BASIC: PayrollTreatment = 'basic';
const OVERTIME: PayrollTreatment = 'overtime';
const DOUBLE_TIME: PayrollTreatment = 'double_time';

function allWeekdays(band: PayrollDayBand): Record<number, PayrollDayBand> {
  return {
    1: band,
    2: band,
    3: band,
    4: band,
    5: band,
    6: band,
    7: band,
  };
}

const SIGNED_RULES: Record<PayrollRuleSetKey, PayrollRuleConfiguration> = {
  lorries: {
    key: 'lorries',
    name: 'Transport',
    breakThresholdMinutes: 360,
    breakDeductionMinutes: 30,
    bankHolidayTreatment: DOUBLE_TIME,
    nightShiftTreatment: null,
    operatorTravelEnabled: false,
    iprUnitsPerWorkedDay: 0,
    iprWeeklyCap: 0,
    dayBands: {
      ...allWeekdays({ treatment: BASIC }),
      6: { treatment: OVERTIME, upToMinutes: 240, remainderTreatment: DOUBLE_TIME },
      7: { treatment: DOUBLE_TIME },
    },
  },
  civils: {
    key: 'civils',
    name: 'Civils',
    breakThresholdMinutes: 360,
    breakDeductionMinutes: 30,
    bankHolidayTreatment: DOUBLE_TIME,
    nightShiftTreatment: DOUBLE_TIME,
    operatorTravelEnabled: false,
    iprUnitsPerWorkedDay: 0,
    iprWeeklyCap: 0,
    dayBands: {
      ...allWeekdays({ treatment: BASIC }),
      6: { treatment: OVERTIME },
      7: { treatment: OVERTIME },
    },
  },
  plant: {
    key: 'plant',
    name: 'Plant',
    breakThresholdMinutes: 360,
    breakDeductionMinutes: 30,
    bankHolidayTreatment: DOUBLE_TIME,
    nightShiftTreatment: DOUBLE_TIME,
    operatorTravelEnabled: true,
    iprUnitsPerWorkedDay: 0.2,
    iprWeeklyCap: 1,
    dayBands: {
      1: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      2: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      3: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      4: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      5: { treatment: BASIC, upToMinutes: 420, remainderTreatment: OVERTIME },
      6: { treatment: OVERTIME, upToMinutes: 240, remainderTreatment: DOUBLE_TIME },
      7: { treatment: DOUBLE_TIME },
    },
  },
  others: {
    key: 'others',
    name: 'Others',
    breakThresholdMinutes: 360,
    breakDeductionMinutes: 30,
    bankHolidayTreatment: DOUBLE_TIME,
    nightShiftTreatment: DOUBLE_TIME,
    operatorTravelEnabled: false,
    iprUnitsPerWorkedDay: 0,
    iprWeeklyCap: 0,
    dayBands: {
      1: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      2: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      3: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      4: { treatment: BASIC, upToMinutes: 480, remainderTreatment: OVERTIME },
      5: { treatment: BASIC, upToMinutes: 420, remainderTreatment: OVERTIME },
      6: { treatment: OVERTIME, upToMinutes: 240, remainderTreatment: DOUBLE_TIME },
      7: { treatment: DOUBLE_TIME },
    },
  },
};

export function getSignedPayrollRule(key: PayrollRuleSetKey): PayrollRuleConfiguration {
  return structuredClone(SIGNED_RULES[key]);
}

export function getAllSignedPayrollRules(): PayrollRuleConfiguration[] {
  return (Object.keys(SIGNED_RULES) as PayrollRuleSetKey[]).map(getSignedPayrollRule);
}

export function validatePayrollRule(rule: PayrollRuleConfiguration): string[] {
  const errors: string[] = [];
  if (rule.breakThresholdMinutes < 0) errors.push('Break threshold cannot be negative.');
  if (rule.breakDeductionMinutes < 0) errors.push('Break deduction cannot be negative.');
  if (rule.breakDeductionMinutes > rule.breakThresholdMinutes) {
    errors.push('Break deduction cannot exceed the threshold.');
  }

  for (let day = 1; day <= 7; day += 1) {
    const band = rule.dayBands[day];
    if (!band) {
      errors.push(`Day ${day} is missing a pay band.`);
      continue;
    }
    if (band.upToMinutes !== undefined && band.upToMinutes <= 0) {
      errors.push(`Day ${day} band limit must be positive.`);
    }
    if (band.upToMinutes !== undefined && !band.remainderTreatment) {
      errors.push(`Day ${day} requires a remainder treatment.`);
    }
  }

  if (rule.iprUnitsPerWorkedDay < 0 || rule.iprWeeklyCap < 0) {
    errors.push('IPR values cannot be negative.');
  }
  if (rule.iprUnitsPerWorkedDay > rule.iprWeeklyCap && rule.iprWeeklyCap > 0) {
    errors.push('Daily IPR cannot exceed the weekly cap.');
  }
  return errors;
}
