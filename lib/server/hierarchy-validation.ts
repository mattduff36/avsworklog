import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoleClass as getTeamRoleClass, shouldClearOwnManagers } from '@/lib/server/team-managers';

export type HierarchyValidationIssueCode =
  | 'MISSING_TEAM'
  | 'MISSING_LINE_MANAGER'
  | 'SELF_MANAGER'
  | 'UNKNOWN_MANAGER'
  | 'MANAGER_CYCLE'
  | 'INVALID_MANAGER_ROLE'
  | 'MANAGER_SHOULD_NOT_HAVE_MANAGER'
  | 'TEAM_MANAGER_DRIFT'
  | 'INVALID_TEAM_MANAGER';

export interface HierarchyValidationIssue {
  code: HierarchyValidationIssueCode;
  profile_id: string;
  full_name: string;
  team_id: string | null;
  details: string;
}

interface ProfileValidationRow {
  id: string;
  full_name: string | null;
  team_id?: string | null;
  line_manager_id?: string | null;
  secondary_manager_id?: string | null;
  is_placeholder?: boolean | null;
  role?: { role_class?: 'admin' | 'manager' | 'employee' } | null;
}

interface TeamValidationRow {
  id: string;
  name: string;
  manager_1_profile_id?: string | null;
  manager_2_profile_id?: string | null;
}

interface ReportingLineValidationRow {
  profile_id: string;
  manager_profile_id: string;
  relation_type: 'primary' | 'secondary' | 'line_manager';
}

type SupabaseLikeClient = SupabaseClient;

export function isMissingHierarchySchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';
  const isMissingObjectMessage = message.includes('does not exist');
  return (
    code === '42P01' ||
    code === '42703' ||
    (isMissingObjectMessage &&
      (
        message.includes('team_id') ||
        message.includes('line_manager_id') ||
        message.includes('secondary_manager_id') ||
        message.includes('manager_1_profile_id') ||
        message.includes('manager_2_profile_id') ||
        message.includes('is_placeholder') ||
        message.includes('profile_reporting_lines') ||
        message.includes('org_team_feature_modes') ||
        message.includes('column')
      ))
  );
}

export function isBlockingHierarchyIssue(code: HierarchyValidationIssueCode): boolean {
  return (
    code === 'MISSING_TEAM' ||
    code === 'MISSING_LINE_MANAGER' ||
    code === 'SELF_MANAGER' ||
    code === 'UNKNOWN_MANAGER' ||
    code === 'MANAGER_CYCLE'
  );
}

function getRoleClass(row: ProfileValidationRow): 'admin' | 'manager' | 'employee' {
  return getTeamRoleClass(row);
}

function detectManagerCycles(rows: ProfileValidationRow[]): Set<string> {
  const managerByProfile = new Map<string, string>();
  rows.forEach((row) => {
    if (row.line_manager_id) {
      managerByProfile.set(row.id, row.line_manager_id);
    }
  });

  const cycleMembers = new Set<string>();
  const permanentlyVisited = new Set<string>();

  const visit = (profileId: string, stack: string[]) => {
    if (permanentlyVisited.has(profileId)) {
      return;
    }

    const cycleStartIndex = stack.indexOf(profileId);
    if (cycleStartIndex >= 0) {
      stack.slice(cycleStartIndex).forEach((memberId) => cycleMembers.add(memberId));
      cycleMembers.add(profileId);
      return;
    }

    const nextManager = managerByProfile.get(profileId);
    if (!nextManager) {
      permanentlyVisited.add(profileId);
      return;
    }

    visit(nextManager, [...stack, profileId]);
    permanentlyVisited.add(profileId);
  };

  rows.forEach((row) => visit(row.id, []));
  return cycleMembers;
}

