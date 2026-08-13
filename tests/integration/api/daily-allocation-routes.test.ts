import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockGetEffectiveRole,
  mockGetEffectiveModuleAccessLevel,
  mockCanEffectiveRoleUseModuleLevel,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetEffectiveRole: vi.fn(),
  mockGetEffectiveModuleAccessLevel: vi.fn(),
  mockCanEffectiveRoleUseModuleLevel: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: mockGetEffectiveRole,
}));

vi.mock('@/lib/utils/rbac', () => ({
  getEffectiveModuleAccessLevel: mockGetEffectiveModuleAccessLevel,
  canEffectiveRoleUseModuleLevel: mockCanEffectiveRoleUseModuleLevel,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

function authClient(userId = 'user-1') {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    })),
    rpc: vi.fn().mockResolvedValue({ data: ['user-2'], error: null }),
  };
}

function issuedReadClient(userId: string) {
  const client = authClient(userId);
  const eq = vi.fn().mockReturnThis();
  client.from = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq,
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  }));
  return { client, eq };
}

describe('daily allocation API auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(authClient());
    mockGetEffectiveRole.mockResolvedValue({
      user_id: 'user-1',
      is_viewing_as: false,
      team_id: 'team-1',
      team_name: 'Civils',
    });
  });

  it('AUTH-001 isolates employee self-view from other profiles', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(2);
    mockCanEffectiveRoleUseModuleLevel.mockImplementation(async (_module: string, level: number) => level <= 2);
    const { GET } = await import('@/app/api/daily-allocation/me/route');
    const { client, eq } = issuedReadClient('employee-1');
    mockCreateClient.mockResolvedValue(client);

    const response = await GET(new NextRequest('http://localhost/api/daily-allocation/me'));
    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('profile_id', 'employee-1');
  });

  it('PERM-SERVER-01 resolves Level 2 self, Level 4 manager, and Level 5 admin access', async () => {
    const { getDailyAllocationContext } = await import('@/lib/server/daily-allocation');

    mockGetEffectiveModuleAccessLevel.mockResolvedValueOnce(2);
    await expect(getDailyAllocationContext()).resolves.toMatchObject({
      access_level: 2,
      is_manager: false,
      is_admin: false,
    });

    mockGetEffectiveModuleAccessLevel.mockResolvedValueOnce(4);
    await expect(getDailyAllocationContext()).resolves.toMatchObject({
      access_level: 4,
      is_manager: true,
      is_admin: false,
    });

    mockGetEffectiveModuleAccessLevel.mockResolvedValueOnce(5);
    await expect(getDailyAllocationContext()).resolves.toMatchObject({
      access_level: 5,
      is_manager: true,
      is_admin: true,
    });
  });

  it('AUTH-002 rejects employees from the manager board', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(2);
    const { GET } = await import('@/app/api/daily-allocation/board/route');
    const response = await GET(new NextRequest('http://localhost/api/daily-allocation/board?date=2026-08-14'));
    expect(response.status).toBe(403);
  });

  it('AUTH-003 rejects view-as mutations, employee writes, and forged profile writes at the mutation gate', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(4);
    mockCanEffectiveRoleUseModuleLevel.mockResolvedValue(true);
    mockGetEffectiveRole.mockResolvedValue({
      user_id: 'user-1',
      is_viewing_as: true,
      team_id: 'team-1',
      team_name: 'Civils',
    });
    const { PUT } = await import('@/app/api/daily-allocation/labour/route');
    const viewAsResponse = await PUT(new NextRequest('http://localhost/api/daily-allocation/labour', {
      method: 'PUT',
      body: JSON.stringify({
        work_date: '2026-08-14',
        profile_id: 'forged-profile',
        job_code: '60001-MD',
      }),
    }));
    expect(viewAsResponse.status).toBe(403);
    const viewAsPayload = await viewAsResponse.json() as { code?: string };
    expect(viewAsPayload.code).toBe('VIEW_AS');

    mockGetEffectiveRole.mockResolvedValue({
      user_id: 'employee-1',
      is_viewing_as: false,
      team_id: 'team-1',
      team_name: 'Civils',
    });
    mockCanEffectiveRoleUseModuleLevel.mockResolvedValue(false);
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(2);
    const employeeResponse = await PUT(new NextRequest('http://localhost/api/daily-allocation/labour', {
      method: 'PUT',
      body: JSON.stringify({
        work_date: '2026-08-14',
        profile_id: 'forged-profile',
        job_code: '60001-MD',
      }),
    }));
    expect(employeeResponse.status).toBe(403);
  });

  it('ROLL-001 hides the API when module access is disabled', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(0);
    const { GET } = await import('@/app/api/daily-allocation/context/route');
    const response = await GET(new NextRequest('http://localhost/api/daily-allocation/context'));
    expect(response.status).toBe(403);
  });

  it('DRAFT-001 rejects stale labour versions', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(4);
    mockCanEffectiveRoleUseModuleLevel.mockResolvedValue(true);
    const client = authClient();
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'draft-1', row_version: 3 }, error: null });
    client.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
    }));
    mockCreateClient.mockResolvedValue(client);

    const { PUT } = await import('@/app/api/daily-allocation/labour/route');
    const response = await PUT(new NextRequest('http://localhost/api/daily-allocation/labour', {
      method: 'PUT',
      body: JSON.stringify({
        work_date: '2026-08-14',
        profile_id: 'user-2',
        job_code: '60001-MD',
        row_version: 2,
      }),
    }));
    expect(response.status).toBe(409);
  });

  it('keeps v1 labour draft writes on the drafts table before v2 cutover', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(4);
    mockCanEffectiveRoleUseModuleLevel.mockResolvedValue(true);
    const client = authClient();
    const draftRow = {
      id: 'draft-1',
      work_date: '2026-08-14',
      profile_id: 'user-2',
      job_source_type: 'project_number',
      job_source_id: '44444444-4444-4444-8444-444444444444',
      job_code: '60001-MD',
      site_address: '12 Site Road',
      start_time: '08:00',
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 1,
      updated_at: '2026-08-13T12:00:00Z',
    };
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: draftRow, error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    };
    client.from = vi.fn(() => query);
    mockCreateClient.mockResolvedValue(client);

    const { PUT } = await import('@/app/api/daily-allocation/labour/route');
    const response = await PUT(new NextRequest('http://localhost/api/daily-allocation/labour', {
      method: 'PUT',
      body: JSON.stringify({
        work_date: '2026-08-14',
        profile_id: 'user-2',
        job_source_type: 'project_number',
        job_source_id: '44444444-4444-4444-8444-444444444444',
        job_code: '60001-MD',
        start_time: '08:00',
      }),
    }));
    expect(response.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith('daily_labour_allocation_drafts');
    expect(client.rpc).not.toHaveBeenCalled();
    expect(query.insert).toHaveBeenCalled();
  });
});

