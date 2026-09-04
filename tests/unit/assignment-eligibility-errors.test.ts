import { describe, expect, it, vi } from 'vitest';
import { getSystemAccountIds } from '@/lib/server/system-accounts';
import { getHiddenSystemTestAccountIds } from '@/lib/server/system-test-accounts';

describe('assignment eligibility fail-closed helpers', () => {
  it('getSystemAccountIds throws when the profiles query fails', async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: async () => ({ data: null, error: { message: 'profiles unavailable' } }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    await expect(getSystemAccountIds(admin as never)).rejects.toThrow('profiles unavailable');
  });

  it('getSystemAccountIds throws when the kiosk query fails', async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: 'kiosk unavailable' } }),
            }),
          }),
        };
      }),
    };

    await expect(getSystemAccountIds(admin as never)).rejects.toThrow('kiosk unavailable');
  });

  it('getHiddenSystemTestAccountIds throws when auth admin is missing', async () => {
    await expect(getHiddenSystemTestAccountIds({} as never)).rejects.toThrow(
      'Failed to load hidden system test account auth IDs'
    );
  });

  it('getHiddenSystemTestAccountIds throws when listUsers fails', async () => {
    const admin = {
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: { users: [] },
            error: { message: 'auth users unavailable' },
          })),
        },
      },
    };

    await expect(getHiddenSystemTestAccountIds(admin)).rejects.toThrow('auth users unavailable');
  });
});
