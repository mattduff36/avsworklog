import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/permissions');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));
vi.mock('@/lib/server/system-accounts');
vi.mock('@/lib/server/team-permissions');

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import { getSystemAccountIds } from '@/lib/server/system-accounts';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';
import { POST } from '@/app/api/rams/[id]/assign/route';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';
const MANAGER_ID = '55555555-5555-4555-8555-555555555555';

type QueryResult = { data: unknown; error: unknown };

function createThenable(result: QueryResult) {
  const state: {
    type: 'select' | 'delete' | 'upsert';
    select?: string;
    eq: Record<string, unknown>;
    in: Record<string, unknown>;
    neq: Record<string, unknown>;
    upsertRows?: unknown;
  } = {
    type: 'select',
    eq: {},
    in: {},
    neq: {},
  };

  const chain: Record<string, unknown> = {};
  chain.select = (columns?: string) => {
    state.select = columns;
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    state.eq[column] = value;
    return chain;
  };
  chain.in = (column: string, value: unknown) => {
    state.in[column] = value;
    return chain;
  };
  chain.neq = (column: string, value: unknown) => {
    state.neq[column] = value;
    return chain;
  };
  chain.single = async () => result;
  chain.delete = () => {
    state.type = 'delete';
    return chain;
  };
  chain.upsert = (rows: unknown) => {
    state.type = 'upsert';
    state.upsertRows = rows;
    return chain;
  };
  chain.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(onFulfilled, onRejected);

  return { chain, state };
}

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/rams/${DOC_ID}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rams/[id]/assign', () => {
  const deleteStates: Array<ReturnType<typeof createThenable>['state']> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    deleteStates.length = 0;

    vi.mocked(getProfileWithRole).mockResolvedValue({ id: MANAGER_ID } as never);
    vi.mocked(canEffectiveRoleUseModuleLevel).mockResolvedValue(true);
    vi.mocked(getSystemAccountIds).mockResolvedValue(new Set());
    vi.mocked(getUsersWithModuleAccess).mockResolvedValue(new Set([USER_A, USER_B]));
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn() } as never);
  });

  function mockDatabase(options: {
    current?: QueryResult;
    signed?: QueryResult;
    existing?: QueryResult;
    deleted?: QueryResult;
    profiles?: QueryResult;
    upsert?: QueryResult;
  }) {
    const documentQuery = createThenable({
      data: { id: DOC_ID, title: 'Site RAMS' },
      error: null,
    });
    const currentQuery = createThenable(options.current ?? {
      data: [{ employee_id: USER_A }],
      error: null,
    });
    const signedQuery = createThenable(options.signed ?? { data: [], error: null });
    const existingQuery = createThenable(options.existing ?? {
      data: [{ employee_id: USER_A, status: 'pending' }],
      error: null,
    });
    const deletedQuery = createThenable(options.deleted ?? { data: [], error: null });
    const profilesQuery = createThenable(options.profiles ?? {
      data: [{ id: USER_A }, { id: USER_B }],
      error: null,
    });
    const upsertQuery = createThenable(options.upsert ?? { data: [], error: null });

    deleteStates.push(deletedQuery.state);

    let assignmentSelects = 0;

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: MANAGER_ID } },
          error: null,
        }),
      },
      from(table: string) {
        if (table === 'rams_documents') {
          return documentQuery.chain;
        }
        if (table === 'profiles') {
          return profilesQuery.chain;
        }
        if (table !== 'rams_assignments') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          select(columns: string) {
            assignmentSelects += 1;
            if (columns === 'employee_id, status') {
              return existingQuery.chain.select(columns);
            }
            if (assignmentSelects === 1) {
              return currentQuery.chain.select(columns);
            }
            return signedQuery.chain.select(columns);
          },
          delete() {
            return deletedQuery.chain.delete();
          },
          upsert(rows: unknown) {
            return upsertQuery.chain.upsert(rows);
          },
        };
      },
    } as unknown as SupabaseClient);
  }

  it('ASSIGN-UNASSIGN-001: requires Level 4 and fails closed when delete IDs do not match', async () => {
    mockDatabase({
      current: { data: [{ employee_id: USER_A }], error: null },
      signed: { data: [], error: null },
      deleted: { data: [], error: null },
    });

    const response = await POST(
      buildRequest({
        employee_ids: [],
        unassign_ids: [USER_A],
      }),
      { params: Promise.resolve({ id: DOC_ID }) }
    );

    expect(canEffectiveRoleUseModuleLevel).toHaveBeenCalledWith('rams', 4);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Failed to unassign employees: assignment state changed',
    });
    expect(deleteStates[0]?.neq).toEqual({ status: 'signed' });
    expect(deleteStates[0]?.in).toEqual({ employee_id: [USER_A] });
    expect(deleteStates[0]?.select).toBe('employee_id');
  });

  it('ASSIGN-SIGNED-001: signed employees are omitted from delete even if a later status race occurs', async () => {
    mockDatabase({
      current: { data: [{ employee_id: USER_A }, { employee_id: USER_B }], error: null },
      signed: { data: [{ employee_id: USER_A }], error: null },
      deleted: { data: [{ employee_id: USER_B }], error: null },
    });

    const response = await POST(
      buildRequest({
        employee_ids: [],
        unassign_ids: [USER_A, USER_B],
      }),
      { params: Promise.resolve({ id: DOC_ID }) }
    );

    expect(response.status).toBe(200);
    expect(deleteStates[0]?.in).toEqual({ employee_id: [USER_B] });
    expect(deleteStates[0]?.neq).toEqual({ status: 'signed' });
  });

  it('rejects overlapping assign and unassign IDs before any write', async () => {
    const from = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: MANAGER_ID } },
          error: null,
        }),
      },
      from,
    } as unknown as SupabaseClient);

    const response = await POST(
      buildRequest({
        employee_ids: [USER_A],
        unassign_ids: [USER_A],
      }),
      { params: Promise.resolve({ id: DOC_ID }) }
    );

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('ASSIGN-PREREQ-ERROR-001: fails closed before delete when system-account lookup throws', async () => {
    mockDatabase({
      current: { data: [{ employee_id: USER_A }], error: null },
      signed: { data: [], error: null },
    });
    vi.mocked(getSystemAccountIds).mockRejectedValue(new Error('Failed to load system account profiles'));

    const response = await POST(
      buildRequest({
        employee_ids: [],
        unassign_ids: [USER_A],
      }),
      { params: Promise.resolve({ id: DOC_ID }) }
    );

    expect(response.status).toBe(500);
    expect(deleteStates[0]?.type).toBe('select');
  });

  it('validates new assignees have RAMS access before delete', async () => {
    mockDatabase({
      current: { data: [], error: null },
      profiles: { data: [{ id: USER_B }], error: null },
    });
    vi.mocked(getUsersWithModuleAccess).mockResolvedValue(new Set());

    const response = await POST(
      buildRequest({
        employee_ids: [USER_B],
        unassign_ids: [],
      }),
      { params: Promise.resolve({ id: DOC_ID }) }
    );

    expect(response.status).toBe(400);
    expect(getUsersWithModuleAccess).toHaveBeenCalledWith('rams', [USER_B], expect.anything());
    await expect(response.json()).resolves.toMatchObject({
      error: 'One or more employees do not have Projects access',
    });
  });
});
