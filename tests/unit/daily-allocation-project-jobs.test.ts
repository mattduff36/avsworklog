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
  it('allows missing addresses in drafts, prioritizes scheduled jobs and excludes inactive identities', () => {
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
    expect(emptyPlan.map((job) => job.job_code)).toEqual(['JOB-100', 'JOB-200']);
    expect(emptyPlan[0]).toMatchObject({
      source_type: 'live_quote',
      source_id: 'quote-1',
      site_address: '1 Test Street',
    });

    const withInvalidVisit = projectDailyAllocationJobs(catalogue, [orphanVisit], [], []);
    expect(withInvalidVisit.map((job) => job.job_code)).toEqual(['JOB-200', 'JOB-100']);
    expect(withInvalidVisit[0]).toMatchObject({ site_address: '', address_valid: false });
  });

  it('caps recent activity at 80 and searches canonical codes, aliases, customers and titles beyond that cap', () => {
    const catalogue = Array.from({ length: 140 }, (_, index) => record({
      source_id: `quote-${index}`, job_code: `JOB-${index.toString().padStart(3, '0')}`,
      last_activity_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));
    catalogue[0] = record({
      ...catalogue[0], job_code: '50075-LC', aliases: ['OLD-50075'], site_address: null,
      address_valid: false, customer_name: 'Unique customer', title: 'Distinctive works',
    });
    const defaults = projectDailyAllocationJobs(catalogue);
    expect(defaults).toHaveLength(80);
    expect(defaults[0].source_id).toBe('quote-139');
    expect(defaults.some((job) => job.job_code === '50075-LC')).toBe(false);
    for (const query of ['50075', 'old-50075', 'unique customer', 'distinctive works']) {
      expect(projectDailyAllocationJobs(catalogue, [], [], [], query)).toEqual([
        expect.objectContaining({ job_code: '50075-LC', address_valid: false, site_address: null }),
      ]);
    }
  });

  it('rejects collisions on aliases even when canonical codes and explicit identities differ', () => {
    const catalogue = [
      record({ source_id: 'a', job_code: 'JOB-A', aliases: ['OLD-A'] }),
      record({ source_id: 'b', job_code: 'OLD-A' }),
      record({ source_id: 'c', job_code: 'JOB-C' }),
    ];
    expect(projectDailyAllocationJobs(catalogue).map((job) => job.job_code)).toEqual(['JOB-C']);
  });

  it('keeps all scheduled job metadata on the board without including the unscheduled catalogue', () => {
    const records = Array.from({ length: 150 }, (_, index) => record({
      source_id: `job-${index}`, job_code: `JOB-${index}`,
    }));
    const visits = records.slice(0, 120).map((job) => ({
      job_source_type: job.source_type, job_source_id: job.source_id,
      job_code: job.job_code,
    }));
    const jobs = projectDailyAllocationJobs(records, visits, [], [], '', true);
    expect(jobs).toHaveLength(120);
    expect(jobs[119]).toMatchObject({ source_id: 'job-119', title: 'Works', customer_name: 'Customer' });
    expect(jobs.some((job) => job.source_id === 'job-120')).toBe(false);
  });
});
