import { NextResponse } from 'next/server';
import type { ModuleName } from '@/types/roles';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getSensitiveModulePinState } from '@/lib/server/sensitive-pin';

export async function requireSensitiveModuleAccess(moduleName: ModuleName): Promise<NextResponse | null> {
  const canAccessModule = await canEffectiveRoleAccessModule(moduleName);
  if (!canAccessModule) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const state = await getSensitiveModulePinState(moduleName);
  if (!state.required || state.unlocked) {
    return null;
  }

  const code = !state.pin_status.configured || state.pin_status.must_reset
    ? 'SENSITIVE_PIN_SETUP_REQUIRED'
    : 'SENSITIVE_PIN_REQUIRED';

  return NextResponse.json(
    {
      error: code === 'SENSITIVE_PIN_SETUP_REQUIRED'
        ? 'Set up your sensitive access PIN from your profile before opening this module.'
        : 'Sensitive access PIN required.',
      code,
      sensitive_access: state,
    },
    { status: 428 }
  );
}
