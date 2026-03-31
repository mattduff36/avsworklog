import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(dashboard)/timesheets/types/civils/CivilsTimesheet', () => ({
  CivilsTimesheet: () => null,
}));

vi.mock('@/app/(dashboard)/timesheets/types/plant/PlantTimesheet', () => ({
  PlantTimesheet: () => null,
}));

import {
  DEFAULT_TIMESHEET_TYPE,
  TimesheetRegistry,
  getTimesheetTypeLabel,
  isTimesheetTypeImplemented,
} from '@/app/(dashboard)/timesheets/types/registry';

describe('timesheet registry', () => {
  it('keeps civils as the default type', () => {
    expect(DEFAULT_TIMESHEET_TYPE).toBe('civils');
  });

  it('registers plant as an implemented type', () => {
    expect(isTimesheetTypeImplemented('plant')).toBe(true);
    expect(TimesheetRegistry.plant).toBeTypeOf('function');
  });

  it('returns the expected label for plant', () => {
    expect(getTimesheetTypeLabel('plant')).toBe('Plant Timesheet');
  });

  it('returns the expected label for the default timesheet type', () => {
    expect(getTimesheetTypeLabel('civils')).toBe('Standard Timesheet');
  });
});
