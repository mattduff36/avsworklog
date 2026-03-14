import { describe, expect, it } from 'vitest';
import {
  managerFlagFromRoleClass,
  normalizeRoleInternalName,
  roleClassFromLegacyRoleType,
} from '@/lib/utils/role-name';

describe('Role naming and class normalization', () => {
  it('normalizes mixed-case role names to kebab-case', () => {
    expect(normalizeRoleInternalName('Employee - Workshop')).toBe('employee-workshop');
    expect(normalizeRoleInternalName('TEST EMPLOYEE ROLE')).toBe('test-employee-role');
  });

  it('derives role class from explicit class first', () => {
    expect(roleClassFromLegacyRoleType('manager', false, 'employee-civils')).toBe('manager');
    expect(roleClassFromLegacyRoleType('employee', true, 'manager')).toBe('employee');
  });

  it('maps role class to manager-admin compatibility flag', () => {
    expect(managerFlagFromRoleClass('employee')).toBe(false);
    expect(managerFlagFromRoleClass('manager')).toBe(true);
    expect(managerFlagFromRoleClass('admin')).toBe(true);
  });
});
