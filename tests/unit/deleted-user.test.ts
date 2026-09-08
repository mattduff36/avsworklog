import { describe, expect, it } from 'vitest';
import {
  hasGeneratedDeletedUserNameSuffix,
  isDeletedProfile,
  isDeletedUserName,
  toDeletedUserName,
} from '@/lib/users/deleted-user';

describe('deleted user name helper', () => {
  it('detects the keep-data deleted suffix', () => {
    expect(isDeletedUserName('Tim Wilson (Deleted User)')).toBe(true);
    expect(isDeletedUserName('Tim Wilson')).toBe(false);
    expect(isDeletedUserName(null)).toBe(false);
  });

  it('matches only the generated suffix for backfill', () => {
    expect(hasGeneratedDeletedUserNameSuffix('Tim Wilson (Deleted User)')).toBe(true);
    expect(hasGeneratedDeletedUserNameSuffix('(Deleted User)')).toBe(true);
    expect(hasGeneratedDeletedUserNameSuffix('Not (Deleted User) anymore')).toBe(false);
  });

  it('treats deleted_at as the durable deleted-profile boundary', () => {
    expect(isDeletedProfile({ full_name: 'Tim Wilson', deleted_at: '2026-09-07T10:00:00Z' })).toBe(true);
    expect(isDeletedProfile({ full_name: 'Tim Wilson (Deleted User)', deleted_at: null })).toBe(true);
    expect(isDeletedProfile({ full_name: 'Tim Wilson', deleted_at: null })).toBe(false);
  });

  it('appends the suffix once', () => {
    expect(toDeletedUserName('Tim Wilson')).toBe('Tim Wilson (Deleted User)');
    expect(toDeletedUserName('Tim Wilson (Deleted User)')).toBe('Tim Wilson (Deleted User)');
  });
});
