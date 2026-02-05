import { describe, it, expect } from 'vitest';
import {
  MAINTENANCE_HISTORY_FIELD_NAME_MAX,
  safeMaintenanceHistoryFieldName,
  coerceMaintenanceHistoryValueType,
} from '@/lib/utils/maintenance-history';

describe('maintenance-history utils', () => {
  describe('safeMaintenanceHistoryFieldName', () => {
    it('returns trimmed value when within limit', () => {
      expect(safeMaintenanceHistoryFieldName('  current_hours  ')).toBe('current_hours');
    });

    it('truncates values beyond VARCHAR(100) limit', () => {
      const long = 'x'.repeat(MAINTENANCE_HISTORY_FIELD_NAME_MAX + 50);
      const safe = safeMaintenanceHistoryFieldName(long);
      expect(safe.length).toBe(MAINTENANCE_HISTORY_FIELD_NAME_MAX);
      expect(safe).toBe('x'.repeat(MAINTENANCE_HISTORY_FIELD_NAME_MAX));
    });
  });

  describe('coerceMaintenanceHistoryValueType', () => {
    it('passes through supported types', () => {
      expect(coerceMaintenanceHistoryValueType('date')).toBe('date');
      expect(coerceMaintenanceHistoryValueType('mileage')).toBe('mileage');
      expect(coerceMaintenanceHistoryValueType('boolean')).toBe('boolean');
      expect(coerceMaintenanceHistoryValueType('text')).toBe('text');
    });

    it('coerces legacy numeric types to mileage', () => {
      expect(coerceMaintenanceHistoryValueType('number')).toBe('mileage');
      expect(coerceMaintenanceHistoryValueType('hours')).toBe('mileage');
    });

    it('defaults unknown types to text', () => {
      expect(coerceMaintenanceHistoryValueType('weird')).toBe('text');
      expect(coerceMaintenanceHistoryValueType('')).toBe('text');
    });
  });
});

