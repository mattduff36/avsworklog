import { describe, expect, it } from 'vitest';
import { shouldUsePlantTimesheetV2Template } from '@/lib/pdf/timesheet-template-selector';

describe('shouldUsePlantTimesheetV2Template', () => {
  it('returns true for plant template v2', () => {
    expect(
      shouldUsePlantTimesheetV2Template({
        timesheet_type: 'plant',
        template_version: 2,
      })
    ).toBe(true);
  });

  it('returns false for legacy plant records', () => {
    expect(
      shouldUsePlantTimesheetV2Template({
        timesheet_type: 'plant',
        template_version: 1,
      })
    ).toBe(false);
  });

  it('returns false for civils records', () => {
    expect(
      shouldUsePlantTimesheetV2Template({
        timesheet_type: 'civils',
        template_version: 2,
      })
    ).toBe(false);
  });
});
