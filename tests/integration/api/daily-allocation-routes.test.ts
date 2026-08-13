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
    const client = authClient('employee-1');
    const eq = vi.fn().mockReturnThis();
    client.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq,
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      in: vi.fn().mockReturnThis(),
    }));
    mockCreateClient.mockResolvedValue(client);

    const response = await GET(new NextRequest('http://localhost/api/daily-allocation/me'));
    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('profile_id', 'employee-1');
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
});
