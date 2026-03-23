import { describe, expect, it } from 'vitest';
import {
  CORE_PERMISSION_TIER_RANKS,
  defaultHierarchyRankForRole,
  isMatrixTierRole,
  normalizeHierarchyRankInput,
} from '@/lib/utils/permission-tiers';

describe('permission tier helpers', () => {
  it('returns default ranks for core roles', () => {
    expect(defaultHierarchyRankForRole('employee', 'contractor')).toBe(CORE_PERMISSION_TIER_RANKS.contractor);
    expect(defaultHierarchyRankForRole('employee', 'employee')).toBe(CORE_PERMISSION_TIER_RANKS.employee);
    expect(defaultHierarchyRankForRole('employee', 'supervisor')).toBe(CORE_PERMISSION_TIER_RANKS.supervisor);
    expect(defaultHierarchyRankForRole('manager', 'manager')).toBe(CORE_PERMISSION_TIER_RANKS.manager);
    expect(defaultHierarchyRankForRole('admin', 'admin')).toBe(CORE_PERMISSION_TIER_RANKS.admin);
  });

  it('normalizes hierarchy rank input safely', () => {
    expect(normalizeHierarchyRankInput('3')).toBe(3);
    expect(normalizeHierarchyRankInput(4.8)).toBe(4);
    expect(normalizeHierarchyRankInput('')).toBeNull();
    expect(normalizeHierarchyRankInput('-1')).toBeNull();
    expect(normalizeHierarchyRankInput('abc')).toBeNull();
  });

  it('flags ranked non-admin roles as matrix tiers', () => {
    expect(isMatrixTierRole({ name: 'employee', hierarchy_rank: 2, is_super_admin: false })).toBe(true);
    expect(isMatrixTierRole({ name: 'admin', hierarchy_rank: 999, is_super_admin: false })).toBe(false);
    expect(isMatrixTierRole({ name: 'manager', hierarchy_rank: null, is_super_admin: false })).toBe(false);
    expect(isMatrixTierRole({ name: 'super-admin', hierarchy_rank: 10, is_super_admin: true })).toBe(false);
  });
});
