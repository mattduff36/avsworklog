import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';

export interface InventoryAccessResult {
  allowed: boolean;
  status: 401 | 403 | 200;
  error?: string;
  userId?: string;
}

export async function requireInventoryAccess(): Promise<InventoryAccessResult> {
  const effectiveRole = await getEffectiveRole();

  if (!effectiveRole.user_id) {
    return { allowed: false, status: 401, error: 'Unauthorized' };
  }

  const hasPermission = await canEffectiveRoleAccessModule('inventory');
  if (!hasPermission) {
    return { allowed: false, status: 403, error: 'Forbidden' };
  }

  return {
    allowed: true,
    status: 200,
    userId: effectiveRole.user_id,
  };
}

export function normalizeInventoryItemNumber(itemNumber: string): string {
  return itemNumber.toUpperCase().replace(/\s+/g, '').trim();
}
