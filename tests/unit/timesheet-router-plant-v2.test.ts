import { describe, expect, it } from 'vitest';
import { resolveTimesheetRenderVariant } from '@/app/(dashboard)/timesheets/components/timesheet-routing';

describe('resolveTimesheetRenderVariant', () => {
  it('routes new plant timesheets to v2 template', () => {
    const result = resolveTimesheetRenderVariant({
      existingId: null,
      resolvedType: 'plant',
    });

    expect(result.variant).toBe('plant-v2');
    expect(result.templateVersion).toBe(2);
  });

  it('keeps existing legacy plant timesheets on legacy renderer', () => {
    const result = resolveTimesheetRenderVariant({
      existingId: 'legacy-id',
      existingTimesheetType: 'plant',
      existingTemplateVersion: 1,
      resolvedType: 'plant',
    });

    expect(result.variant).toBe('plant-legacy');
    expect(result.templateVersion).toBe(1);
  });

  it('routes existing plant v2 records to v2 renderer', () => {
    const result = resolveTimesheetRenderVariant({
      existingId: 'v2-id',
      existingTimesheetType: 'plant',
      existingTemplateVersion: 2,
      resolvedType: 'plant',
    });

    expect(result.variant).toBe('plant-v2');
    expect(result.templateVersion).toBe(2);
  });

  it('keeps civils on registry flow', () => {
    const result = resolveTimesheetRenderVariant({
      existingId: null,
      resolvedType: 'civils',
    });

    expect(result.variant).toBe('registry');
    expect(result.type).toBe('civils');
    expect(result.templateVersion).toBe(1);
  });
});
