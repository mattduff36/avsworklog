import { describe, expect, it } from 'vitest';
import { projectDailyAllocationJobs } from '@/lib/server/daily-allocation/board';
import type { JobCatalogueRecord } from '@/types/job-catalogue';
import type { DailyAllocationVisit } from '@/types/daily-allocation';

function record(partial: Partial<JobCatalogueRecord> & Pick<JobCatalogueRecord, 'source_id' | 'job_code'>): JobCatalogueRecord {
  const isActive = partial.is_active ?? true;
  const addressValid = partial.address_valid ?? true;
  return {
    source_type: 'live_quote',
    customer_name: 'Customer',
    title: 'Works',
    site_address: '1 Test Street',
    aliases: [],
    is_active: isActive,
    address_valid: addressValid,
    block_reason: partial.block_reason ?? (isActive ? (addressValid ? null : 'missing_site_address') : 'inactive_source'),
    ...partial,
  };
}

describe('projectDailyAllocationJobs', () => {
  it('includes every valid catalogue job even when the plan has no visits, and keeps invalid or missing-site jobs out', () => {
    const catalogue = [
      record({ source_id: 'quote-1', job_code: 'JOB-100' }),
      record({ source_id: 'quote-2', job_code: 'JOB-200', address_valid: false, site_address: '', block_reason: 'missing_site_address' }),
      record({ source_id: 'quote-3', job_code: 'JOB-300', is_active: false, block_reason: 'inactive_source' }),
    ];
    const orphanVisit: DailyAllocationVisit = {
      id: 'visit-orphan',
      plan_day_id: 'plan-1',
      work_date: '2026-08-14',
      owner_team_id: 'team-1',
      job_source_type: 'live_quote',
      job_source_id: 'quote-2',
      job_code: 'JOB-200',
      site_address: '',
      starts_at: '2026-08-14T08:00:00.000Z',
      ends_at: '2026-08-14T10:00:00.000Z',
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 1,
      updated_at: '2026-08-13T08:00:00.000Z',
    };

    const emptyPlan = projectDailyAllocationJobs(catalogue, [], [], []);
    expect(emptyPlan.map((job) => job.job_code)).toEqual(['JOB-100']);
    expect(emptyPlan[0]).toMatchObject({
      source_type: 'live_quote',
      source_id: 'quote-1',
      site_address: '1 Test Street',
    });

    const withInvalidVisit = projectDailyAllocationJobs(catalogue, [orphanVisit], [], []);
    expect(withInvalidVisit.map((job) => job.job_code)).toEqual(['JOB-100']);
  });
});
