/**
 * Server-side "View As" helpers for API route handlers.
 *
 * Usage in a route handler:
 *
 *   const effectiveRole = await getEffectiveRole();
 *   if (!effectiveRole.is_manager_admin) {
 *     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 *   }
 */

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { VIEW_AS_COOKIE_NAME } from '@/lib/utils/view-as-cookie';

export interface EffectiveRoleInfo {
  /** The effective role id (may differ from actual if viewing-as) */
  role_id: string | null;
  role_name: string | null;
  display_name: string | null;
  is_manager_admin: boolean;
  is_super_admin: boolean;
  /** True when the caller is a real super admin and is actively viewing as another role */
  is_viewing_as: boolean;
  /** Always reflects the real user's super admin status */
  is_actual_super_admin: boolean;
  /** The authenticated user's id */
  user_id: string | null;
}

/**
 * Determine the effective role for the current request.
 *
 * 1. Authenticate the caller via the standard Supabase session.
 * 2. Fetch the caller's *actual* profile and role.
 * 3. If the caller is an actual super admin AND the `avs_view_as_role_id` cookie
 *    is set, fetch the override role and return it as the effective role.
 * 4. Otherwise, return the caller's actual role.
 */
export async function getEffectiveRole(): Promise<EffectiveRoleInfo> {
  const none: EffectiveRoleInfo = {
    role_id: null,
    role_name: null,
    display_name: null,
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    user_id: null,
  };

  try {
    // Authenticate via session
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return none;

    // Fetch actual profile + role using admin client to bypass RLS
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select(`
        id,
        is_super_admin,
        role_id,
        role:roles(
          id,
          name,
          display_name,
          is_manager_admin,
          is_super_admin
        )
      `)
      .eq('id', user.id)
      .single();

    if (profileError || !profile) return none;

    const actualRole = profile.role as {
      id: string;
      name: string;
      display_name: string;
      is_manager_admin: boolean;
      is_super_admin: boolean;
    } | null;

    const isActualSuperAdmin =
      profile.is_super_admin === true || actualRole?.is_super_admin === true;

    // Build baseline result from actual role
    const result: EffectiveRoleInfo = {
      role_id: actualRole?.id ?? null,
      role_name: actualRole?.name ?? null,
      display_name: actualRole?.display_name ?? null,
      is_manager_admin: actualRole?.is_manager_admin ?? false,
      is_super_admin: actualRole?.is_super_admin ?? false,
      is_viewing_as: false,
      is_actual_super_admin: isActualSuperAdmin,
      user_id: user.id,
    };

    // Only super admins may override
    if (!isActualSuperAdmin) return result;

    const cookieStore = await cookies();
    const viewAsRoleId = cookieStore.get(VIEW_AS_COOKIE_NAME)?.value;

    if (!viewAsRoleId) return result;

    // Fetch the override role
    const { data: overrideRole, error: overrideError } = await admin
      .from('roles')
      .select('id, name, display_name, is_manager_admin, is_super_admin')
      .eq('id', viewAsRoleId)
      .single();

    if (overrideError || !overrideRole) return result;

    return {
      role_id: overrideRole.id,
      role_name: overrideRole.name,
      display_name: overrideRole.display_name,
      is_manager_admin: overrideRole.is_manager_admin,
      is_super_admin: overrideRole.is_super_admin,
      is_viewing_as: true,
      is_actual_super_admin: true,
      user_id: user.id,
    };
  } catch (error) {
    console.error('[getEffectiveRole] Error:', error);
    return none;
  }
}
