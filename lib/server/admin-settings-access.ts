import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';

interface AdminSettingsAccessAllowed {
  userId: string;
  response: null;
}

interface AdminSettingsAccessDenied {
  userId: null;
  response: NextResponse;
}

export type AdminSettingsAccess = AdminSettingsAccessAllowed | AdminSettingsAccessDenied;

export async function requireAdminSettingsAccess(): Promise<AdminSettingsAccess> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      userId: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const canAccessSettings = await canEffectiveRoleUseModuleLevel('admin-settings', 5);
  if (!canAccessSettings) {
    return {
      userId: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  const sensitiveAccessResponse = await requireSensitiveModuleAccess('admin-settings');
  if (sensitiveAccessResponse) {
    return { userId: null, response: sensitiveAccessResponse };
  }

  return { userId: user.id, response: null };
}
