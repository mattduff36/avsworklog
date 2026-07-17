import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import type { CurrentAuthenticatedProfile } from '@/lib/server/sensitive-pin';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import { getEffectiveRole } from '@/lib/utils/view-as';

export interface DebugConsoleAccessResult {
  ok: boolean;
  status: number;
  error: string | null;
  profileId?: string;
  code?: 'SENSITIVE_PIN_REQUIRED' | 'SENSITIVE_PIN_SETUP_REQUIRED';
  sensitive_access?: unknown;
  currentContext?: CurrentAuthenticatedProfile;
}

export async function canCurrentUserAccessDebugConsole(): Promise<DebugConsoleAccessResult> {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    };
  }

  const effectiveRole = await getEffectiveRole();
  if (!canAccessDebugConsole({
    email: current.profile.email,
    isActualSuperAdmin: effectiveRole.is_actual_super_admin,
    isViewingAs: effectiveRole.is_viewing_as,
  })) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
    };
  }

  return {
    ok: true,
    status: 200,
    error: null,
    profileId: current.profile.id,
    currentContext: current,
  };
}

export async function requireDebugConsoleAccess(): Promise<DebugConsoleAccessResult> {
  // Debug console is restricted to eligible users (super admin / Charlotte allow-list).
  // It no longer requires a sensitive-module PIN unlock.
  return canCurrentUserAccessDebugConsole();
}

export function createDebugAccessErrorBody(access: {
  error: string | null;
  code?: string;
  sensitive_access?: unknown;
}) {
  return {
    error: access.error,
    code: access.code,
    sensitive_access: access.sensitive_access,
  };
}
