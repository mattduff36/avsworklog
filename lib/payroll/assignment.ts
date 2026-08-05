import type { PayrollAssignment, PayrollRuleSetKey } from './types';

export interface PayrollRuleAssignmentInput {
  profileId: string;
  teamId: string | null;
  profileRuleSetKey?: PayrollRuleSetKey | null;
  teamRuleSetKey?: PayrollRuleSetKey | null;
}

export function resolvePayrollRuleAssignment(input: PayrollRuleAssignmentInput): PayrollAssignment {
  if (input.profileRuleSetKey) {
    return {
      ruleSetKey: input.profileRuleSetKey,
      source: 'profile',
      sourceId: input.profileId,
    };
  }

  if (input.teamRuleSetKey) {
    return {
      ruleSetKey: input.teamRuleSetKey,
      source: 'team',
      sourceId: input.teamId,
    };
  }

  return {
    ruleSetKey: 'civils',
    source: 'fallback',
    sourceId: null,
  };
}
