import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET } from '@/app/api/dashboard/summary/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/server/team-permissions');

function createCountQuery(count: number) {
  const resolved = { count, error: null };
  const query = {
    eq: vi.fn().mockResolvedValue({ count, error: null }),
    in: vi.fn().mockReturnThis(),
    then: (resolve: (value: typeof resolved) => unknown) => Promise.resolve(resolved).then(resolve),
  };
  return query;
}

describe('GET /api/dashboard/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('Unauthorized'),
        }),
      },
    } as unknown as SupabaseClient);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns aggregated metrics for the effective user permissions', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { getPermissionMapForUser } = await import('@/lib/server/team-permissions');

    vi.mocked(getEffectiveRole).mockResolvedValue({
      role_id: 'employee-role',
      role_name: 'employee',
      display_name: 'Employee',
      is_manager_admin: false,
      is_super_admin: false,
      is_viewing_as: false,
      is_actual_super_admin: false,
      user_id: 'user-1',
      team_id: 'team-a',
      team_name: 'Team A',
    });
    vi.mocked(createAdminClient).mockReturnValue({} as never);
    vi.mocked(getPermissionMapForUser).mockResolvedValue({
      timesheets: false,
      inspections: false,
      'plant-inspections': false,
      'hgv-inspections': false,
      rams: false,
      absence: false,
      maintenance: true,
      'toolbox-talks': false,
      'workshop-tasks': true,
      approvals: true,
      actions: true,
      reports: false,
      suggestions: true,
      'faq-editor': false,
      'error-reports': true,
      'admin-users': false,
      'admin-vans': false,
      customers: false,
      quotes: true,
    });

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'timesheets') return { select: () => createCountQuery(4) };
        if (table === 'absences') return { select: () => createCountQuery(2) };
        if (table === 'actions') return { select: () => createCountQuery(3) };
        if (table === 'suggestions') return { select: () => createCountQuery(5) };
        if (table === 'error_reports') return { select: () => createCountQuery(1) };
        if (table === 'quotes') return { select: () => createCountQuery(6) };
        if (table === 'error_logs') return { select: () => createCountQuery(0) };
        if (table === 'maintenance_categories') {
          return {
            select: () => ({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          };
        }
        if (table === 'vans' || table === 'hgvs') {
          return {
            select: () => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: `${table}-1`, maintenance: null }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'plant') {
          return {
            select: () => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: 'plant-1', loler_due_date: null, maintenance: null }],
                error: null,
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };

    vi.mocked(createClient).mockResolvedValue(supabase as unknown as SupabaseClient);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics).toEqual({
      approvals: {
        timesheets: 4,
        absences: 2,
      },
      actions: {
        workshop: 6,
        maintenance: 0,
        suggestions: 10,
        errors: 2,
      },
      badges: {
        suggestions_new: 5,
        error_reports_new: 1,
        quotes_pending_internal_approval: 6,
        error_logs: 0,
      },
    });
  });
});
