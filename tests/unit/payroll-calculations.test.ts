import { describe, expect, it } from 'vitest';
import { calculatePayrollWeek } from '@/lib/payroll/calculate';
import { resolvePayrollRuleAssignment } from '@/lib/payroll/assignment';
import { getSignedPayrollRule } from '@/lib/payroll/schema';
import type { PayrollDayInput, PayrollRuleSetKey } from '@/lib/payroll/types';

function calculate(
  ruleSetKey: PayrollRuleSetKey,
  day: Partial<PayrollDayInput> & Pick<PayrollDayInput, 'dayOfWeek'>
) {
  return calculatePayrollWeek({
    weekEnding: '2026-08-09',
    rule: getSignedPayrollRule(ruleSetKey),
    days: [{
      timeStarted: '07:30',
      timeFinished: '18:00',
      ...day,
    }],
  });
}

describe('signed payroll rule engine', () => {
  it('PAY-RULE-LORRIES-001 applies weekday, Saturday and Sunday bands', () => {
    for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek += 1) {
      expect(calculate('lorries', { dayOfWeek }).basicMinutes).toBe(600);
    }
    const saturday = calculate('lorries', { dayOfWeek: 6 });
    expect(saturday.overtimeMinutes).toBe(240);
    expect(saturday.doubleTimeMinutes).toBe(360);
    expect(calculate('lorries', { dayOfWeek: 7 }).doubleTimeMinutes).toBe(600);
  });

  it('PAY-RULE-CIVILS-001 applies weekday, weekend and night bands', () => {
    for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek += 1) {
      expect(calculate('civils', { dayOfWeek }).basicMinutes).toBe(600);
    }
    expect(calculate('civils', { dayOfWeek: 6 }).overtimeMinutes).toBe(600);
    expect(calculate('civils', { dayOfWeek: 7 }).overtimeMinutes).toBe(600);
    expect(calculate('civils', { dayOfWeek: 1, nightShift: true }).doubleTimeMinutes).toBe(600);
  });

  it('PAY-RULE-PLANT-001 applies weekday caps and weekend boundaries', () => {
    for (let dayOfWeek = 1; dayOfWeek <= 4; dayOfWeek += 1) {
      const weekday = calculate('plant', { dayOfWeek });
      expect(weekday.basicMinutes).toBe(480);
      expect(weekday.overtimeMinutes).toBe(120);
    }

    const friday = calculate('plant', { dayOfWeek: 5 });
    expect(friday.basicMinutes).toBe(420);
    expect(friday.overtimeMinutes).toBe(180);

    const saturday = calculate('plant', { dayOfWeek: 6 });
    expect(saturday.overtimeMinutes).toBe(240);
    expect(saturday.doubleTimeMinutes).toBe(360);
    expect(calculate('plant', { dayOfWeek: 7 }).doubleTimeMinutes).toBe(600);
  });

  it('PAY-RULE-OTHERS-001 applies Plant calendar bands and night Double Time', () => {
    for (let dayOfWeek = 1; dayOfWeek <= 4; dayOfWeek += 1) {
      const weekday = calculate('others', { dayOfWeek });
      expect(weekday.basicMinutes).toBe(480);
      expect(weekday.overtimeMinutes).toBe(120);
    }
    const friday = calculate('others', { dayOfWeek: 5 });
    expect(friday.basicMinutes).toBe(420);
    expect(friday.overtimeMinutes).toBe(180);
    const saturday = calculate('others', { dayOfWeek: 6 });
    expect(saturday.overtimeMinutes).toBe(240);
    expect(saturday.doubleTimeMinutes).toBe(360);
    expect(calculate('others', { dayOfWeek: 7 }).doubleTimeMinutes).toBe(600);
    expect(calculate('others', { dayOfWeek: 1, nightShift: true }).doubleTimeMinutes).toBe(600);
  });

  it('PAY-PRECEDENCE-001 makes bank holiday highest and ignores Lorries night premium', () => {
    for (const ruleSetKey of ['lorries', 'civils', 'plant', 'others'] as PayrollRuleSetKey[]) {
      const bankHoliday = calculate(ruleSetKey, {
        dayOfWeek: 6,
        nightShift: true,
        bankHoliday: true,
      });
      expect(bankHoliday.days[0].treatmentReason).toBe('bank_holiday');
      expect(bankHoliday.doubleTimeMinutes).toBe(600);
    }

    const lorriesNight = calculate('lorries', { dayOfWeek: 1, nightShift: true });
    expect(lorriesNight.basicMinutes).toBe(600);
    expect(lorriesNight.doubleTimeMinutes).toBe(0);
  });

  it('PAY-BREAK-001 deducts only when rounded elapsed exceeds six hours', () => {
    expect(calculate('civils', {
      dayOfWeek: 1,
      timeStarted: '08:00',
      timeFinished: '14:00',
    }).payableMinutes).toBe(360);
    expect(calculate('civils', {
      dayOfWeek: 1,
      timeStarted: '08:00',
      timeFinished: '14:08',
    }).payableMinutes).toBe(345);
  });

  it('PAY-ROUNDING-001 rounds endpoints before calculating and supports overnight work', () => {
    const result = calculate('civils', {
      dayOfWeek: 1,
      timeStarted: '22:53',
      timeFinished: '05:07',
    });
    expect(result.days[0].roundedTimeStarted).toBe('23:00');
    expect(result.days[0].roundedTimeFinished).toBe('05:00');
    expect(result.days[0].elapsedMinutes).toBe(360);
  });

  it('PAY-RAW-TOTALS-001 keeps rate buckets as raw hours', () => {
    const result = calculate('plant', { dayOfWeek: 1 });
    expect(result.basicMinutes + result.overtimeMinutes + result.doubleTimeMinutes)
      .toBe(result.payableMinutes);
  });

  it('PAY-TRAVEL-001 and PAY-IPR-001 keep Plant travel separate and cap IPR', () => {
    const days: PayrollDayInput[] = Array.from({ length: 7 }, (_, index) => ({
      dayOfWeek: index + 1,
      timeStarted: '08:00',
      timeFinished: '16:00',
      operatorTravelHours: 1,
    }));
    const result = calculatePayrollWeek({
      weekEnding: '2026-08-09',
      rule: getSignedPayrollRule('plant'),
      days,
    });
    expect(result.operatorTravelMinutes).toBe(420);
    expect(result.iprUnits).toBe(1);
    expect(result.payableMinutes).toBe(7 * 450);
  });

  it('PAY-LEAVE-001 and PAY-SUBSISTENCE-001 keep days and names separate', () => {
    const result = calculatePayrollWeek({
      weekEnding: '2026-08-09',
      rule: getSignedPayrollRule('civils'),
      days: [
        {
          dayOfWeek: 1,
          timeStarted: null,
          timeFinished: null,
          didNotWork: true,
          paidLeaveUnits: 1,
        },
        {
          dayOfWeek: 2,
          timeStarted: '08:00',
          timeFinished: '14:00',
          unpaidLeaveUnits: 0.5,
          subsistence: true,
        },
      ],
    });
    expect(result.paidLeaveUnits).toBe(1);
    expect(result.unpaidLeaveUnits).toBe(0.5);
    expect(result.subsistenceDayNames).toEqual(['Tuesday']);
  });
});

describe('payroll assignment resolution', () => {
  it('PAY-ASSIGNMENT-001 applies profile, team, then Civils fallback precedence', () => {
    expect(resolvePayrollRuleAssignment({
      profileId: 'profile',
      teamId: 'team',
      profileRuleSetKey: 'others',
      teamRuleSetKey: 'plant',
    }).ruleSetKey).toBe('others');
    expect(resolvePayrollRuleAssignment({
      profileId: 'profile',
      teamId: 'team',
      teamRuleSetKey: 'plant',
    }).ruleSetKey).toBe('plant');
    expect(resolvePayrollRuleAssignment({
      profileId: 'profile',
      teamId: null,
    }).ruleSetKey).toBe('civils');
  });
});
