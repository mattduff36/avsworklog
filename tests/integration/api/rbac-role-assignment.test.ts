import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/view-as');

describe('RBAC role assignment constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows manager to assign employee-class roles', async () => {
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { createAdminClient } = await import('@/lib/supabase/admin');

    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'manager-user',
      role_id: 'role-manager',
      role_name: 'manager',
      is_super_admin: false,
      is_manager_admin: true,
    } as never);

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { role_class: 'employee', is_super_admin: false },
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const allowed = await canEffectiveRoleAssignRole('role-employee-workshop');
    expect(allowed).toBe(true);
  });

  it('blocks manager from assigning manager-class roles', async () => {
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { createAdminClient } = await import('@/lib/supabase/admin');

    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'manager-user',
      role_id: 'role-manager',
      role_name: 'manager',
      is_super_admin: false,
      is_manager_admin: true,
    } as never);

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { role_class: 'manager', is_super_admin: false },
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const allowed = await canEffectiveRoleAssignRole('role-manager-custom');
    expect(allowed).toBe(false);
  });
});
