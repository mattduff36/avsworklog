import type { InventoryCheckStatus } from '@/app/(dashboard)/inventory/types';

export const INVENTORY_CHECK_WARNING_REQUIRED = 'INVENTORY_CHECK_WARNING_REQUIRED' as const;

export interface InventoryMoveCheckWarningItem {
  id: string;
  item_number: string;
  name: string;
  check_status: InventoryCheckStatus;
}

export interface InventoryMoveCheckConfirmation {
  warning_item_ids: string[];
  move_item_ids: string[];
}

export interface InventoryMoveCheckWarningPayload {
  code: typeof INVENTORY_CHECK_WARNING_REQUIRED;
  error: string;
  warning_items: InventoryMoveCheckWarningItem[];
  move_item_ids: string[];
}

interface ApiResponseError extends Error {
  payload?: unknown;
}

export function getInventoryMoveCheckWarningPayload(
  error: unknown,
): InventoryMoveCheckWarningPayload | null {
  const payload = (error as ApiResponseError | undefined)?.payload;
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<InventoryMoveCheckWarningPayload>;
  if (
    candidate.code !== INVENTORY_CHECK_WARNING_REQUIRED
    || !Array.isArray(candidate.warning_items)
    || !Array.isArray(candidate.move_item_ids)
  ) return null;
  return candidate as InventoryMoveCheckWarningPayload;
}
