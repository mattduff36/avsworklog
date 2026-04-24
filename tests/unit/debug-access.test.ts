import { describe, expect, it } from 'vitest';
import { canAccessDebugConsole, isCharlotteDebugAccessUser } from '@/lib/utils/debug-access';

describe('isCharlotteDebugAccessUser', () => {
  it('matches Charlotte email case-insensitively', () => {
    expect(isCharlotteDebugAccessUser('CHARLOTTE@avsquires.co.uk')).toBe(true);
  });

  it('rejects other emails', () => {
    expect(isCharlotteDebugAccessUser('someone@avsquires.co.uk')).toBe(false);
  });
});

describe('canAccessDebugConsole', () => {
  it('allows actual superadmins in actual-role mode', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin@mpdee.co.uk',
        isActualSuperAdmin: true,
        isViewingAs: false,
      })
    ).toBe(true);
  });

  it('allows Charlotte without superadmin access', () => {
    expect(
      canAccessDebugConsole({
        email: 'charlotte@avsquires.co.uk',
        isActualSuperAdmin: false,
        isViewingAs: false,
      })
    ).toBe(true);
  });

  it('blocks view-as mode even for otherwise eligible users', () => {
    expect(
      canAccessDebugConsole({
        email: 'charlotte@avsquires.co.uk',
        isActualSuperAdmin: false,
        isViewingAs: true,
      })
    ).toBe(false);
  });

  it('blocks other users', () => {
    expect(
      canAccessDebugConsole({
        email: 'admin.user@avsquires.co.uk',
        isActualSuperAdmin: false,
        isViewingAs: false,
      })
    ).toBe(false);
  });
});
