import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_SWITCH_LOCK_MINUTES,
  hashQuickSwitchPin,
  isPinLockActive,
  validateQuickSwitchPin,
  verifyQuickSwitchPin,
} from '@/lib/server/account-switch-pin';

describe('account switch PIN helpers', () => {
  it('validates PIN format and blocks weak numeric patterns', () => {
    expect(validateQuickSwitchPin('12ab').isValid).toBe(false);
    expect(validateQuickSwitchPin('1111').isValid).toBe(false);
    expect(validateQuickSwitchPin('1234').isValid).toBe(false);
    expect(validateQuickSwitchPin('9876').isValid).toBe(false);
    expect(validateQuickSwitchPin('2580').isValid).toBe(true);
  });

  it('hashes and verifies PIN values', () => {
    const pinHash = hashQuickSwitchPin('2580');
    expect(pinHash).toContain('scrypt$');
    expect(verifyQuickSwitchPin('2580', pinHash)).toBe(true);
    expect(verifyQuickSwitchPin('2581', pinHash)).toBe(false);
  });

  it('tracks lock activity using lock timestamp', () => {
    const lockUntil = new Date(Date.now() + ACCOUNT_SWITCH_LOCK_MINUTES * 60 * 1000).toISOString();
    expect(isPinLockActive(lockUntil)).toBe(true);
    expect(isPinLockActive(new Date(Date.now() - 1000).toISOString())).toBe(false);
  });
});
