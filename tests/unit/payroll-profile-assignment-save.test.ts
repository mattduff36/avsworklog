import { describe, expect, it } from 'vitest';
import {
  decidePayrollAssignmentWrite,
  getCurrentPayrollWeekEndingSunday,
  PayrollAssignmentConflictError,
  savePayrollProfileAssignment,
  validatePayrollProfileAssignmentInput,
  type PayrollAdminSqlClient,
} from '@/lib/server/payroll-admin';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

function createMockPayrollAdminClient(input: {
  existing?: { id: string; rule_set_id: string | null; is_active: boolean } | null;
  ruleSetId?: string;
}) {
  const queries: string[] = [];
  let inserted = false;
  const client: PayrollAdminSqlClient = {
    async connect() {},
    async end() {},
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (normalized.includes('FROM public.profiles')) {
        return { rows: [{ id: PROFILE_ID }] };
      }
      if (normalized.includes('FROM public.payroll_rule_sets')) {
        return { rows: [{ id: input.ruleSetId ?? 'rule-plant' }] };
      }
      if (normalized.includes('FROM public.payroll_profile_rule_assignments')) {
        return { rows: input.existing ? [input.existing] : [] };
      }
      if (normalized.startsWith('INSERT INTO public.payroll_profile_rule_assignments')) {
        inserted = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return {
    client,
    queries,
    wasInserted: () => inserted,
  };
}

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

  it('PAY-VERIFY-001 inserts, retries, and conflicts through the serializable save path', async () => {
    const sunday = getCurrentPayrollWeekEndingSunday();
    const insertMock = createMockPayrollAdminClient({});
    await expect(savePayrollProfileAssignment({
      profileId: PROFILE_ID,
      ruleSetKey: 'plant',
      effectiveWeekEnding: sunday,
      actorId: 'actor',
      createClient: () => insertMock.client,
    })).resolves.toEqual({ alreadyExists: false });
    expect(insertMock.wasInserted()).toBe(true);
    expect(insertMock.queries.some((sql) => sql.includes('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE'))).toBe(true);
    expect(insertMock.queries.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);

    const retryMock = createMockPayrollAdminClient({
      existing: { id: 'asg-1', rule_set_id: 'rule-plant', is_active: true },
    });
    await expect(savePayrollProfileAssignment({
      profileId: PROFILE_ID,
      ruleSetKey: 'plant',
      effectiveWeekEnding: sunday,
      actorId: 'actor',
      createClient: () => retryMock.client,
    })).resolves.toEqual({ alreadyExists: true });
    expect(retryMock.wasInserted()).toBe(false);

    const conflictMock = createMockPayrollAdminClient({
      existing: { id: 'asg-2', rule_set_id: 'rule-civils', is_active: true },
    });
    await expect(savePayrollProfileAssignment({
      profileId: PROFILE_ID,
      ruleSetKey: 'plant',
      effectiveWeekEnding: sunday,
      actorId: 'actor',
      createClient: () => conflictMock.client,
    })).rejects.toBeInstanceOf(PayrollAssignmentConflictError);
    expect(conflictMock.wasInserted()).toBe(false);
  });
});
