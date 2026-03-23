import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/server/absence-work-shift-auth');
vi.mock('@/lib/server/work-shifts');

import { GET as getMatrix } from '@/app/api/absence/work-shifts/route';
import { PUT as updateEmployee } from '@/app/api/absence/work-shifts/[profileId]/route';

describe('absence work shifts API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the matrix payload for admins', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { requireAdminWorkShiftAccess } = await import('@/lib/server/absence-work-shift-auth');
    const { getWorkShiftMatrix } = await import('@/lib/server/work-shifts');

    const adminClient = {} as never;
    vi.mocked(createAdminClient).mockReturnValue(adminClient);
    vi.mocked(requireAdminWorkShiftAccess).mockResolvedValue({
      user: { id: 'admin-1' },
      response: null,
    });
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
    expect(getWorkShiftMatrix).toHaveBeenCalledWith(adminClient);
  });

  it('returns 400 when an employee update omits the pattern payload', async () => {
    const { requireAdminWorkShiftAccess } = await import('@/lib/server/absence-work-shift-auth');

    vi.mocked(requireAdminWorkShiftAccess).mockResolvedValue({
      user: { id: 'admin-1' },
      response: null,
    });

    const response = await updateEmployee(
      new NextRequest('http://localhost/api/absence/work-shifts/user-1', {
        method: 'PUT',
        body: JSON.stringify({ templateId: 'template-1' }),
      }),
      { params: Promise.resolve({ profileId: 'user-1' }) }
    );

    expect(response.status).toBe(400);
  });
});
