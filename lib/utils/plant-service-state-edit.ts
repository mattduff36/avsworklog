import type { MaintenanceHistoryValueType } from '@/lib/utils/maintenance-history';

export const PROTECTED_PLANT_SERVICE_STATE_FIELDS = [
  'last_service_hours',
  'next_service_hours',
] as const;

export type ProtectedPlantServiceStateField =
  (typeof PROTECTED_PLANT_SERVICE_STATE_FIELDS)[number];

export interface PlantServiceStateHistoryChange {
  field_name: ProtectedPlantServiceStateField;
  old_value: string | null;
  new_value: string | null;
  value_type: MaintenanceHistoryValueType;
}

export interface PlantServiceStateWrite {
  maintenanceFields: Partial<Record<ProtectedPlantServiceStateField, number | null>>;
  historyChanges: PlantServiceStateHistoryChange[];
}

function serviceHoursHistoryValue(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

function appendServiceHoursChange(
  historyChanges: PlantServiceStateHistoryChange[],
  fieldName: ProtectedPlantServiceStateField,
  previous: number | null | undefined,
  next: number | null
) {
  const oldValue = serviceHoursHistoryValue(previous);
  const newValue = serviceHoursHistoryValue(next);
  if (oldValue === newValue) return;
  historyChanges.push({
    field_name: fieldName,
    old_value: oldValue,
    new_value: newValue,
    value_type: 'mileage',
  });
}

/**
 * Managers may write last/next service hours, including a legitimate zero.
 * Everyone else must omit those keys from maintenance writes and history.
 */
export function buildPlantServiceStateWrite(input: {
  canEditServiceState: boolean;
  lastServiceHours: number | null | undefined;
  nextServiceHours: number | null | undefined;
  previousLastServiceHours?: number | null;
  previousNextServiceHours?: number | null;
}): PlantServiceStateWrite {
  if (!input.canEditServiceState) {
    return { maintenanceFields: {}, historyChanges: [] };
  }

  const lastServiceHours = input.lastServiceHours ?? null;
  const nextServiceHours = input.nextServiceHours ?? null;
  const historyChanges: PlantServiceStateHistoryChange[] = [];

  appendServiceHoursChange(
    historyChanges,
    'last_service_hours',
    input.previousLastServiceHours,
    lastServiceHours
  );
  appendServiceHoursChange(
    historyChanges,
    'next_service_hours',
    input.previousNextServiceHours,
    nextServiceHours
  );

  return {
    maintenanceFields: {
      last_service_hours: lastServiceHours,
      next_service_hours: nextServiceHours,
    },
    historyChanges,
  };
}
