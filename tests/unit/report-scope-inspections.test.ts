import { describe, expect, it } from 'vitest';
import { getScopedProfileIdsForModule, type ReportScopeContext } from '@/lib/server/report-scope';

function buildContext(teamName: string | null): ReportScopeContext {
  return {
    effectiveRole: {
      role_id: 'role-1',
      role_name: 'employee',
      display_name: 'Employee',
      role_class: 'employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: null,
      team_id: 'team-1',
      team_name: teamName,
    },
    isAdminTier: false,
    isManagerLike: false,
    shouldScopeToTeam: false,
  };
}

describe('getScopedProfileIdsForModule inspection workshop override', () => {
  it('returns unscoped access for workshop inspection modules', async () => {
    const context = buildContext('Workshop');

    await expect(getScopedProfileIdsForModule('inspections', context)).resolves.toBeNull();
    await expect(getScopedProfileIdsForModule('plant-inspections', context)).resolves.toBeNull();
    await expect(getScopedProfileIdsForModule('hgv-inspections', context)).resolves.toBeNull();
  });

  it('does not apply workshop override to non-inspection modules', async () => {
    const context = buildContext('Workshop');
    const result = await getScopedProfileIdsForModule('timesheets', context);
    expect(result).toEqual(new Set());
  });
});
