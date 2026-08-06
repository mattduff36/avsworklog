import { describe, expect, it } from 'vitest';
import { getModuleBrandSurfaceClasses } from '@/lib/utils/module-brand-presentation';

describe('getModuleBrandSurfaceClasses', () => {
  it('uses module brand tokens for permission guide surfaces', () => {
    expect(getModuleBrandSurfaceClasses('timesheets').card).toContain('--timesheet-primary');
    expect(getModuleBrandSurfaceClasses('inspections').card).toContain('--inspection-primary');
    expect(getModuleBrandSurfaceClasses('hgv-inspections').card).toContain('--hgv-inspection-primary');
    expect(getModuleBrandSurfaceClasses('plant-inspections').card).toContain('--plant-inspection-primary');
    expect(getModuleBrandSurfaceClasses('rams').card).toContain('--rams-primary');
    expect(getModuleBrandSurfaceClasses('absence').card).toContain('--absence-primary');
    expect(getModuleBrandSurfaceClasses('maintenance').card).toContain('--maintenance-primary');
    expect(getModuleBrandSurfaceClasses('toolbox-talks').card).toContain('--avs-yellow');
  });

  it('falls back to AVS yellow for unknown modules', () => {
    expect(getModuleBrandSurfaceClasses('not-a-module').card).toContain('--avs-yellow');
  });
});