function buildTeamIssueCounts(issues: HierarchyValidationIssue[]): Record<string, number> {
  return issues.reduce<Record<string, number>>((acc, issue) => {
    const key = issue.team_id || 'unassigned';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export async function runHierarchyValidation(
  supabaseAdmin: SupabaseLikeClient,
  options?: { teamId?: string }
): Promise<{
  configured: boolean;
  issues: HierarchyValidationIssue[];
  team_issue_counts: Record<string, number>;
  blocking_issue_count: number;
  warning?: string;
  summary: { total_profiles: number; issue_count: number };
}> {
  const profileQuery = supabaseAdmin
    .from('profiles')
    .select(`
      id,
      full_name,
      team_id,
      line_manager_id,
      secondary_manager_id,
      is_placeholder,
      role:roles(role_class)
    `);
  const teamQuery = supabaseAdmin
    .from('org_teams')
    .select('id, name, manager_1_profile_id, manager_2_profile_id');
  const reportingQuery = supabaseAdmin
    .from('profile_reporting_lines')
    .select('profile_id, manager_profile_id, relation_type')
    .in?.('relation_type', ['primary', 'secondary'])
    ?.is?.('valid_to', null);

  const [profilesResult, teamsResult, reportingResult] = await Promise.all([
    profileQuery.order ? profileQuery.order('full_name', { ascending: true }) : Promise.resolve({ data: [], error: null }),
    teamQuery.order ? teamQuery.order('name', { ascending: true }) : Promise.resolve({ data: [], error: null }),
    reportingQuery || Promise.resolve({ data: [], error: null }),
  ]);

  const compositeError = profilesResult.error || teamsResult.error || reportingResult.error;
  if (compositeError) {
    if (isMissingHierarchySchemaError(compositeError)) {
      return {
        configured: false,
        issues: [],
        team_issue_counts: {},
        blocking_issue_count: 0,
        warning: 'Hierarchy columns are not available yet.',
        summary: { total_profiles: 0, issue_count: 0 },
      };
    }
    throw compositeError;
  }

  const rows = (profilesResult.data || []) as ProfileValidationRow[];
  const teams = (teamsResult.data || []) as TeamValidationRow[];
  const reportingRows = (reportingResult.data || []) as ReportingLineValidationRow[];

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const cycleMembers = detectManagerCycles(rows);
  const issues: HierarchyValidationIssue[] = [];
  const reportingPrimaryByProfile = new Map<string, string>();
  const reportingSecondaryByProfile = new Map<string, string>();
  const employeeCountByTeam = new Map<string, number>();

  reportingRows.forEach((row) => {
    if (row.relation_type === 'primary') {
      reportingPrimaryByProfile.set(row.profile_id, row.manager_profile_id);
    }
    if (row.relation_type === 'secondary') {
      reportingSecondaryByProfile.set(row.profile_id, row.manager_profile_id);
    }
  });

  rows.forEach((row) => {
    if (getRoleClass(row) === 'employee' && row.team_id) {
      employeeCountByTeam.set(row.team_id, (employeeCountByTeam.get(row.team_id) || 0) + 1);
    }
  });

  for (const team of teams) {
    const employeeCount = employeeCountByTeam.get(team.id) || 0;
    const slots = [
      ['Manager 1', team.manager_1_profile_id || null],
      ['Manager 2', team.manager_2_profile_id || null],
    ] as const;

    if (employeeCount > 0 && !team.manager_1_profile_id) {
      issues.push({
        code: 'INVALID_TEAM_MANAGER',
        profile_id: `team:${team.id}:manager_1`,
        full_name: team.name,
        team_id: team.id,
        details: 'Team has employees but no Manager 1 assigned.',
      });
    }

    for (const [label, managerId] of slots) {
      if (!managerId) continue;
      const manager = rowsById.get(managerId);
      if (!manager) {
        issues.push({
          code: 'INVALID_TEAM_MANAGER',
          profile_id: `team:${team.id}:${label.toLowerCase().replace(/\s+/g, '_')}`,
          full_name: team.name,
          team_id: team.id,
          details: `${label} does not match an existing profile.`,
        });
        continue;
      }
      if (getRoleClass(manager) === 'employee') {
        issues.push({
          code: 'INVALID_TEAM_MANAGER',
          profile_id: manager.id,
          full_name: manager.full_name || team.name,
          team_id: team.id,
          details: `${label} is assigned to an employee profile.`,
        });
      }
    }
  }

  rows.forEach((row) => {
    const roleClass = getRoleClass(row);
    const teamId = row.team_id || null;
    const fullName = row.full_name || 'Unknown';
    const team = teamId ? teamsById.get(teamId) : null;
    const expectedManager1 = team?.manager_1_profile_id || null;
    const expectedManager2 = team?.manager_2_profile_id || null;

    if (!teamId) {
      issues.push({
        code: 'MISSING_TEAM',
        profile_id: row.id,
        full_name: fullName,
        team_id: null,
        details: 'User has no team assigned.',
      });
    }

    const needsManager1 = roleClass === 'employee';
    if (needsManager1 && !row.line_manager_id) {
      issues.push({
        code: 'MISSING_LINE_MANAGER',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Employee has no Manager 1 assigned.',
      });
    }

    if (row.line_manager_id && row.line_manager_id === row.id) {
      issues.push({
        code: 'SELF_MANAGER',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'User cannot be their own Manager 1.',
      });
    }

    if (row.secondary_manager_id && row.secondary_manager_id === row.id) {
      issues.push({
        code: 'SELF_MANAGER',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'User cannot be their own Manager 2.',
      });
    }

    if (row.line_manager_id && !rowsById.has(row.line_manager_id)) {
      issues.push({
        code: 'UNKNOWN_MANAGER',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Manager 1 reference does not match an existing profile.',
      });
    }

    if (row.secondary_manager_id && !rowsById.has(row.secondary_manager_id)) {
      issues.push({
        code: 'UNKNOWN_MANAGER',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Manager 2 reference does not match an existing profile.',
      });
    }

    const manager1 = row.line_manager_id ? rowsById.get(row.line_manager_id) : undefined;
    const manager2 = row.secondary_manager_id ? rowsById.get(row.secondary_manager_id) : undefined;
    const manager1RoleClass = manager1 ? getRoleClass(manager1) : null;
    const manager2RoleClass = manager2 ? getRoleClass(manager2) : null;

    if (manager1RoleClass === 'employee') {
      issues.push({
        code: 'INVALID_MANAGER_ROLE',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Manager 1 points at an employee profile.',
      });
    }

    if (manager2RoleClass === 'employee') {
      issues.push({
        code: 'INVALID_MANAGER_ROLE',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Manager 2 points at an employee profile.',
      });
    }

    if (shouldClearOwnManagers(roleClass) && (row.line_manager_id || row.secondary_manager_id)) {
      issues.push({
        code: 'MANAGER_SHOULD_NOT_HAVE_MANAGER',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Managers and admins should not have Manager 1 or Manager 2 assigned.',
      });
    }

    if (
      roleClass === 'employee' &&
      ((row.line_manager_id || null) !== expectedManager1 || (row.secondary_manager_id || null) !== expectedManager2)
    ) {
      issues.push({
        code: 'TEAM_MANAGER_DRIFT',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Derived manager fields do not match the assigned team manager slots.',
      });
    }

    if (
      (reportingPrimaryByProfile.get(row.id) || null) !== (row.line_manager_id || null) ||
      (reportingSecondaryByProfile.get(row.id) || null) !== (row.secondary_manager_id || null)
    ) {
      issues.push({
        code: 'TEAM_MANAGER_DRIFT',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Profile manager fields do not match active reporting-line rows.',
      });
    }

    if (cycleMembers.has(row.id)) {
      issues.push({
        code: 'MANAGER_CYCLE',
        profile_id: row.id,
        full_name: fullName,
        team_id: teamId,
        details: 'Detected a cycle in manager assignments.',
      });
    }
  });

  const filteredIssues = options?.teamId
    ? issues.filter((issue) => (issue.team_id || 'unassigned') === options.teamId)
    : issues;

  const blockingIssueCount = filteredIssues.filter((issue) => isBlockingHierarchyIssue(issue.code)).length;

  return {
    configured: true,
    issues: filteredIssues,
    team_issue_counts: buildTeamIssueCounts(issues),
    blocking_issue_count: blockingIssueCount,
    summary: {
      total_profiles: rows.length,
      issue_count: filteredIssues.length,
    },
  };
}
