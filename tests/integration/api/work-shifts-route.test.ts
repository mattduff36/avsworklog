import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/server/work-shift-access');
vi.mock('@/lib/server/work-shifts');

import { GET as getMatrix } from '@/app/api/absence/work-shifts/route';
import { PUT as updateEmployee } from '@/app/api/absence/work-shifts/[profileId]/route';

describe('absence work shifts API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the matrix payload for admins', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { getWorkShiftAccessContext } = await import('@/lib/server/work-shift-access');
    const { getWorkShiftMatrix } = await import('@/lib/server/work-shifts');

    const adminClient = {} as never;
    vi.mocked(createAdminClient).mockReturnValue(adminClient);
    vi.mocked(getWorkShiftAccessContext).mockResolvedValue({
      context: {
        userId: 'admin-1',
        isAdmin: true,
        canView: true,
        canEdit: true,
        teamId: null,
      },
      response: null,
    } as never);
    vi.mocked(getWorkShiftMatrix).mockResolvedValue({
      templates: [
        {
          id: 'template-1',
          name: 'Standard Week',
          description: null,
          is_default: true,
          created_at: '2026-03-23T00:00:00.000Z',
          updated_at: '2026-03-23T00:00:00.000Z',
          pattern: {
            monday_am: true,
            monday_pm: true,
            tuesday_am: true,
            tuesday_pm: true,
            wednesday_am: true,
            wednesday_pm: true,
            thursday_am: true,
            thursday_pm: true,
            friday_am: true,
            friday_pm: true,
            saturday_am: false,
            saturday_pm: false,
            sunday_am: false,
            sunday_pm: false,
          },
        },
      ],
      employees: [],
    });

    const response = await getMatrix();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(getWorkShiftMatrix).toHaveBeenCalledWith(adminClient, {
      enforceTeamScope: false,
      teamId: null,
    });
  });

  it('returns 400 when an employee update omits the pattern payload', async () => {
    const { getWorkShiftAccessContext, canAccessProfileForScopedWorkShift } = await import(
      '@/lib/server/work-shift-access'
    );

    vi.mocked(getWorkShiftAccessContext).mockResolvedValue({
      context: {
        userId: 'admin-1',
        isAdmin: true,
        canView: true,
        canEdit: true,
        teamId: null,
      },
      response: null,
    } as never);
    vi.mocked(canAccessProfileForScopedWorkShift).mockResolvedValue(true);

    const response = await updateEmployee(
      new NextRequest('http://localhost/api/absence/work-shifts/user-1', {
        method: 'PUT',
        body: JSON.stringify({ templateId: 'template-1' }),
      }),
      { params: Promise.resolve({ profileId: 'user-1' }) }
    );

    expect(response.status).toBe(400);
  });

  it('returns 403 when caller lacks work shift view access', async () => {
    const { getWorkShiftAccessContext } = await import('@/lib/server/work-shift-access');

    vi.mocked(getWorkShiftAccessContext).mockResolvedValue({
      context: {
        userId: 'supervisor-1',
        isAdmin: false,
        canView: false,
        canEdit: false,
        teamId: 'team-a',
      },
      response: null,
    } as never);

    const response = await getMatrix();
    expect(response.status).toBe(403);
  });

  it('returns 403 when caller lacks work shift edit access', async () => {
    const { getWorkShiftAccessContext } = await import('@/lib/server/work-shift-access');

    vi.mocked(getWorkShiftAccessContext).mockResolvedValue({
      context: {
        userId: 'supervisor-1',
        isAdmin: false,
        canView: true,
        canEdit: false,
        teamId: 'team-a',
      },
      response: null,
    } as never);

    const response = await updateEmployee(
      new NextRequest('http://localhost/api/absence/work-shifts/user-1', {
        method: 'PUT',
        body: JSON.stringify({
          pattern: {
            monday_am: true,
            monday_pm: true,
            tuesday_am: true,
            tuesday_pm: true,
            wednesday_am: true,
            wednesday_pm: true,
            thursday_am: true,
            thursday_pm: true,
            friday_am: true,
            friday_pm: true,
            saturday_am: false,
            saturday_pm: false,
            sunday_am: false,
            sunday_pm: false,
          },
        }),
      }),
      { params: Promise.resolve({ profileId: 'user-1' }) }
    );

    expect(response.status).toBe(403);
  });
});
