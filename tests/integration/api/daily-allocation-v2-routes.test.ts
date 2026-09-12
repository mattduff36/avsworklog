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
    rpc: vi.fn().mockResolvedValue({ data: 'rpc-id', error: null }),
  };
}

function managerMocks() {
  mockGetEffectiveModuleAccessLevel.mockResolvedValue(4);
  mockCanEffectiveRoleUseModuleLevel.mockResolvedValue(true);
  mockGetEffectiveRole.mockResolvedValue({
    user_id: 'user-1',
    is_viewing_as: false,
    team_id: 'team-1',
    team_name: 'Civils',
  });
}

function conversionPayload(teamId = 'team-1') {
  return {
    request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    work_date: '2026-08-14',
    team_id: teamId,
    expected_source_fingerprint: 'a'.repeat(64),
    visits: [],
    labour_drafts: [],
    plant_drafts: [],
  };
}

describe('DA2-AUTH-001 daily allocation v2 API', () => {
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

  it('rejects employees from the range board and v2 mutations', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(2);
    mockCanEffectiveRoleUseModuleLevel.mockResolvedValue(false);

    const { GET } = await import('@/app/api/daily-allocation/board/route');
    const boardResponse = await GET(
      new NextRequest('http://localhost/api/daily-allocation/board?start=2026-08-14&end=2026-08-14')
    );
    expect(boardResponse.status).toBe(403);

    const { POST: convert } = await import('@/app/api/daily-allocation/convert/route');
    const convertResponse = await convert(new NextRequest('http://localhost/api/daily-allocation/convert', {
      method: 'POST',
      body: JSON.stringify({ work_date: '2026-08-14', team_id: 'team-1' }),
    }));
    expect(convertResponse.status).toBe(403);

    const { POST: createVisit } = await import('@/app/api/daily-allocation/visits/route');
    const visitResponse = await createVisit(new NextRequest('http://localhost/api/daily-allocation/visits', {
      method: 'POST',
      body: JSON.stringify({
        request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        plan_day_id: '11111111-1111-4111-8111-111111111111',
        expected_plan_version: 1,
        job_source_type: 'live_quote',
        job_source_id: '22222222-2222-4222-8222-222222222222',
        job_code: '60001-MD',
        starts_at: '2026-08-14T08:00:00+01:00',
        ends_at: '2026-08-14T12:00:00+01:00',
      }),
    }));
    expect(visitResponse.status).toBe(403);
  }, 10_000);

  it('rejects view-as and forged-team v2 mutations', async () => {
    mockGetEffectiveModuleAccessLevel.mockResolvedValue(4);
    mockCanEffectiveRoleUseModuleLevel.mockResolvedValue(true);
    mockGetEffectiveRole.mockResolvedValue({
      user_id: 'user-1',
      is_viewing_as: true,
      team_id: 'team-1',
      team_name: 'Civils',
    });

    const { POST: convert } = await import('@/app/api/daily-allocation/convert/route');
    const viewAsResponse = await convert(new NextRequest('http://localhost/api/daily-allocation/convert', {
      method: 'POST',
      body: JSON.stringify({ work_date: '2026-08-14', team_id: 'team-2' }),
    }));
    expect(viewAsResponse.status).toBe(403);
    expect(await viewAsResponse.json()).toMatchObject({ code: 'VIEW_AS' });

    managerMocks();
    const client = authClient();
    client.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Not allowed to convert this daily allocation plan' },
    });
    mockCreateClient.mockResolvedValue(client);

    const forgedResponse = await convert(new NextRequest('http://localhost/api/daily-allocation/convert', {
      method: 'POST',
      body: JSON.stringify(conversionPayload('forged-team')),
    }));
    expect(forgedResponse.status).toBe(403);
    expect(await forgedResponse.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(client.rpc).toHaveBeenCalledWith(
      'convert_daily_allocation_plan_day_v2',
      expect.objectContaining({
        p_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        p_team_id: 'forged-team',
        p_work_date: '2026-08-14',
      })
    );
  });
});

function convertPlanDayClient(result: Record<string, unknown> | null, error: { message: string } | null = null) {
  const client = authClient();
  client.rpc = vi.fn().mockResolvedValue({ data: result, error });
  return client;
}

