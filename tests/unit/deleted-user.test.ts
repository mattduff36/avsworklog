import { describe, expect, it } from 'vitest';
import { isDeletedUserName, toDeletedUserName } from '@/lib/users/deleted-user';

describe('deleted user name helper', () => {
  it('detects the keep-data deleted suffix', () => {
    expect(isDeletedUserName('Tim Wilson (Deleted User)')).toBe(true);
    expect(isDeletedUserName('Tim Wilson')).toBe(false);
    expect(isDeletedUserName(null)).toBe(false);
  });

  it('appends the suffix once', () => {
    expect(toDeletedUserName('Tim Wilson')).toBe('Tim Wilson (Deleted User)');
    expect(toDeletedUserName('Tim Wilson (Deleted User)')).toBe('Tim Wilson (Deleted User)');
  });
});
