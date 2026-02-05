/**
 * Maintenance History helpers
 *
 * Centralizes small rules that must align with DB constraints:
 * - `maintenance_history.field_name` is VARCHAR(100)
 * - `maintenance_history.value_type` is constrained to a fixed set
 */

export const MAINTENANCE_HISTORY_FIELD_NAME_MAX = 100 as const;

export type MaintenanceHistoryValueType = 'date' | 'mileage' | 'boolean' | 'text';

/**
 * Ensure we never violate the VARCHAR(100) constraint.
 */
export function safeMaintenanceHistoryFieldName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length <= MAINTENANCE_HISTORY_FIELD_NAME_MAX) return trimmed;
  return trimmed.slice(0, MAINTENANCE_HISTORY_FIELD_NAME_MAX);
}

/**
 * Best-effort coercion for legacy call sites.
 * Prefer using the `MaintenanceHistoryValueType` union directly in new code.
 */
export function coerceMaintenanceHistoryValueType(valueType: string): MaintenanceHistoryValueType {
  switch ((valueType || '').toLowerCase()) {
    case 'date':
      return 'date';
    case 'mileage':
    case 'number':
    case 'hours':
      // Numeric changes are treated as 'mileage' in the existing schema constraint.
      return 'mileage';
    case 'boolean':
      return 'boolean';
    case 'text':
    default:
      return 'text';
  }
}

