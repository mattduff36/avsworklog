import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { JobCatalogueOption } from '@/types/job-catalogue';

const {
  mockCreateClient,
  mockCanEffectiveRoleAccessModule,
  mockListJobCatalogueOptions,
  mockLoadJobCatalogueRecords,
  mockLogServerError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCanEffectiveRoleAccessModule: vi.fn(),
  mockListJobCatalogueOptions: vi.fn(),
  mockLoadJobCatalogueRecords: vi.fn(),
  mockLogServerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/utils/rbac', () => ({
  canEffectiveRoleAccessModule: mockCanEffectiveRoleAccessModule,
}));

vi.mock('@/lib/server/job-catalogue', () => ({
  listJobCatalogueOptions: mockListJobCatalogueOptions,
  loadJobCatalogueRecords: mockLoadJobCatalogueRecords,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: mockLogServerError,
}));

const fullOption: JobCatalogueOption = {
  value: '40001-GH',
  label: '40001-GH',
  customerName: 'Omexom',
  quoteTitle: 'Cable repairs',
  source: 'live_quote',
  sourceId: 'quote-1',
  siteAddress: '1 Test Street, Test Town',
  addressValid: true,
  aliases: ['40001-GH-REV2'],
  isAmbiguous: false,
  blockReason: null,
};

describe('GET /api/job-codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'employee-1' } },
          error: null,
        }),
      },
    });
    mockLoadJobCatalogueRecords.mockResolvedValue([{ job_code: fullOption.value }]);
    mockListJobCatalogueOptions.mockReturnValue([fullOption]);
  });

  it('PDC-JOB-001 rejects unauthenticated requests without loading catalogue data', async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('No session'),
        }),
      },
    });

    const { GET } = await import('@/app/api/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/job-codes'));

    expect(response.status).toBe(401);
    expect(mockCanEffectiveRoleAccessModule).not.toHaveBeenCalled();
    expect(mockLoadJobCatalogueRecords).not.toHaveBeenCalled();
  });

  it('PDC-JOB-002 returns full catalogue metadata to an employee with Plant Daily Checks access', async () => {
    mockCanEffectiveRoleAccessModule.mockImplementation(async (moduleName: string) => (
      moduleName === 'plant-inspections'
    ));

    const { GET } = await import('@/app/api/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/job-codes'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockCanEffectiveRoleAccessModule.mock.calls).toEqual([
      ['daily-allocation'],
      ['plant-inspections'],
    ]);
    expect(payload.job_codes).toEqual([fullOption]);
    expect(payload.job_codes[0]).toMatchObject({
      sourceId: 'quote-1',
      siteAddress: '1 Test Street, Test Town',
      addressValid: true,
      isAmbiguous: false,
      blockReason: null,
    });
  });

  it('PDC-JOB-003 rejects users without an allowed consumer module', async () => {
    mockCanEffectiveRoleAccessModule.mockResolvedValue(false);

    const { GET } = await import('@/app/api/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/job-codes'));

    expect(response.status).toBe(403);
    expect(mockCanEffectiveRoleAccessModule.mock.calls).toEqual([
      ['daily-allocation'],
      ['plant-inspections'],
      ['timesheets'],
    ]);
    expect(mockLoadJobCatalogueRecords).not.toHaveBeenCalled();
  });

  it('PDC-JOB-004 logs catalogue failures and returns a generic error', async () => {
    mockCanEffectiveRoleAccessModule.mockResolvedValue(true);
    mockLoadJobCatalogueRecords.mockRejectedValue(new Error('database details'));

    const { GET } = await import('@/app/api/job-codes/route');
    const response = await GET(new NextRequest('http://localhost/api/job-codes'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Unable to load job codes right now.' });
    expect(JSON.stringify(payload)).not.toContain('database details');
    expect(mockLogServerError).toHaveBeenCalledOnce();
  });
});
