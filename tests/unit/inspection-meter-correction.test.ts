import { describe, expect, it } from 'vitest';
import { canCorrectInspectionMeter, formatInspectionMeter, InspectionMeterCorrectionSchema } from '@/lib/inspections/meter-correction';

describe('Daily Check reading correction rules', () => {
  it.each(['manager', 'admin'])('allows the %s role', role_class => {
    expect(canCorrectInspectionMeter({ role_class })).toBe(true);
  });
  it('allows superadmins but respects View As', () => {
    expect(canCorrectInspectionMeter({ is_actual_super_admin: true })).toBe(true);
    expect(canCorrectInspectionMeter({ role_class: 'employee', is_actual_super_admin: true, is_viewing_as: true })).toBe(false);
    expect(canCorrectInspectionMeter({ is_super_admin: true, is_viewing_as: true })).toBe(true);
  });
  it('denies supervisors, employees and missing roles', () => {
    expect(canCorrectInspectionMeter({ role_class: 'employee', role_name: 'Supervisor' })).toBe(false);
    expect(canCorrectInspectionMeter({ role_class: 'employee' })).toBe(false);
    expect(canCorrectInspectionMeter(null)).toBe(false);
  });
  it('distinguishes zero and missing readings and displays the right units', () => {
    expect(formatInspectionMeter(0, 'van')).toBe('0 miles');
    expect(formatInspectionMeter(12500, 'hgv')).toBe('12,500 km');
    expect(formatInspectionMeter(120, 'plant')).toBe('120 hours');
    expect(formatInspectionMeter(null, 'plant')).toBe('Not recorded');
  });
  const body = { assetType: 'van', inspectionId: '11111111-1111-4111-8111-111111111111', reading: 0, expectedReading: null, expectedVersion: '2026-11-02 12:00:00+00' };
  it('accepts a missing or blank optional comment', () => {
    expect(InspectionMeterCorrectionSchema.safeParse(body).success).toBe(true);
    expect(InspectionMeterCorrectionSchema.parse({ ...body, comment: '  ' }).comment).toBe('');
  });
  it.each([-1, 1.5, 2147483648, NaN, Infinity, '42', null])('rejects invalid reading %s', reading => {
    expect(InspectionMeterCorrectionSchema.safeParse({ ...body, reading }).success).toBe(false);
  });
  it('rejects unexpected fields, IDs and oversized comments', () => {
    expect(InspectionMeterCorrectionSchema.safeParse({ ...body, status: 'draft' }).success).toBe(false);
    expect(InspectionMeterCorrectionSchema.safeParse({ ...body, inspectionId: 'invalid' }).success).toBe(false);
    expect(InspectionMeterCorrectionSchema.safeParse({ ...body, comment: 'x'.repeat(2001) }).success).toBe(false);
  });
});
