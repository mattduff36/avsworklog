import type { createAdminClient } from '@/lib/supabase/admin';
import type {
  InventoryHardwareAdjustmentOperation,
  InventoryHardwareAdjustmentReason,
} from '@/app/(dashboard)/inventory/types';

export const HARDWARE_ADJUSTMENT_REASONS: InventoryHardwareAdjustmentReason[] = [
  'Delivery',
  'Return',
  'Used',
  'Lost',
  'Scrapped',
  'Damaged',
  'Stocktake correction',
  'Other',
];
const SECONDARY_HARDWARE_LOCATION_TYPES = new Set(['site', 'manual']);

export function isHardwareAdjustmentOperation(
  value: unknown,
): value is InventoryHardwareAdjustmentOperation {
  return value === 'add' || value === 'remove' || value === 'recount';
}

export function isHardwareAdjustmentReason(
  value: unknown,
): value is InventoryHardwareAdjustmentReason {
  return typeof value === 'string'
    && HARDWARE_ADJUSTMENT_REASONS.includes(value as InventoryHardwareAdjustmentReason);
}

export function isValidHardwareQuantity(value: unknown, allowZero = false): value is number {
  return Number.isInteger(value) && (allowZero ? Number(value) >= 0 : Number(value) > 0);
}

export async function getResponsibleHardwareLocationIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string[]> {
  const [{ data: primary, error: primaryError }, { data: secondary, error: secondaryError }] = await Promise.all([
    admin
      .from('inventory_user_locations')
      .select('location_id, location:inventory_locations!inner(id, is_active, location_type)')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('inventory_user_site_locations')
      .select('location_id, location:inventory_locations!inner(id, is_active, location_type)')
      .eq('user_id', userId),
  ]);

  if (primaryError) throw primaryError;
  if (secondaryError) throw secondaryError;

  const primaryLocation = Array.isArray(primary?.location) ? primary.location[0] : primary?.location;
  if (
    !primary?.location_id
    || primaryLocation?.is_active !== true
    || primaryLocation?.location_type === 'site'
  ) {
    return [];
  }

  const locationIds = new Set<string>([primary.location_id]);
  for (const row of secondary || []) {
    const location = Array.isArray(row.location) ? row.location[0] : row.location;
    if (
      location?.is_active === true
      && SECONDARY_HARDWARE_LOCATION_TYPES.has(location.location_type)
    ) {
      locationIds.add(row.location_id);
    }
  }

  return [...locationIds];
}

export function getHardwareDatabaseErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : '';

  const knownMessages = [
    'Hardware quantity cannot be negative',
    'Insufficient Hardware stock at source location',
    'Active Hardware item not found',
    'Active Inventory location not found',
    'Both Hardware transfer locations must be active',
    'Hardware transfer locations must be different',
    'Duplicate Hardware',
  ];
  return knownMessages.find((knownMessage) => message.includes(knownMessage))
    || 'Unable to update Hardware stock';
}
