export type LegacyRoleTeamSnapshot = {
  team_id?: string | null;
  role_name?: string | null;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  is_super_admin?: boolean | null;
  is_manager_admin?: boolean | null;
};

export type CanonicalTeamDefinition = {
  id: string;
  name: string;
};

export const CANONICAL_TEAMS: CanonicalTeamDefinition[] = [
  { id: 'civils', name: 'Civils' },
  { id: 'plant', name: 'Plant' },
  { id: 'transport', name: 'Transport' },
  { id: 'workshop', name: 'Workshop' },
  { id: 'accounts', name: 'Accounts' },
  { id: 'sheq', name: 'SHEQ' },
];

export const TEAM_ID_MAP: Record<string, string> = {
  civils: 'civils',
  civils_ops: 'civils',
  civils_projects: 'civils',
  heavy_plant_earthworks: 'plant',
  plant: 'plant',
  transport: 'transport',
  workshop: 'workshop',
  workshop_yard: 'workshop',
  finance_payroll: 'accounts',
  accounts: 'accounts',
  sheq: 'sheq',
  executive: 'civils',
};

function normalizeToken(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function inferTargetTeamFromLegacy(snapshot: LegacyRoleTeamSnapshot): {
  teamId: string;
  reason: string;
} {
  const currentTeam = normalizeToken(snapshot.team_id);
  if (currentTeam && TEAM_ID_MAP[currentTeam]) {
    return { teamId: TEAM_ID_MAP[currentTeam], reason: `team:${currentTeam}` };
  }

  const roleName = normalizeToken(snapshot.role_name);
  if (roleName) {
    if (roleName.includes('sheq')) return { teamId: 'sheq', reason: `role:${roleName}` };
    if (roleName.includes('finance') || roleName.includes('payroll') || roleName.includes('accounts')) {
      return { teamId: 'accounts', reason: `role:${roleName}` };
    }
    if (roleName.includes('plant')) return { teamId: 'plant', reason: `role:${roleName}` };
    if (roleName.includes('transport')) return { teamId: 'transport', reason: `role:${roleName}` };
    if (roleName.includes('workshop')) return { teamId: 'workshop', reason: `role:${roleName}` };
    if (roleName.includes('civils') || roleName.includes('groundworks')) {
      return { teamId: 'civils', reason: `role:${roleName}` };
    }
  }

  return { teamId: 'civils', reason: 'fallback:civils' };
}

export function inferTargetRoleNameFromLegacy(
  snapshot: LegacyRoleTeamSnapshot
): 'employee' | 'contractor' | 'manager' | 'admin' {
  const roleName = (snapshot.role_name || '').trim().toLowerCase();
  if (snapshot.is_super_admin || roleName === 'admin' || snapshot.role_class === 'admin') {
    return 'admin';
  }
  if (snapshot.role_class === 'manager' || snapshot.is_manager_admin) {
    return 'manager';
  }
  if (roleName === 'contractor') {
    return 'contractor';
  }
  return 'employee';
}
