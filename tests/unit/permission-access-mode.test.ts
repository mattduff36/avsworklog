import { describe, expect, it } from 'vitest';
import {
  getModuleAccessMode,
  getModuleEnforcedMinimumAccessLevel,
  isPermissionLevelAllowedForModule,
  isUniversalPermissionAccessMode,
} from '@/lib/config/permission-access-rules';

describe('permission access mode and Admin Settings Level 5 hard rule', () => {
  it('ACCESS-MODE-01 defaults modules to team and reminders to universal', () => {
    expect(getModuleAccessMode('timesheets')).toBe('team');
    expect(getModuleAccessMode('approvals')).toBe('team');
    expect(getModuleAccessMode('reminders')).toBe('universal');
    expect(getModuleAccessMode('reminders', 'team')).toBe('team');
    expect(getModuleAccessMode('timesheets', 'universal')).toBe('universal');
    expect(isUniversalPermissionAccessMode(getModuleAccessMode('reminders'))).toBe(true);
    expect(isUniversalPermissionAccessMode(getModuleAccessMode('timesheets'))).toBe(false);
  });

  it('AUTH-ADMINSET-LEVEL-01 keeps Admin Settings hard-coded at Level 5', () => {
    expect(getModuleEnforcedMinimumAccessLevel('admin-settings', 0)).toBe(5);
    expect(getModuleEnforcedMinimumAccessLevel('admin-settings', 4)).toBe(5);
    expect(getModuleEnforcedMinimumAccessLevel('admin-settings', 5)).toBe(5);
    expect(getModuleEnforcedMinimumAccessLevel('toolbox-talks', 0)).toBe(4);

    expect(
      isPermissionLevelAllowedForModule(
        {
          module_name: 'admin-settings',
          enforced_minimum_access_level: 5,
          requires_full_access_role: false,
        },
        4
      )
    ).toBe(false);

    expect(
      isPermissionLevelAllowedForModule(
        {
          module_name: 'admin-settings',
          enforced_minimum_access_level: 5,
          requires_full_access_role: false,
        },
        5
      )
    ).toBe(true);
  });
});
