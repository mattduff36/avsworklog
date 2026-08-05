import type { PayrollRuleConfiguration, PayrollRuleSetKey } from '@/lib/payroll/types';

export interface PayrollRuleVersionAdminRecord {
  id: string;
  version_number: number;
  status: 'draft' | 'active' | 'archived';
  effective_week_ending: string | null;
  configuration: PayrollRuleConfiguration;
}

export interface PayrollRuleSetAdminRecord {
  id: string;
  rule_key: PayrollRuleSetKey;
  name: string;
  status: 'draft' | 'active' | 'archived';
  versions: PayrollRuleVersionAdminRecord[];
}

export interface PayrollTeamOption {
  id: string;
  name: string;
}

export interface PayrollProfileOption {
  id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
}

export interface PayrollTeamAssignmentInput {
  teamId: string;
  ruleSetKey: PayrollRuleSetKey;
}

export interface PayrollProfileAssignmentInput {
  profileId: string;
  ruleSetKey: PayrollRuleSetKey;
}

export interface PayrollAdminMatrix {
  rules: PayrollRuleSetAdminRecord[];
  teams: PayrollTeamOption[];
  profiles: PayrollProfileOption[];
  teamAssignments: Array<PayrollTeamAssignmentInput & { effectiveWeekEnding: string }>;
  profileAssignments: Array<PayrollProfileAssignmentInput & { effectiveWeekEnding: string }>;
  rolloutWeekEnding: string | null;
  impactedUnapprovedTimesheets: number;
}
