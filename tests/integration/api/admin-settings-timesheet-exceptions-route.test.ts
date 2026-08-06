import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/admin/settings/timesheet-exceptions/route';

vi.mock('@/lib/server/admin-settings-access');
vi.mock('@/lib/server/timesheet-type-exceptions');

describe('admin settings timesheet exceptions collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { requireAdminSettingsAccess } = await import('@/lib/server/admin-settings-access');
    vi.mocked(requireAdminSettingsAccess).mockResolvedValue({
      userId: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('AUTH-TIMESHEET-LEVEL5-01 returns 403 below effective Admin Settings level 5', async () => {
    const { requireAdminSettingsAccess } = await import('@/lib/server/admin-settings-access');
    vi.mocked(requireAdminSettingsAccess).mockResolvedValue({
      userId: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('AUTH-TIMESHEET-LEVEL5-01 returns matrix payload for authorized level-5 delegates', async () => {
    const { requireAdminSettingsAccess } = await import('@/lib/server/admin-settings-access');
    const { getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(requireAdminSettingsAccess).mockResolvedValue({
      userId: 'delegate-1',
      response: null,
    });
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

  it('adds a row through POST for authorized level-5 delegates', async () => {
    const { requireAdminSettingsAccess } = await import('@/lib/server/admin-settings-access');
    const { addTimesheetTypeExceptionRow, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');

    vi.mocked(requireAdminSettingsAccess).mockResolvedValue({
      userId: 'delegate-1',
      response: null,
    });
    vi.mocked(addTimesheetTypeExceptionRow).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'user-2' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as never);
    expect(response.status).toBe(200);
    expect(addTimesheetTypeExceptionRow).toHaveBeenCalledWith('user-2', 'delegate-1');
  });
});
