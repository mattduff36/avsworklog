import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET, POST, DELETE } from '@/app/api/absence/shutdown/route';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/utils/permissions');
vi.mock('@/lib/server/absence-secondary-permissions');
vi.mock('@/lib/utils/view-as');
vi.mock('@/lib/utils/rbac');
vi.mock('@/lib/services/absence-bank-holiday-sync');

describe('Bulk Absence API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mockManagerAbsenceAccess() {
    const { createClient } = await import('@/lib/supabase/server');
    const { getProfileWithRole } = await import('@/lib/utils/permissions');
    const { getActorAbsenceSecondaryPermissions } = await import('@/lib/server/absence-secondary-permissions');
    const { getEffectiveRole } = await import('@/lib/utils/view-as');
    const { canEffectiveRoleAccessModule } = await import('@/lib/utils/rbac');

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'manager-1' } } }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(getProfileWithRole).mockResolvedValue({
      id: 'manager-1',
      role: { is_manager_admin: true },
    } as never);
    vi.mocked(canEffectiveRoleAccessModule).mockResolvedValue(true);
    vi.mocked(getEffectiveRole).mockResolvedValue({
      user_id: 'manager-1',
      role_name: 'manager',
      display_name: 'Manager',
      role_class: 'manager',
      is_manager_admin: true,
      is_super_admin: false,
      team_id: 'team-1',
      team_name: 'Transport',
    } as never);
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      effective: {
        see_manage_overview_all: true,
      },
    } as never);
  }

  it('returns 400 on POST when reasonId is missing', async () => {
    await mockManagerAbsenceAccess();

    const request = new Request('http://localhost/api/absence/shutdown', {
      method: 'POST',
      body: JSON.stringify({ startDate: '2026-12-24' }),
    });

    const response = await POST(request as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Reason');
  });

  it('passes union targeting payload to service on POST', async () => {
    const { bookBulkAbsence } = await import('@/lib/services/absence-bank-holiday-sync');
    await mockManagerAbsenceAccess();
    vi.mocked(bookBulkAbsence).mockResolvedValue({
      startDate: '2026-12-24',
      endDate: '2026-12-24',
      reasonId: 'reason-1',
      reasonName: 'Training',
      requestedDays: 1,
      requestedDaysMin: 1,
      requestedDaysMax: 1,
      totalEmployees: 10,
      targetedEmployees: 4,
      wouldCreate: 3,
      createdCount: 0,
      duplicateCount: 1,
      partialConflictEmployeeCount: 0,
      conflictingWorkingDaysSkipped: 0,
      createdSegmentsCount: 3,
      warningCount: 0,
      warnings: [],
      conflicts: [],
      batchId: null,
    });

    const request = new Request('http://localhost/api/absence/shutdown', {
      method: 'POST',
      body: JSON.stringify({
        reasonId: 'reason-1',
        startDate: '2026-12-24',
        applyToAll: false,
        roleIds: ['role-driver'],
        roleNames: ['driver'],
        employeeIds: ['emp-1'],
        confirm: false,
      }),
    });

    const response = await POST(request as NextRequest);
    expect(response.status).toBe(200);
    expect(bookBulkAbsence).toHaveBeenCalledWith(
      expect.objectContaining({
        actorProfileId: 'manager-1',
        reasonId: 'reason-1',
        applyToAll: false,
        roleIds: ['role-driver'],
        roleNames: ['driver'],
        employeeIds: ['emp-1'],
      })
    );
  });

  it('returns 200 with batches on GET for manager', async () => {
    const { listBulkAbsenceBatches } = await import('@/lib/services/absence-bank-holiday-sync');
    await mockManagerAbsenceAccess();
    vi.mocked(listBulkAbsenceBatches).mockResolvedValue([
      {
        id: 'batch-1',
        reasonId: 'reason-1',
        reasonName: 'Annual Leave',
        startDate: '2026-12-24',
        endDate: '2026-12-24',
        notes: null,
        applyToAll: true,
        roleNames: [],
        explicitProfileIds: [],
        targetedEmployees: 20,
        createdCount: 20,
        duplicateCount: 0,
        createdAt: new Date().toISOString(),
        createdByName: 'Manager',
      },
    ]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.batches).toHaveLength(1);
  });

  it('returns 400 on DELETE when batchId is missing', async () => {
    await mockManagerAbsenceAccess();

    const request = new Request('http://localhost/api/absence/shutdown', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });

    const response = await DELETE(request as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Batch');
  });
});
