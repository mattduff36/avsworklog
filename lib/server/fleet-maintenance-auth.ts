import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import type { PermissionAccessLevel } from '@/types/roles';
import type { User } from '@supabase/supabase-js';

type AuthResult =
  | { user: User; response: null }
  | { user: null; response: NextResponse };

async function requireAuthenticatedUser(): Promise<AuthResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { user, response: null };
}

export async function requireMaintenanceLevel(
  minimumLevel: PermissionAccessLevel,
  message = 'Forbidden: Insufficient maintenance access'
): Promise<AuthResult> {
  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    return auth;
  }

  const allowed = await canEffectiveRoleUseModuleLevel('maintenance', minimumLevel);
  if (!allowed) {
    return {
      user: null,
      response: NextResponse.json({ error: message }, { status: 403 }),
    };
  }

  return auth;
}

export async function requireFleetLevel(
  minimumLevel: PermissionAccessLevel,
  message = 'Forbidden: Insufficient fleet access'
): Promise<AuthResult> {
  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    return auth;
  }

  const allowed = await canEffectiveRoleUseModuleLevel('admin-vans', minimumLevel);
  if (!allowed) {
    return {
      user: null,
      response: NextResponse.json({ error: message }, { status: 403 }),
    };
  }

  return auth;
}

/** Manual DVLA sync requires maintenance>=4 AND admin-vans>=4. Cron route stays CRON_SECRET-only. */
export async function requireManualDvlaSyncAccess(): Promise<AuthResult> {
  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    return auth;
  }

  const [canMaintenance, canFleet] = await Promise.all([
    canEffectiveRoleUseModuleLevel('maintenance', 4),
    canEffectiveRoleUseModuleLevel('admin-vans', 4),
  ]);

  if (!canMaintenance || !canFleet) {
    return {
      user: null,
      response: NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Maintenance Level 4 and Fleet Level 4 required for manual DVLA sync',
        },
        { status: 403 }
      ),
    };
  }

  return auth;
}
