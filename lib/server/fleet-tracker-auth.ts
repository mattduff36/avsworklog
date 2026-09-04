import {
  validateAppSession,
  type AppSessionValidationResult,
} from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

export type SingleAssetTrackerAccess =
  | { ok: true; validation: AppSessionValidationResult }
  | { ok: false; status: 401 | 403; validation: AppSessionValidationResult };

export async function requireSingleAssetTrackerAccess(): Promise<SingleAssetTrackerAccess> {
  const validation = await validateAppSession({ includeEmail: true });
  if (validation.status !== 'active' || !validation.profileId) {
    return { ok: false, status: 401, validation };
  }

  const actor = {
    userId: validation.profileId,
    email: validation.email,
  };
  const [workshop, fleet, maintenance] = await Promise.all([
    canEffectiveRoleAccessModule('workshop-tasks', actor),
    canEffectiveRoleAccessModule('admin-vans', actor),
    canEffectiveRoleAccessModule('maintenance', actor),
  ]);

  if (!workshop && !fleet && !maintenance) {
    return { ok: false, status: 403, validation };
  }

  return { ok: true, validation };
}
