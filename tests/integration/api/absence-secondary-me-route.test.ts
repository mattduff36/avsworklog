import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/server/absence-secondary-permissions');

import { GET as getSecondaryMe } from '@/app/api/absence/permissions/secondary/me/route';
import {
  createEmptyAbsenceSecondaryPermissionMap,
  createNullAbsenceSecondaryOverrideRecord,
} from '@/types/absence-permissions';

describe('absence secondary me route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies View As role/team context to secondary snapshot', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { getActorAbsenceSecondaryPermissions } = await import('@/lib/server/absence-secondary-permissions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'role-supervisor',
      role_name: 'supervisor',
      display_name: 'Supervisor',
      role_class: 'employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_viewing_as: true,
      is_actual_super_admin: true,
      user_id: 'user-1',
      team_id: 'team-b',
      team_name: 'Team B',
    });

    const defaults = createEmptyAbsenceSecondaryPermissionMap();
    const permissions = {
      ...defaults,
      see_bookings_team: true,
      add_edit_bookings_team: true,
      see_manage_work_shifts_team: true,
      edit_manage_work_shifts_team: false,
    };

    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: 'user-1',
      team_id: 'team-b',
      team_name: 'Team B',
      role_name: 'supervisor',
      role_display_name: 'Supervisor',
      role_tier: 'supervisor',
      defaults,
      overrides: createNullAbsenceSecondaryOverrideRecord(),
      effective: permissions,
      has_exception_row: false,
    } as never);

    const response = await getSecondaryMe();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getActorAbsenceSecondaryPermissions).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        role: expect.objectContaining({
          name: 'supervisor',
          display_name: 'Supervisor',
        }),
        team_id: 'team-b',
        team_name: 'Team B',
      })
    );
    expect(payload.team_id).toBe('team-b');
    expect(payload.role_name).toBe('supervisor');
  });
});

