import { describe, expect, it } from 'vitest';
import { canEditOwnBasicProfileFields } from '@/lib/profile/permissions';

describe('canEditOwnBasicProfileFields', () => {
  it('returns true for super admin flag on profile', () => {
    expect(canEditOwnBasicProfileFields({ super_admin: true })).toBe(true);
  });

  it('returns true for admin role class', () => {
    expect(
      canEditOwnBasicProfileFields({
        role: { role_class: 'admin', name: 'admin', is_manager_admin: true },
      })
    ).toBe(true);
  });

  it('returns true for manager role class', () => {
    expect(
      canEditOwnBasicProfileFields({
        role: { role_class: 'manager', name: 'manager', is_manager_admin: true },
      })
    ).toBe(true);
  });

  it('returns false for employee role class', () => {
    expect(
      canEditOwnBasicProfileFields({
        role: { role_class: 'employee', name: 'employee', is_manager_admin: false },
      })
    ).toBe(false);
  });

  it('returns false for null profile', () => {
    expect(canEditOwnBasicProfileFields(null)).toBe(false);
  });
});