describe('guided conversion returns authoritative entities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMocks();
  });

  it('returns the exact authoritative conversion RPC result', async () => {
    const result = {
      plan_day_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      work_date: '2026-08-14',
      team_id: 'team-1',
      plan_version: 1,
      source_fingerprint: 'a'.repeat(64),
      visits: [],
      labour_assignments: [],
      plant_assignments: [],
    };
    const client = convertPlanDayClient(result);
    mockCreateClient.mockResolvedValue(client);

    const { POST: convert } = await import('@/app/api/daily-allocation/convert/route');
    const response = await convert(new NextRequest('http://localhost/api/daily-allocation/convert', {
      method: 'POST',
      body: JSON.stringify(conversionPayload()),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(client.rpc).toHaveBeenCalledWith(
      'convert_daily_allocation_plan_day_v2',
      expect.objectContaining({
        p_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        p_work_date: '2026-08-14',
        p_team_id: 'team-1',
        p_expected_source_fingerprint: 'a'.repeat(64),
        p_visits: [],
        p_labour_drafts: [],
        p_plant_drafts: [],
      })
    );
  });

  it('returns a server-generated conversion source fingerprint and row versions', async () => {
    const source = {
      work_date: '2026-08-14',
      team_id: 'team-1',
      source_fingerprint: 'a'.repeat(64),
      labour_drafts: [{ id: 'draft-1', row_version: 3 }],
      plant_drafts: [],
    };
    const client = convertPlanDayClient(source);
    mockCreateClient.mockResolvedValue(client);

    const { GET } = await import('@/app/api/daily-allocation/convert/route');
    const response = await GET(new NextRequest(
      'http://localhost/api/daily-allocation/convert?work_date=2026-08-14&team_id=team-1'
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(source);
    expect(client.rpc).toHaveBeenCalledWith(
      'get_daily_allocation_conversion_source_v2',
      { p_work_date: '2026-08-14', p_team_id: 'team-1' }
    );
  });

  it('rejects stale source fingerprints with 409', async () => {
    mockCreateClient.mockResolvedValue(
      convertPlanDayClient(null, { message: 'SOURCE_FINGERPRINT_MISMATCH' })
    );
    const { POST: convert } = await import('@/app/api/daily-allocation/convert/route');
    const response = await convert(new NextRequest('http://localhost/api/daily-allocation/convert', {
      method: 'POST',
      body: JSON.stringify(conversionPayload()),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SOURCE_FINGERPRINT_MISMATCH' });
  });
});

describe('DA2-CONC-001 API stale and conflict mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMocks();
  });

  it('maps stale plan/entity versions and overlap conflicts to 409', async () => {
    const stalePlanClient = authClient();
    stalePlanClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'STALE_PLAN_VERSION' },
    });
    mockCreateClient.mockResolvedValue(stalePlanClient);
    const { POST: createVisit } = await import('@/app/api/daily-allocation/visits/route');
    const stalePlan = await createVisit(new NextRequest('http://localhost/api/daily-allocation/visits', {
      method: 'POST',
      body: JSON.stringify({
        request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        plan_day_id: '11111111-1111-4111-8111-111111111111',
        expected_plan_version: 1,
        job_source_type: 'live_quote',
        job_source_id: '22222222-2222-4222-8222-222222222222',
        job_code: '60001-MD',
        starts_at: '2026-08-14T08:00:00+01:00',
        ends_at: '2026-08-14T12:00:00+01:00',
      }),
    }));
    expect(stalePlan.status).toBe(409);
    expect(await stalePlan.json()).toMatchObject({ code: 'STALE_PLAN_VERSION' });

    const staleEntityClient = authClient();
    staleEntityClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'STALE_ENTITY_VERSION' },
    });
    mockCreateClient.mockResolvedValue(staleEntityClient);
    const { PATCH } = await import('@/app/api/daily-allocation/visits/[id]/route');
    const staleEntity = await PATCH(
      new NextRequest('http://localhost/api/daily-allocation/visits/33333333-3333-4333-8333-333333333333', {
        method: 'PATCH',
        body: JSON.stringify({
          request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          plan_day_id: '11111111-1111-4111-8111-111111111111',
          expected_plan_version: 2,
          expected_row_version: 1,
          job_source_type: 'live_quote',
          job_source_id: '22222222-2222-4222-8222-222222222222',
          job_code: '60001-MD',
          starts_at: '2026-08-14T08:00:00+01:00',
          ends_at: '2026-08-14T12:00:00+01:00',
        }),
      }),
      { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) }
    );
    expect(staleEntity.status).toBe(409);
    expect(await staleEntity.json()).toMatchObject({ code: 'STALE_ENTITY_VERSION' });

    const overlapClient = authClient();
    overlapClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' },
    });
    mockCreateClient.mockResolvedValue(overlapClient);
    const { POST: assignLabour } = await import('@/app/api/daily-allocation/assignments/labour/route');
    const overlap = await assignLabour(new NextRequest('http://localhost/api/daily-allocation/assignments/labour', {
      method: 'POST',
      body: JSON.stringify({
        request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        visit_id: '33333333-3333-4333-8333-333333333333',
        profile_id: '44444444-4444-4444-8444-444444444444',
        expected_plan_version: 3,
      }),
    }));
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toMatchObject({ code: 'OVERLAP' });

    const plantClient = authClient();
    plantClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'PLANT_JOB_CONFLICT' },
    });
    mockCreateClient.mockResolvedValue(plantClient);
    const { POST: assignPlant } = await import('@/app/api/daily-allocation/assignments/plant/route');
    const plantConflict = await assignPlant(new NextRequest('http://localhost/api/daily-allocation/assignments/plant', {
      method: 'POST',
      body: JSON.stringify({
        request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        visit_id: '33333333-3333-4333-8333-333333333333',
        expected_plan_version: 3,
        plant_kind: 'registered',
        plant_id: '55555555-5555-4555-8555-555555555555',
      }),
    }));
    expect(plantConflict.status).toBe(409);
    expect(await plantConflict.json()).toMatchObject({ code: 'PLANT_JOB_CONFLICT' });
  });
});

