import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE,
  PATCH,
} from '@/app/api/admin/settings/timesheet-exceptions/[profileId]/route';

vi.mock('@/lib/server/admin-settings-access');
vi.mock('@/lib/server/timesheet-type-exceptions');

describe('admin settings timesheet exceptions profile route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireAdminSettingsAccess } = await import('@/lib/server/admin-settings-access');
    vi.mocked(requireAdminSettingsAccess).mockResolvedValue({
      userId: 'delegate-1',
      response: null,
    });
  });

  it('updates an override with PATCH', async () => {
    const { upsertTimesheetTypeException, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');
    vi.mocked(upsertTimesheetTypeException).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions/user-1', {
      method: 'PATCH',
      body: JSON.stringify({ timesheet_type: 'plant' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request as never, { params: Promise.resolve({ profileId: 'user-1' }) });
    expect(response.status).toBe(200);
    expect(upsertTimesheetTypeException).toHaveBeenCalledWith({
      profile_id: 'user-1',
      timesheet_type: 'plant',
      actor_id: 'delegate-1',
    });
  });

  it('updates an override to user choice with PATCH', async () => {
    const { upsertTimesheetTypeException, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');
    vi.mocked(upsertTimesheetTypeException).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions/user-1', {
      method: 'PATCH',
      body: JSON.stringify({ timesheet_type: 'user_choice' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request as never, { params: Promise.resolve({ profileId: 'user-1' }) });
    expect(response.status).toBe(200);
    expect(upsertTimesheetTypeException).toHaveBeenCalledWith({
      profile_id: 'user-1',
      timesheet_type: 'user_choice',
      actor_id: 'delegate-1',
    });
  });

  it('rejects invalid PATCH timesheet_type values', async () => {
    const { upsertTimesheetTypeException } = await import('@/lib/server/timesheet-type-exceptions');

    const request = new Request('http://localhost/api/admin/settings/timesheet-exceptions/user-1', {
      method: 'PATCH',
      body: JSON.stringify({ timesheet_type: 'foobar' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request as never, { params: Promise.resolve({ profileId: 'user-1' }) });
    expect(response.status).toBe(400);
    expect(upsertTimesheetTypeException).not.toHaveBeenCalled();
  });

  it('deletes an override row with DELETE', async () => {
    const { deleteTimesheetTypeExceptionRow, getTimesheetTypeExceptionMatrix } = await import('@/lib/server/timesheet-type-exceptions');
    vi.mocked(deleteTimesheetTypeExceptionRow).mockResolvedValue();
    vi.mocked(getTimesheetTypeExceptionMatrix).mockResolvedValue({ rows: [] });

    const response = await DELETE(new Request('http://localhost') as never, {
      params: Promise.resolve({ profileId: 'user-1' }),
    });
    expect(response.status).toBe(200);
    expect(deleteTimesheetTypeExceptionRow).toHaveBeenCalledWith('user-1');
  });
});
