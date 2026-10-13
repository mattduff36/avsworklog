import { describe, expect, it } from 'vitest';
import { ALL_MODULES, STANDARD_MODULES, MODULE_DISPLAY_NAMES, MODULE_SHORT_NAMES, MODULE_CSS_VAR, MODULE_DESCRIPTIONS } from '@/types/roles';
import { FORM_TYPES } from '@/lib/config/forms';
import { canAccessNavItem, employeeNavItems } from '@/lib/config/navigation';
import { getAccentFromRoute } from '@/lib/theme/getAccentFromRoute';
import { getReleaseDescriptorByScope } from '@/lib/config/release-module-descriptors';

describe('External Documents registration', () => {
  it('registers one standard permission module with complete display metadata', () => {
    expect(ALL_MODULES.filter(module => module === 'external-documents')).toHaveLength(1);
    expect(STANDARD_MODULES).toContain('external-documents');
    expect(MODULE_DISPLAY_NAMES['external-documents']).toBe('External Documents');
    expect(MODULE_SHORT_NAMES['external-documents']).toBeTruthy();
    expect(MODULE_CSS_VAR['external-documents']).toBe('--external-documents-primary');
    expect(MODULE_DESCRIPTIONS['external-documents']).toBeTruthy();
  });
  it('shows navigation only for effective enabled access or full admin access', () => {
    const link = employeeNavItems.find(item => item.module === 'external-documents');
    expect(link).toBeDefined();
    expect(canAccessNavItem(link!, new Set(), { 'external-documents': 0 }, false)).toBe(false);
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(canAccessNavItem(link!, new Set(['external-documents']), { 'external-documents': level }, false)).toBe(true);
    }
    expect(canAccessNavItem(link!, new Set(), null, true)).toBe(true);
  });
  it('links the dashboard tile and module accent to the real route', () => {
    expect(FORM_TYPES.find(item => item.id === 'external-documents')).toMatchObject({ href: '/external-documents', minimumAccessLevel: 1 });
    expect(getAccentFromRoute('/external-documents')).toBe('external-documents');
  });
  it('classifies the feature for the release workflow', () => {
    expect(getReleaseDescriptorByScope('external-documents')).toMatchObject({ permissionModule: 'external-documents', category: 'standard' });
  });
});