describe('DA2-PUB-001/002 publish payload, idempotency, and confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMocks();
  });

  it('keeps v1 publish payloads on the insert path', async () => {
    const client = authClient();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'pub-1',
        work_date: '2026-08-14',
        revision_no: 1,
        published_at: '2026-08-13T12:00:00Z',
        published_by: 'user-1',
      },
      error: null,
    });
    client.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    }));
    mockCreateClient.mockResolvedValue(client);

    const { POST } = await import('@/app/api/daily-allocation/publish/route');
    const response = await POST(new NextRequest('http://localhost/api/daily-allocation/publish', {
      method: 'POST',
      body: JSON.stringify({ work_date: '2026-08-14', idempotency_key: 'v1-key' }),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { publication?: { id: string }; snapshot_version?: number };
    expect(payload.snapshot_version).toBe(1);
    expect(payload.publication?.id).toBe('pub-1');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('calls publish_daily_allocation_plan_v2 with version, idempotency, and confirmation', async () => {
    const client = authClient();
    client.rpc = vi.fn().mockResolvedValue({
      data: { publication_id: 'pub-v2', snapshot_version: 2 },
      error: null,
    });
    mockCreateClient.mockResolvedValue(client);

    const { POST } = await import('@/app/api/daily-allocation/publish/route');
    const response = await POST(new NextRequest('http://localhost/api/daily-allocation/publish', {
      method: 'POST',
      body: JSON.stringify({
        snapshot_version: 2,
        request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        plan_day_id: '11111111-1111-4111-8111-111111111111',
        expected_plan_version: 4,
        idempotency_key: 'v2-key',
        confirm_unallocated: true,
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      publication_id: 'pub-v2',
      snapshot_version: 2,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'publish_daily_allocation_plan_v2',
      {
        p_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        p_plan_day_id: '11111111-1111-4111-8111-111111111111',
        p_expected_plan_version: 4,
        p_idempotency_key: 'v2-key',
        p_confirm_unallocated: true,
      }
    );
  });

  it('returns 409 for unallocated confirmation and idempotency conflicts', async () => {
    const confirmClient = authClient();
    confirmClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'CONFIRM_UNALLOCATED_REQUIRED' },
    });
    mockCreateClient.mockResolvedValue(confirmClient);
    const { POST } = await import('@/app/api/daily-allocation/publish/route');
    const confirmResponse = await POST(new NextRequest('http://localhost/api/daily-allocation/publish', {
      method: 'POST',
      body: JSON.stringify({
        snapshot_version: 2,
        request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        plan_day_id: '11111111-1111-4111-8111-111111111111',
        expected_plan_version: 4,
        idempotency_key: 'v2-key',
      }),
    }));
    expect(confirmResponse.status).toBe(409);
    expect(await confirmResponse.json()).toMatchObject({ code: 'CONFIRM_UNALLOCATED_REQUIRED' });
    expect(confirmClient.rpc).toHaveBeenCalledWith(
      'publish_daily_allocation_plan_v2',
      expect.objectContaining({ p_confirm_unallocated: false })
    );

    const idemClient = authClient();
    idemClient.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'IDEMPOTENCY_CONFLICT' },
    });
    mockCreateClient.mockResolvedValue(idemClient);
    const idemResponse = await POST(new NextRequest('http://localhost/api/daily-allocation/publish', {
      method: 'POST',
      body: JSON.stringify({
        snapshot_version: 2,
        request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        plan_day_id: '11111111-1111-4111-8111-111111111111',
        expected_plan_version: 4,
        idempotency_key: 'used-key',
        confirm_unallocated: true,
      }),
    }));
    expect(idemResponse.status).toBe(409);
    expect(await idemResponse.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('daily allocation board range API validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMocks();
    mockCreateClient.mockResolvedValue(authClient());
  });

  it('rejects an eight-day board range with 400', async () => {
    const { GET } = await import('@/app/api/daily-allocation/board/route');
    const response = await GET(
      new NextRequest('http://localhost/api/daily-allocation/board?start=2026-08-14&end=2026-08-21')
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION' });
  });
});

describe('daily allocation v2 runtime and cross-plan move API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerMocks();
  });

  it('returns the runtime gate and treats a missing RPC as disabled', async () => {
    const enabled = authClient();
    enabled.rpc = vi.fn().mockResolvedValue({
      data: [{ board_enabled: true, writes_enabled: true }],
      error: null,
    });
    mockCreateClient.mockResolvedValue(enabled);
    const { GET } = await import('@/app/api/daily-allocation/runtime/route');
    const enabledResponse = await GET(new NextRequest('http://localhost/api/daily-allocation/runtime'));
    expect(enabledResponse.status).toBe(200);
    expect(await enabledResponse.json()).toEqual({ board_enabled: true, writes_enabled: true });
    expect(enabled.rpc).toHaveBeenCalledWith('get_daily_allocation_v2_runtime');

    const missing = authClient();
    missing.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
    });
    mockCreateClient.mockResolvedValue(missing);
    const missingResponse = await GET(new NextRequest('http://localhost/api/daily-allocation/runtime'));
    expect(missingResponse.status).toBe(200);
    expect(await missingResponse.json()).toEqual({ board_enabled: false, writes_enabled: false });
  });

  it('posts the dedicated move RPC and maps stale plan versions to 409', async () => {
    const client = authClient();
    client.rpc = vi.fn().mockResolvedValue({
      data: {
        visit_id: '33333333-3333-4333-8333-333333333333',
        plan_day_id: '22222222-2222-4222-8222-222222222222',
        plan_version: 4,
        source_plan_day_id: '11111111-1111-4111-8111-111111111111',
        source_plan_version: 3,
        target_plan_day_id: '22222222-2222-4222-8222-222222222222',
        target_plan_version: 4,
        visit: {
          id: '33333333-3333-4333-8333-333333333333',
          plan_day_id: '22222222-2222-4222-8222-222222222222',
          work_date: '2026-08-15',
          owner_team_id: 'team-1',
          job_source_type: 'live_quote',
          job_source_id: '22222222-2222-4222-8222-222222222222',
          job_code: '60001-MD',
          site_address: '12 Site Road',
          starts_at: '2026-08-15T08:00:00+01:00',
          ends_at: '2026-08-15T12:00:00+01:00',
          meeting_point: null,
          meet_person: null,
          notes: null,
          row_version: 2,
          updated_at: '2026-08-14T12:00:00Z',
        },
      },
      error: null,
    });
    mockCreateClient.mockResolvedValue(client);
    const { POST } = await import('@/app/api/daily-allocation/visits/[id]/move/route');
    const response = await POST(
      new NextRequest('http://localhost/api/daily-allocation/visits/33333333-3333-4333-8333-333333333333/move', {
        method: 'POST',
        body: JSON.stringify({
          request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          target_plan_day_id: '22222222-2222-4222-8222-222222222222',
          expected_source_plan_version: 2,
          expected_target_plan_version: 3,
          expected_row_version: 1,
          starts_at: '2026-08-15T08:00:00+01:00',
          ends_at: '2026-08-15T12:00:00+01:00',
        }),
      }),
      { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      visit_id: '33333333-3333-4333-8333-333333333333',
      source_plan_version: 3,
      target_plan_version: 4,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'move_daily_allocation_visit_v2',
      expect.objectContaining({
        p_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        p_visit_id: '33333333-3333-4333-8333-333333333333',
        p_target_plan_day_id: '22222222-2222-4222-8222-222222222222',
        p_expected_source_plan_version: 2,
        p_expected_target_plan_version: 3,
      })
    );

    const stale = authClient();
    stale.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'STALE_PLAN_VERSION' },
    });
    mockCreateClient.mockResolvedValue(stale);
    const staleResponse = await POST(
      new NextRequest('http://localhost/api/daily-allocation/visits/33333333-3333-4333-8333-333333333333/move', {
        method: 'POST',
        body: JSON.stringify({
          request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          target_plan_day_id: '22222222-2222-4222-8222-222222222222',
          expected_source_plan_version: 9,
          expected_target_plan_version: 3,
          expected_row_version: 1,
          starts_at: '2026-08-15T08:00:00+01:00',
          ends_at: '2026-08-15T12:00:00+01:00',
        }),
      }),
      { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) }
    );
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toMatchObject({ code: 'STALE_PLAN_VERSION' });
  });
});
