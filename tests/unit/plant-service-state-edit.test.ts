import { describe, expect, it } from 'vitest';
import {
  PROTECTED_PLANT_SERVICE_STATE_FIELDS,
  buildPlantServiceStateWrite,
} from '@/lib/utils/plant-service-state-edit';

describe('buildPlantServiceStateWrite', () => {
  it('omits protected maintenance fields and history when service state edits are denied', () => {
    const write = buildPlantServiceStateWrite({
      canEditServiceState: false,
      lastServiceHours: 1200,
      nextServiceHours: 0,
      previousLastServiceHours: 1000,
      previousNextServiceHours: 1500,
    });

    expect(write.maintenanceFields).toEqual({});
    expect(write.historyChanges).toEqual([]);
    for (const field of PROTECTED_PLANT_SERVICE_STATE_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(write.maintenanceFields, field)).toBe(false);
    }
  });

  it('keeps manager values including a legitimate zero and records real changes', () => {
    const write = buildPlantServiceStateWrite({
      canEditServiceState: true,
      lastServiceHours: 0,
      nextServiceHours: 2000,
      previousLastServiceHours: null,
      previousNextServiceHours: 1800,
    });

    expect(write.maintenanceFields).toEqual({
      last_service_hours: 0,
      next_service_hours: 2000,
    });
    expect(write.historyChanges).toEqual([
      {
        field_name: 'last_service_hours',
        old_value: null,
        new_value: '0',
        value_type: 'mileage',
      },
      {
        field_name: 'next_service_hours',
        old_value: '1800',
        new_value: '2000',
        value_type: 'mileage',
      },
    ]);
  });

  it('preserves an unchanged zero in the payload without writing false history', () => {
    const write = buildPlantServiceStateWrite({
      canEditServiceState: true,
      lastServiceHours: 0,
      nextServiceHours: 0,
      previousLastServiceHours: 0,
      previousNextServiceHours: 0,
    });

    expect(write.maintenanceFields.last_service_hours).toBe(0);
    expect(write.maintenanceFields.next_service_hours).toBe(0);
    expect(write.historyChanges).toEqual([]);
  });

  it('treats a cleared service-hour field as null rather than dropping the key', () => {
    const write = buildPlantServiceStateWrite({
      canEditServiceState: true,
      lastServiceHours: undefined,
      nextServiceHours: null,
      previousLastServiceHours: 40,
      previousNextServiceHours: null,
    });

    expect(write.maintenanceFields).toEqual({
      last_service_hours: null,
      next_service_hours: null,
    });
    expect(write.historyChanges).toEqual([
      {
        field_name: 'last_service_hours',
        old_value: '40',
        new_value: null,
        value_type: 'mileage',
      },
    ]);
  });
});
