import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/server/absence-secondary-permissions');

import { GET as getMatrix, POST as addMatrixRow } from '@/app/api/absence/permissions/secondary/exceptions/route';
import {
  PATCH as patchMatrixCell,
  DELETE as deleteMatrixRow,
} from '@/app/api/absence/permissions/secondary/exceptions/[profileId]/route';

describe('absence secondary exceptions API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mockAuthedAdminContext() {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: 'admin-1' } }, error: null }),
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'admin-1',
      role_name: 'admin',
      is_super_admin: false,
      is_actual_super_admin: false,
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
  }

  it('returns forbidden when caller is not an admin', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      },
    } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'user-1',
      role_name: 'manager',
      is_super_admin: false,
      is_actual_super_admin: false,
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);

    const response = await getMatrix();
    expect(response.status).toBe(403);
  });

  it('returns matrix rows for admin users', async () => {
    await mockAuthedAdminContext();
    const { getAbsenceSecondaryExceptionMatrix } = await import('@/lib/server/absence-secondary-permissions');

    vi.mocked(getAbsenceSecondaryExceptionMatrix).mockResolvedValue({
      headers: {
        groups: [],
        orderedKeys: [],
      },
      rows: [],
    } as never);

    const response = await getMatrix();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(getAbsenceSecondaryExceptionMatrix).toHaveBeenCalledTimes(1);
  });

  it('validates add-user payload and updates matrix', async () => {
    await mockAuthedAdminContext();
    const { addAbsenceSecondaryExceptionRow, getAbsenceSecondaryExceptionMatrix } = await import(
      '@/lib/server/absence-secondary-permissions'
    );

    vi.mocked(addAbsenceSecondaryExceptionRow).mockResolvedValue(undefined);
    vi.mocked(getAbsenceSecondaryExceptionMatrix).mockResolvedValue({
      headers: { groups: [], orderedKeys: [] },
      rows: [],
    } as never);

    const badResponse = await addMatrixRow(
      new NextRequest('http://localhost/api/absence/permissions/secondary/exceptions', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    expect(badResponse.status).toBe(400);

    const okResponse = await addMatrixRow(
      new NextRequest('http://localhost/api/absence/permissions/secondary/exceptions', {
        method: 'POST',
        body: JSON.stringify({ profile_id: 'user-123' }),
      })
    );
    const payload = await okResponse.json();

    expect(okResponse.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(addAbsenceSecondaryExceptionRow).toHaveBeenCalledWith('user-123', 'admin-1');
  });

  it('patches and deletes rows for admin users', async () => {
    await mockAuthedAdminContext();
    const {
      upsertAbsenceSecondaryException,
      deleteAbsenceSecondaryExceptionRow,
      getAbsenceSecondaryExceptionMatrix,
    } = await import('@/lib/server/absence-secondary-permissions');

    vi.mocked(upsertAbsenceSecondaryException).mockResolvedValue(undefined);
    vi.mocked(deleteAbsenceSecondaryExceptionRow).mockResolvedValue(undefined);
    vi.mocked(getAbsenceSecondaryExceptionMatrix).mockResolvedValue({
      headers: { groups: [], orderedKeys: [] },
      rows: [],
    } as never);

    const patchResponse = await patchMatrixCell(
      new NextRequest('http://localhost/api/absence/permissions/secondary/exceptions/user-abc', {
        method: 'PATCH',
        body: JSON.stringify({ updates: { see_bookings_all: true } }),
      }),
      { params: Promise.resolve({ profileId: 'user-abc' }) }
    );
    expect(patchResponse.status).toBe(200);
    expect(upsertAbsenceSecondaryException).toHaveBeenCalledWith({
      profile_id: 'user-abc',
      updates: { see_bookings_all: true },
      actor_id: 'admin-1',
    });

    const deleteResponse = await deleteMatrixRow(
      new NextRequest('http://localhost/api/absence/permissions/secondary/exceptions/user-abc', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ profileId: 'user-abc' }) }
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleteAbsenceSecondaryExceptionRow).toHaveBeenCalledWith('user-abc');
  });
});

