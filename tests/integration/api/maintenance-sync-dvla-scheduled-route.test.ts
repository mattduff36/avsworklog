import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const createClientMock = vi.hoisted(() => vi.fn());
const createDVLAApiServiceMock = vi.hoisted(() => vi.fn());
const createMotHistoryServiceMock = vi.hoisted(() => vi.fn());
const isRoadEligibleRegistrationMock = vi.hoisted(() => vi.fn((registration: string) => Boolean(registration)));
const runFleetDvlaSyncMock = vi.hoisted(() => vi.fn());
const logServerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}));

vi.mock('@/lib/services/dvla-api', () => ({
  createDVLAApiService: createDVLAApiServiceMock,
}));

vi.mock('@/lib/services/mot-history-api', () => ({
  createMotHistoryService: createMotHistoryServiceMock,
}));

vi.mock('@/lib/services/fleet-dvla-sync', () => ({
  isRoadEligibleRegistration: isRoadEligibleRegistrationMock,
  runFleetDvlaSync: runFleetDvlaSyncMock,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: logServerErrorMock,
}));

import { GET, POST } from '@/app/api/maintenance/sync-dvla-scheduled/route';

function createSupabaseMock() {
  const activeRows = {
    vans: [{ id: 'van-1', reg_number: 'VN11 AAA' }],
    hgvs: [{ id: 'hgv-1', reg_number: 'HG11 BBB' }],
    plant: [{ id: 'plant-1', reg_number: 'PL11 CCC' }],
  };

  const maintenanceRows = [
    { van_id: 'van-1', hgv_id: null, plant_id: null, last_dvla_sync: null },
    { van_id: null, hgv_id: 'hgv-1', plant_id: null, last_dvla_sync: null },
    { van_id: null, hgv_id: null, plant_id: 'plant-1', last_dvla_sync: null },
  ];

  return {
    from: vi.fn((tableName: string) => {
      if (tableName === 'vehicle_maintenance') {
        return {
          select: vi.fn().mockResolvedValue({ data: maintenanceRows, error: null }),
        };
      }

      const rows = activeRows[tableName as keyof typeof activeRows];
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: rows ?? [], error: null }),
        }),
      };
    }),
  };
}

describe('/api/maintenance/sync-dvla-scheduled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    createDVLAApiServiceMock.mockReturnValue({ service: 'dvla' });
    createMotHistoryServiceMock.mockReturnValue({ service: 'mot' });
    runFleetDvlaSyncMock.mockResolvedValue({
      total: 3,
      successful: 3,
      failed: 0,
      results: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects unauthorized GET requests', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/maintenance/sync-dvla-scheduled', {
        method: 'GET',
      })
    );

    expect(response.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('syncs due van, hgv, and plant assets from GET cron requests', async () => {
    const supabase = createSupabaseMock();
    createClientMock.mockResolvedValue(supabase);

    const response = await GET(
      new NextRequest('http://localhost/api/maintenance/sync-dvla-scheduled?limit=10', {
        method: 'GET',
        headers: {
          authorization: 'Bearer cron-secret',
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(runFleetDvlaSyncMock).toHaveBeenCalledTimes(1);
    expect(runFleetDvlaSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        dvlaService: { service: 'dvla' },
        motService: { service: 'mot' },
        triggerType: 'automatic',
        triggeredBy: null,
        logPrefix: '[CRON] ',
        delayMsBetweenRequests: 1000,
        targets: [
          { assetType: 'van', assetId: 'van-1', registrationNumber: 'VN11 AAA' },
          { assetType: 'hgv', assetId: 'hgv-1', registrationNumber: 'HG11 BBB' },
          { assetType: 'plant', assetId: 'plant-1', registrationNumber: 'PL11 CCC' },
        ],
      })
    );
    expect(payload).toMatchObject({
      success: true,
      total: 3,
      due: 3,
      synced: 3,
      successful: 3,
      failed: 0,
      skipped: 0,
      deferred: 0,
    });
  });

  it('keeps POST support for manual cron replays', async () => {
    const supabase = createSupabaseMock();
    createClientMock.mockResolvedValue(supabase);

    const response = await POST(
      new NextRequest('http://localhost/api/maintenance/sync-dvla-scheduled?limit=1', {
        method: 'POST',
        headers: {
          authorization: 'Bearer cron-secret',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(runFleetDvlaSyncMock).toHaveBeenCalledTimes(1);
  });
});
