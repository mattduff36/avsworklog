import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/admin/settings/timesheet-exceptions/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/server/timesheet-type-exceptions');

describe('admin settings timesheet exceptions collection route', () => {
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
    } as never);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns 403 for non-admin actor', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      is_actual_super_admin: false,
      is_super_admin: false,
      role_name: 'manager',
    } as never);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('returns matrix payload for authorized admins', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      is_actual_super_admin: false,
      is_super_admin: false,
      role_name: 'admin',
    } as never);
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({
      rows: [
        {
          profile_id: 'user-2',
          full_name: 'Test User',
          employee_id: 'E001',
          role_name: 'employee',
          role_display_name: 'Employee',
          team_id: 'team-a',
          team_name: 'Team A',
          team_timesheet_type: 'civils',
          default_timesheet_type: 'civils',
          override_timesheet_type: 'plant',
          effective_timesheet_type: 'plant',
          has_exception_row: true,
        },
      ],
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.rows).toHaveLength(1);
  });

  it('adds a row through POST for authorized admins', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');
    const { addTimesheetTypeExceptionRow, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      is_actual_super_admin: false,
      is_super_admin: true,
      role_name: 'admin',
    } as never);
    vi.mocked(addTimesheetTypeExceptionRow).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'user-2' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as never);
    expect(response.status).toBe(200);
    expect(addTimesheetTypeExceptionRow).toHaveBeenCalledWith('user-2', 'admin-1');
  });
});
