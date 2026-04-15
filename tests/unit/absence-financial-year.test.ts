import { describe, expect, it } from 'vitest';

import {
  absenceSpansMultipleFinancialYears,
  getCrossFinancialYearAbsenceError,
  getResolvedAbsenceEndDate,
} from '@/lib/utils/absence-financial-year';

describe('absence financial year helpers', () => {
  it('resolves the end date to the start date when none is provided', () => {
    expect(getResolvedAbsenceEndDate('2026-04-01', null)).toBe('2026-04-01');
  });

  it('detects ranges that cross the 31 March / 1 April boundary', () => {
    expect(absenceSpansMultipleFinancialYears('2026-03-30', '2026-04-02')).toBe(true);
    expect(getCrossFinancialYearAbsenceError('2026-03-30', '2026-04-02')).toContain(
      'cannot span multiple financial years'
    );
  });

  it('allows single-financial-year bookings', () => {
    expect(absenceSpansMultipleFinancialYears('2026-04-01', '2026-04-02')).toBe(false);
    expect(getCrossFinancialYearAbsenceError('2026-04-01', '2026-04-02')).toBeNull();
  });
});
