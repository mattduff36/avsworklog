import { describe, expect, it } from 'vitest';
import {
  applyPermissionMatrixUpdatesAtomically,
  type PermissionMatrixPgClient,
} from '@/lib/server/permission-matrix-mutations';

class FakePermissionMatrixClient implements PermissionMatrixPgClient {
  readonly calls: Array<{ text: string; values?: unknown[] }> = [];
  failExplicitUserUpdate = false;

  async connect() {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.calls.push({ text: normalized, values });

    if (normalized.includes('FROM public.permission_modules')) {
      return {
        rows: [{
          module_name: 'daily-allocation',
          minimum_hierarchy_rank: 2,
        }] as Row[],
      };
    }
    if (normalized.includes('FROM public.profiles profile')) {
      return {
        rows: [{
          id: '00000000-0000-0000-0000-000000000001',
          team_id: 'civils',
          role_id: 'role-manager',
          role_name: 'manager',
          role_class: 'manager',
          hierarchy_rank: 4,
          is_super_admin: false,
        }] as Row[],
      };
    }
    if (normalized.includes('FROM public.team_module_permissions')) {
      return { rows: [] };
    }
    if (
      normalized.includes('FROM public.user_module_permissions')
      && normalized.startsWith('SELECT')
    ) {
      return { rows: [] };
    }
    if (
      this.failExplicitUserUpdate
      && normalized.includes('INSERT INTO public.user_module_permissions')
      && values?.[2] === 4
    ) {
      throw new Error('Simulated user permission failure');
    }

    return { rows: [] };
  }

  async end() {}
}

const mutation = {
  actorUserId: '00000000-0000-0000-0000-000000000099',
  userUpdates: [{
    user_id: '00000000-0000-0000-0000-000000000001',
    module_name: 'daily-allocation' as const,
    access_level: 4 as const,
  }],
  teamDefaultUpdates: [{
    team_id: 'civils',
    module_name: 'daily-allocation' as const,
    enabled: true,
  }],
};

describe('atomic permission matrix mutations', () => {
  it('PERM-TX-01 commits text-team and UUID-user changes in one serializable transaction', async () => {
    const client = new FakePermissionMatrixClient();
    await applyPermissionMatrixUpdatesAtomically(mutation, () => client);

    expect(client.calls[0]?.text).toBe('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const profileRead = client.calls.find((call) => call.text.includes('FROM public.profiles profile'));
    const teamDefaultRead = client.calls.find((call) => (
      call.text.includes('FROM public.team_module_permissions')
    ));
    expect(profileRead?.text).toContain('profile.id = ANY($1::uuid[])');
    expect(profileRead?.text).toContain('profile.team_id = ANY($2::text[])');
    expect(profileRead?.values?.[1]).toEqual(['civils']);
    expect(teamDefaultRead?.text).toContain('team_id = ANY($1::text[])');
    expect(teamDefaultRead?.text).not.toContain('team_id = ANY($1::uuid[])');
    expect(client.calls.some((call) => (
      call.text.includes('INSERT INTO public.team_module_permissions')
    ))).toBe(true);
    expect(client.calls.some((call) => (
      call.text.includes('INSERT INTO public.user_module_permissions')
      && call.values?.[2] === 4
    ))).toBe(true);
    expect(client.calls.some((call) => (
      call.text.includes('INSERT INTO public.audit_log')
      && call.text.includes('permission_matrix_update')
    ))).toBe(true);
    expect(client.calls.at(-1)?.text).toBe('COMMIT');
  });

  it('PERM-TX-02 rolls back all permission changes when a later write fails', async () => {
    const client = new FakePermissionMatrixClient();
    client.failExplicitUserUpdate = true;

    await expect(
      applyPermissionMatrixUpdatesAtomically(mutation, () => client)
    ).rejects.toThrow('Simulated user permission failure');

    expect(client.calls.some((call) => (
      call.text.includes('INSERT INTO public.team_module_permissions')
    ))).toBe(true);
    expect(client.calls.at(-1)?.text).toBe('ROLLBACK');
    expect(client.calls.some((call) => call.text === 'COMMIT')).toBe(false);
  });
});
