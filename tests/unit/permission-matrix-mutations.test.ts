import { describe, expect, it } from 'vitest';
import {
  applyPermissionMatrixUpdatesAtomically,
  type PermissionMatrixPgClient,
} from '@/lib/server/permission-matrix-mutations';

class FakePermissionMatrixClient implements PermissionMatrixPgClient {
  readonly calls: Array<{ text: string; values?: unknown[] }> = [];
  failExplicitUserUpdate = false;
  failAuditInsert = false;

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
    if (this.failAuditInsert && normalized.includes('INSERT INTO public.audit_log')) {
      throw new Error('Simulated audit insert failure');
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
  it('PERM-TX-01 / PERM-AUDIT-UUID-01 commits typed changes and UUID audit bindings', async () => {
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
    const auditInsert = client.calls.find((call) => (
      call.text.includes('INSERT INTO public.audit_log')
    ));
    expect(auditInsert?.text).toContain('$1::uuid');
    expect(auditInsert?.text).not.toContain('$1::text');
    expect(auditInsert?.text).toContain('permission_matrix_update');
    expect(auditInsert?.values?.[0]).toBe(mutation.actorUserId);
    expect(auditInsert?.values?.[1]).toBe(mutation.actorUserId);
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

  it('PERM-AUDIT-ROLLBACK-01 rolls back when the final audit insert fails', async () => {
    const client = new FakePermissionMatrixClient();
    client.failAuditInsert = true;

    await expect(
      applyPermissionMatrixUpdatesAtomically(mutation, () => client)
    ).rejects.toThrow('Simulated audit insert failure');

    expect(client.calls.some((call) => (
      call.text.includes('INSERT INTO public.user_module_permissions')
      && call.values?.[2] === 4
    ))).toBe(true);
    expect(client.calls.at(-1)?.text).toBe('ROLLBACK');
    expect(client.calls.some((call) => call.text === 'COMMIT')).toBe(false);
  });
});
