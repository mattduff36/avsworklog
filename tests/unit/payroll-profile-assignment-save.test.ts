import { describe, expect, it } from 'vitest';
import {
  decidePayrollAssignmentWrite,
  getCurrentPayrollWeekEndingSunday,
  savePayrollProfileAssignment,
  validatePayrollProfileAssignmentInput,
} from '@/lib/server/payroll-admin';

describe('savePayrollProfileAssignment validation', () => {
  it('PAY-OVERRIDE-SAVE-001 rejects invalid or retroactive overrides before writing', async () => {
    await expect(savePayrollProfileAssignment({
      profileId: 'not-a-uuid',
      ruleSetKey: 'plant',
      effectiveWeekEnding: getCurrentPayrollWeekEndingSunday(),
      actorId: 'actor',
    })).rejects.toThrow(/valid employee profile/);

    await expect(savePayrollProfileAssignment({
      profileId: '11111111-1111-4111-8111-111111111111',
      ruleSetKey: 'plant',
      effectiveWeekEnding: '2026-08-26',
      actorId: 'actor',
    })).rejects.toThrow(/Sunday/);

    await expect(savePayrollProfileAssignment({
      profileId: '11111111-1111-4111-8111-111111111111',
      ruleSetKey: 'plant',
      effectiveWeekEnding: '2020-01-05',
      actorId: 'actor',
    })).rejects.toThrow(/cannot start before/);
  });

  it('PAY-OVERRIDE-SAVE-001 and PAY-VERIFY-001 accept a future Sunday and classify insert, retry and conflict', () => {
    const sunday = getCurrentPayrollWeekEndingSunday();
    expect(validatePayrollProfileAssignmentInput({
      profileId: '11111111-1111-4111-8111-111111111111',
      ruleSetKey: 'plant',
      effectiveWeekEnding: sunday,
    })).toEqual({
      profileId: '11111111-1111-4111-8111-111111111111',
      ruleSetKey: 'plant',
      effectiveWeekEnding: sunday,
    });

    expect(decidePayrollAssignmentWrite({
      existing: null,
      nextRuleSetId: 'rule-plant',
      nextIsActive: true,
    })).toBe('insert');
    expect(decidePayrollAssignmentWrite({
      existing: { ruleSetId: 'rule-plant', isActive: true },
      nextRuleSetId: 'rule-plant',
      nextIsActive: true,
    })).toBe('already_exists');
    expect(decidePayrollAssignmentWrite({
      existing: { ruleSetId: 'rule-civils', isActive: true },
      nextRuleSetId: 'rule-plant',
      nextIsActive: true,
    })).toBe('conflict');
  });
});
