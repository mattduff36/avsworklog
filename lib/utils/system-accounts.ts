export const SYSTEM_ACCOUNTS_TEAM_ID = 'system_accounts';
export const SYSTEM_TEAM_DISPLAY_NAME = 'System';

export interface SystemAccountCandidate {
  id?: string | null;
  is_system_account?: boolean | null;
  team_id?: string | null;
}

export interface SystemTeamCandidate {
  id?: string | null;
  is_system?: boolean | null;
}

export function isSystemAccountProfile(candidate: SystemAccountCandidate): boolean {
  return candidate.is_system_account === true;
}

export function isSystemTeam(candidate: SystemTeamCandidate): boolean {
  return candidate.is_system === true || candidate.id === SYSTEM_ACCOUNTS_TEAM_ID;
}

export function getDisplayedTeamName(
  team: SystemTeamCandidate & { name?: string | null }
): string {
  if (isSystemTeam(team)) return SYSTEM_TEAM_DISPLAY_NAME;
  return team.name?.trim() || '';
}

export function filterSystemAccounts<T extends SystemAccountCandidate>(rows: T[]): T[] {
  return rows.filter((row) => !isSystemAccountProfile(row));
}

export function filterSystemTeams<T extends SystemTeamCandidate>(rows: T[]): T[] {
  return rows.filter((row) => !isSystemTeam(row));
}

export function filterSystemAccountIds<T extends { id?: string | null }>(
  rows: T[],
  systemAccountIds: ReadonlySet<string>
): T[] {
  if (systemAccountIds.size === 0) return rows;
  return rows.filter((row) => !row.id || !systemAccountIds.has(row.id));
}