describe('DA2-COMPAT-001 issued and reconciliation reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(authClient());
    mockGetEffectiveRole.mockResolvedValue({
      user_id: 'employee-1',
      is_viewing_as: false,
      team_id: 'team-1',
      team_name: 'Civils',
    });
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(2);
    mockCanEffectiveRoleUseModuleLevel.mockImplementation(async (_module: string, level: number) => level <= 2);
  });

  it('queries only the signed-in employee itinerary and accepts a publication selector', async () => {
    const { GET } = await import('@/app/api/daily-allocation/me/route');
    const { client, eq } = issuedReadClient('employee-1');
    mockCreateClient.mockResolvedValue(client);

    const response = await GET(new NextRequest('http://localhost/api/daily-allocation/me?publication=pub-v2'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ current: null, history: [] });
    expect(eq).toHaveBeenCalledWith('profile_id', 'employee-1');
    expect(eq).not.toHaveBeenCalledWith('profile_id', 'user-1');
  });

  it('rejects employees from plant reconciliation and keeps manager history metadata available', async () => {
    const { GET: getReconciliation } = await import('@/app/api/daily-allocation/reconciliation/route');
    const employeeResponse = await getReconciliation(
      new NextRequest('http://localhost/api/daily-allocation/reconciliation?date=2026-08-14')
    );
    expect(employeeResponse.status).toBe(403);

    const { GET: getHistory } = await import('@/app/api/daily-allocation/history/route');
    const { client, eq } = issuedReadClient('employee-1');
    mockCreateClient.mockResolvedValue(client);
    const historyResponse = await getHistory(new NextRequest('http://localhost/api/daily-allocation/history'));
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toEqual({ publications: [] });
    expect(eq).toHaveBeenCalledWith('profile_id', 'employee-1');
  });
});
