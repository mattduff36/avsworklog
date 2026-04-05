import { describe, expect, it } from 'vitest';
import { hasWorkshopInspectionFullVisibilityOverride } from '@/lib/utils/inspection-visibility';

describe('hasWorkshopInspectionFullVisibilityOverride', () => {
  it('returns true for Workshop team', () => {
    expect(hasWorkshopInspectionFullVisibilityOverride('Workshop')).toBe(true);
  });

  it('returns true for mixed-case workshop team name', () => {
    expect(hasWorkshopInspectionFullVisibilityOverride('wOrKsHoP')).toBe(true);
  });

  it('returns false for non-workshop teams', () => {
    expect(hasWorkshopInspectionFullVisibilityOverride('Accounts')).toBe(false);
  });
});
