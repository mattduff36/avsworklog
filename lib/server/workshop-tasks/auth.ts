import {
  validateAppSession,
  type AppSessionValidationResult,
} from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

export type WorkshopTasksAccess =
  | { ok: true; userId: string; validation: AppSessionValidationResult }
  | { ok: false; status: 401 | 403; validation: AppSessionValidationResult };

export async function requireWorkshopTasksAccess(): Promise<WorkshopTasksAccess> {
  const validation = await validateAppSession({ includeEmail: true });
  if (validation.status !== 'active' || !validation.profileId) {
    return { ok: false, status: 401, validation };
  }

  const canAccess = await canEffectiveRoleAccessModule('workshop-tasks', {
    userId: validation.profileId,
    email: validation.email,
  });
  if (!canAccess) {
    return { ok: false, status: 403, validation };
  }

  return { ok: true, userId: validation.profileId, validation };
}
