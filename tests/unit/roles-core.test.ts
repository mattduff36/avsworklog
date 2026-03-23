import { describe, expect, it } from 'vitest';
import {
  getRoleSortPriority,
  isCoreRoleName,
  isRetiredRoleName,
} from '@/lib/config/roles-core';

describe('core role utilities', () => {
  it('detects core role names', () => {
    expect(isCoreRoleName('admin')).toBe(true);
    expect(isCoreRoleName('manager')).toBe(true);
    expect(isCoreRoleName('employee')).toBe(true);
    expect(isCoreRoleName('contractor')).toBe(true);
    expect(isCoreRoleName('employee-civils')).toBe(false);
  });

  it('detects retired role names', () => {
    expect(isRetiredRoleName('employee-civils')).toBe(true);
    expect(isRetiredRoleName('transport-manager')).toBe(true);
    expect(isRetiredRoleName('employee')).toBe(false);
    expect(isRetiredRoleName('project-coordinator')).toBe(false);
  });

  it('sorts core roles before others', () => {
    expect(getRoleSortPriority('admin')).toBeLessThan(getRoleSortPriority('manager'));
    expect(getRoleSortPriority('manager')).toBeLessThan(getRoleSortPriority('employee'));
    expect(getRoleSortPriority('employee')).toBeLessThan(getRoleSortPriority('contractor'));
    expect(getRoleSortPriority('contractor')).toBeLessThan(getRoleSortPriority('custom-role'));
  });
});
