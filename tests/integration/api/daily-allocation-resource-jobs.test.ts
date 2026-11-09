import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { JobCatalogueRecord } from '@/types/job-catalogue';

const mocks = vi.hoisted(() => ({ catalogue: vi.fn(), manager: vi.fn() }));
vi.mock('@/lib/server/job-catalogue', () => ({ loadJobCatalogueRecords: mocks.catalogue }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/server/daily-allocation/auth', async (original) => {
  const actual = await original<typeof import('@/lib/server/daily-allocation/auth')>();
  return {
    ...actual,
    requireDailyAllocationManagerContext: mocks.manager,
    requireDailyAllocationUser: async () => ({
      supabase: { from: () => ({
        select() { return this; },
        gte() { return this; },
        lte() { return Promise.resolve({ data: [{
          job_source_type: 'project_number', job_source_id: 'job-0', job_code: '50075-LC', site_address: '',
        }], error: null }); },
      }) },
    }),
  };
});

describe('bounded canonical job resource response', () => {
  it('returns 80 prioritized identities and searches beyond the cap using the shared server cache', async () => {
    const records: JobCatalogueRecord[] = Array.from({ length: 150 }, (_, index) => ({
      source_type: 'project_number', source_id: `job-${index}`, job_code: `JOB-${index}`,
      customer_name: index === 1 ? 'Outside cap customer' : 'Customer', title: 'Works',
      site_address: '1 Site Road', address_valid: true, is_active: true, block_reason: null,
      aliases: index === 1 ? ['OLD-ALIAS'] : [],
      last_activity_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));
    records[0] = { ...records[0], job_code: '50075-LC', address_valid: false, site_address: null, block_reason: 'missing_site_address' };
    mocks.catalogue.mockResolvedValue(records);
    mocks.manager.mockResolvedValue({});
    const { GET } = await import('@/app/api/daily-allocation/resources/jobs/route');
    const request = (q = '') => GET(new NextRequest(
      `http://localhost/api/daily-allocation/resources/jobs?start=2026-11-09&end=2026-11-09&q=${encodeURIComponent(q)}`
    ));
    const defaults = await request();
    expect(defaults.status).toBe(200);
    const payload = await defaults.json();
    expect(payload.limit).toBe(80);
    expect(payload.jobs).toHaveLength(80);
    expect(payload.jobs[0]).toMatchObject({ job_code: '50075-LC', address_valid: false, site_address: null });
    expect(payload.jobs[1].source_id).toBe('job-149');
    expect(payload.jobs.some((job: { source_id: string }) => job.source_id === 'job-1')).toBe(false);
    for (const term of ['OLD-ALIAS', 'Outside cap customer', 'JOB-1']) {
      const response = await request(term);
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.jobs.length).toBeLessThanOrEqual(80);
      expect(result.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ source_id: 'job-1' })]));
    }
    expect(mocks.catalogue).toHaveBeenCalledTimes(1);
  });
});
