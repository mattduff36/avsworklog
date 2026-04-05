import { describe, expect, it } from 'vitest';
import { withAuthOverrides } from '@/lib/supabase/with-auth-overrides';

describe('withAuthOverrides', () => {
  it('returns overridden auth methods without calling the original implementation', async () => {
    const client = {
      auth: {
        marker: 'original-auth',
        async getUser() {
          throw new Error('original getUser should not be called');
        },
        async getSession() {
          return { marker: this.marker };
        },
      },
    };

    const proxied = withAuthOverrides(client, {
      getUser: async () => ({
        data: {
          user: { id: 'profile-123' },
        },
        error: null,
      }),
    });

    await expect(proxied.auth.getUser()).resolves.toEqual({
      data: {
        user: { id: 'profile-123' },
      },
      error: null,
    });
    await expect(proxied.auth.getSession()).resolves.toEqual({ marker: 'original-auth' });
  });
});
