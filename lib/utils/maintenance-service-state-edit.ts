import type { MaintenanceServiceStateSnapshot, UpdateMaintenanceRequest } from '@/types/maintenance';

export const PROTECTED_MAINTENANCE_SERVICE_FIELDS = [
  'next_service_mileage',
  'last_service_mileage',
  'next_service_hours',
  'last_service_hours',
  'next_service_template_id',
] as const;

export type MaintenanceServiceState = Pick<UpdateMaintenanceRequest,
  (typeof PROTECTED_MAINTENANCE_SERVICE_FIELDS)[number]>;

/** Match the database trigger: omitted and unchanged values are not changes. */
export function hasMaintenanceServiceStateChange(
  requested: MaintenanceServiceState,
  current: MaintenanceServiceState,
): boolean {
  return PROTECTED_MAINTENANCE_SERVICE_FIELDS.some((key) =>
    requested[key] !== undefined && requested[key] !== (current[key] ?? null),
  );
}

/** Omit protected fields entirely for non-managers, including stale form values. */
export function filterMaintenanceServiceState<T extends MaintenanceServiceState>(
  requested: T,
  canEditServiceState: boolean,
): T {
  const result = { ...requested };
  if (!canEditServiceState) {
    for (const key of PROTECTED_MAINTENANCE_SERVICE_FIELDS) delete result[key];
  }
  return result;
}

export const SERVICE_STATE_SNAPSHOT_FIELDS = [
  ...PROTECTED_MAINTENANCE_SERVICE_FIELDS, 'next_service_rotation_step_id',
] as const;

export function serviceStateSnapshot(current: MaintenanceServiceState & { next_service_rotation_step_id?: string | null }): MaintenanceServiceStateSnapshot {
  return Object.fromEntries(SERVICE_STATE_SNAPSHOT_FIELDS.map(key => [key, current[key] ?? null])) as unknown as MaintenanceServiceStateSnapshot;
}

export function matchesServiceStateSnapshot(expected: unknown, current: MaintenanceServiceStateSnapshot): boolean {
  return expected !== null && typeof expected === 'object' && SERVICE_STATE_SNAPSHOT_FIELDS.every(key =>
    Object.prototype.hasOwnProperty.call(expected, key) && (expected as MaintenanceServiceStateSnapshot)[key] === current[key]);
}

export function omitUnchangedServiceState<T extends MaintenanceServiceState>(requested: T, original: MaintenanceServiceState): T {
  const result = { ...requested };
  for (const key of PROTECTED_MAINTENANCE_SERVICE_FIELDS) {
    if (result[key] === (original[key] ?? null)) delete result[key];
  }
  return result;
}

export function prepareMaintenanceServiceStateEdit<T extends MaintenanceServiceState>(
  requested: T, canEdit: boolean, original: MaintenanceServiceState & { next_service_rotation_step_id?: string | null },
): T & { expected_service_state?: MaintenanceServiceStateSnapshot } {
  const result = omitUnchangedServiceState(filterMaintenanceServiceState(requested, canEdit), original);
  return hasMaintenanceServiceStateChange(result, original)
    ? { ...result, expected_service_state: serviceStateSnapshot(original) }
    : result;
}
