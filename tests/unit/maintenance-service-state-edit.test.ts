import { describe, expect, it } from 'vitest';
import {
  filterMaintenanceServiceState,
  prepareMaintenanceServiceStateEdit,
  serviceStateSnapshot,
  matchesServiceStateSnapshot,
  hasMaintenanceServiceStateChange,
  PROTECTED_MAINTENANCE_SERVICE_FIELDS,
} from '@/lib/utils/maintenance-service-state-edit';

describe('maintenance service state permissions', () => {
  it('omits protected fields for non-managers without losing ordinary changes', () => {
    const input = { next_service_mileage: 10000, last_service_mileage: 0,
      next_service_hours: null, last_service_hours: 0, next_service_template_id: 'full',
      current_mileage: 1234, comment: 'Routine update' };
    const filtered = filterMaintenanceServiceState(input, false);
    for (const key of PROTECTED_MAINTENANCE_SERVICE_FIELDS) expect(filtered).not.toHaveProperty(key);
    expect(filtered).toEqual({ current_mileage: 1234, comment: 'Routine update' });
    expect(input.last_service_mileage).toBe(0);
  });
  it('preserves manager values including zero and explicit clearing', () => {
    const input = { last_service_mileage: 0, next_service_mileage: null, next_service_template_id: null };
    expect(filterMaintenanceServiceState(input, true)).toEqual(input);
  });
  it('accepts omitted or unchanged protected fields including null defaults', () => {
    expect(hasMaintenanceServiceStateChange({}, { next_service_mileage: 10000 })).toBe(false);
    expect(hasMaintenanceServiceStateChange({ last_service_mileage: 0 }, { last_service_mileage: 0 })).toBe(false);
    expect(hasMaintenanceServiceStateChange({ next_service_template_id: null }, {})).toBe(false);
  });
  it('detects protected changes, especially zero versus null and type changes', () => {
    expect(hasMaintenanceServiceStateChange({ last_service_mileage: null }, { last_service_mileage: 0 })).toBe(true);
    expect(hasMaintenanceServiceStateChange({ next_service_template_id: 'basic' }, { next_service_template_id: 'full' })).toBe(true);
    expect(hasMaintenanceServiceStateChange({ next_service_hours: 250 }, { next_service_hours: null })).toBe(true);
  });
});

describe('snapshot-aware service edit payload', () => {
  const original = { next_service_mileage: 10000, last_service_mileage: 0, next_service_template_id: 'basic', next_service_rotation_step_id: 'step-a' };
  it('omits unchanged manager fields so a form opened before completion cannot rewind rotation', () => {
    expect(prepareMaintenanceServiceStateEdit({ next_service_mileage: 10000, last_service_mileage: 0, next_service_template_id: 'basic', comment: 'Unrelated edit' }, true, original)).toEqual({ comment: 'Unrelated edit' });
  });
  it('sends changed fields and a complete original snapshot for intentional edits', () => {
    const payload = prepareMaintenanceServiceStateEdit({ next_service_mileage: 0, last_service_mileage: 0 }, true, original);
    expect(payload.next_service_mileage).toBe(0);
    expect(payload).not.toHaveProperty('last_service_mileage');
    expect(payload.expected_service_state).toEqual({ ...original, next_service_hours: null, last_service_hours: null });
    expect(matchesServiceStateSnapshot(payload.expected_service_state, serviceStateSnapshot(original))).toBe(true);
    expect(matchesServiceStateSnapshot(original, serviceStateSnapshot(original))).toBe(false);
  });
});
