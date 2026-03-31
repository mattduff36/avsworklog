import { describe, expect, it } from 'vitest';
import {
  normalizeTimesheetType,
  resolveTimesheetTypeWithOverride,
} from '@/app/(dashboard)/timesheets/hooks/useTimesheetType';

describe('timesheet type resolution with overrides', () => {
  it('normalizes known timesheet types only', () => {
    expect(normalizeTimesheetType('civils')).toBe('civils');
    expect(normalizeTimesheetType('plant')).toBe('plant');
    expect(normalizeTimesheetType('unknown')).toBeNull();
    expect(normalizeTimesheetType(null)).toBeNull();
  });

  it('prefers user override over team and role defaults', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: 'plant',
        teamType: 'civils',
        roleType: 'civils',
      })
    ).toBe('plant');
  });

  it('falls back to team default when override is absent', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: null,
        teamType: 'plant',
        roleType: 'civils',
      })
    ).toBe('plant');
  });

  it('falls back to role when team has no type', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: null,
        teamType: null,
        roleType: 'plant',
      })
    ).toBe('plant');
  });

  it('uses civils default when no source provides a type', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: null,
        teamType: null,
        roleType: null,
      })
    ).toBe('civils');
  });
});
