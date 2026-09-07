import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { GET } from '@/app/api/debug/audit-logs/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { AUDIT_LOG_PAGE_SIZE } from '@/lib/server/audit-logs';

function mockSuperAdmin() {
  vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
    profile: { id: 'admin-1', email: 'admin@example.com' },
  } as never);
  vi.mocked(getEffectiveRole).mockResolvedValue({
    role_id: 'role-1',
    role_name: 'super_admin',
    display_name: 'Super Admin',
    role_class: 'admin',
    is_manager_admin: true,
    is_super_admin: true,
    is_viewing_as: false,
    is_actual_super_admin: true,
    user_id: 'admin-1',
    team_id: null,
    team_name: null,
  });
}

function mockEmployee() {
  vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
    profile: { id: 'user-9', email: 'employee@example.com' },
  } as never);
  vi.mocked(getEffectiveRole).mockResolvedValue({
    role_id: 'role-employee',
    role_name: 'employee',
    display_name: 'Employee',
    role_class: 'employee',
    is_manager_admin: false,
    is_super_admin: false,
    is_viewing_as: false,
    is_actual_super_admin: false,
    user_id: 'user-9',
    team_id: 'team-1',
    team_name: 'Transport',
  });
}

function mockAuditAdmin(rows = [
  {
    id: 'log-1',
    table_name: 'timesheets',
    record_id: 'rec-1',
    user_id: 'user-1',
    action: 'updated',
    changes: { status: { old: 'draft', new: 'submitted' } },
    created_at: '2026-09-07T12:00:00.000Z',
  },
]) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = vi.fn(ret);
  chain.order = vi.fn(ret);
  chain.limit = vi.fn(ret);
  chain.eq = vi.fn(ret);
  chain.is = vi.fn(ret);
  chain.in = vi.fn(ret);
  chain.or = vi.fn(ret);
  chain.gte = vi.fn(ret);
  chain.ilike = vi.fn(ret);
  chain.not = vi.fn(ret);
  chain.neq = vi.fn(ret);
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve, reject);

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'audit_log') {
        return chain;
      }
      if (table === 'org_teams') {
        return {
          select: vi.fn(() => ({
            ilike: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'id') {
              return {
                ilike: vi.fn().mockResolvedValue({ data: [], error: null }),
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                is: vi.fn().mockResolvedValue({ data: [], error: null }),
              };
            }
            return {
              in: vi.fn().mockResolvedValue({
                data: [{ id: 'user-1', full_name: 'John Browne', team_id: 'team-1' }],
                error: null,
              }),
              eq: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            };
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as never);

  return chain;
}

describe('GET /api/debug/audit-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AL-AUTH-001 returns 401 without a session and 403 without debug-console access', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const unauthenticated = await GET(new NextRequest('http://localhost/api/debug/audit-logs'));
    expect(unauthenticated.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();

    mockEmployee();
    const forbidden = await GET(new NextRequest('http://localhost/api/debug/audit-logs'));
    expect(forbidden.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('AL-AUTH-002 returns 200 and logs for an allowed debug-console caller', async () => {
    mockSuperAdmin();
    mockAuditAdmin();

    const response = await GET(new NextRequest('http://localhost/api/debug/audit-logs'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.logs).toEqual([
      expect.objectContaining({
        id: 'log-1',
        user_name: 'John Browne',
        table_name: 'timesheets',
      }),
    ]);
    expect(payload.pagination.limit).toBe(AUDIT_LOG_PAGE_SIZE);
    expect(payload.pagination.has_more).toBe(false);
  });

  it('AL-CAP-001 clamps limit=5000 on the route to 200', async () => {
    mockSuperAdmin();
    const chain = mockAuditAdmin();

    const response = await GET(new NextRequest('http://localhost/api/debug/audit-logs?limit=5000'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pagination.limit).toBe(200);
    expect(chain.limit).toHaveBeenCalledWith(201);
  });
});
