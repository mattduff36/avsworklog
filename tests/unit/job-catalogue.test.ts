import { describe, expect, it } from 'vitest';
import { getJobCatalogueBlockReason, isReliableSiteAddress } from '@/lib/utils/job-catalogue';
import { listJobCatalogueOptions, resolveJobCatalogueRecord } from '@/lib/server/job-catalogue';
import type { JobCatalogueRecord } from '@/types/job-catalogue';

function record(partial: Partial<JobCatalogueRecord> & Pick<JobCatalogueRecord, 'source_type' | 'source_id' | 'job_code'>): JobCatalogueRecord {
  const siteAddress = partial.site_address ?? '12 High Street, Southwell';
  const isActive = partial.is_active ?? true;
  const addressValid = partial.address_valid ?? isReliableSiteAddress(siteAddress);
  return {
    customer_name: partial.customer_name || 'Customer',
    title: partial.title || 'Title',
    aliases: partial.aliases || [],
    source_type: partial.source_type,
    source_id: partial.source_id,
    job_code: partial.job_code,
    site_address: siteAddress,
    address_valid: addressValid,
    is_active: isActive,
    block_reason: partial.block_reason ?? getJobCatalogueBlockReason({ is_active: isActive, address_valid: addressValid }),
  };
}

describe('CAT-001 live/legacy/project/merged resolution', () => {
  it('resolves live quotes, project numbers, legacy quotes, and merged aliases', () => {
    const records = [
      record({
        source_type: 'live_quote',
        source_id: 'quote-1',
        job_code: '60001-MD',
        aliases: ['59990-MD'],
      }),
      record({
        source_type: 'project_number',
        source_id: 'project-1',
        job_code: '60010-MD',
        aliases: ['60009-MD'],
      }),
      record({
        source_type: 'legacy_quote',
        source_id: 'legacy-1',
        job_code: '4123-AB',
      }),
    ];

    expect(resolveJobCatalogueRecord(records, { jobCode: '60001-MD' }).ok).toBe(true);
    expect(resolveJobCatalogueRecord(records, { jobCode: '59990-MD' }).record?.source_id).toBe('quote-1');
    expect(resolveJobCatalogueRecord(records, { jobCode: '60009-MD' }).record?.source_id).toBe('project-1');
    expect(resolveJobCatalogueRecord(records, { jobCode: '4123-AB' }).record?.source_type).toBe('legacy_quote');
  });
});

describe('CAT-002 address gating', () => {
  it('keeps missing-address jobs searchable but not allocatable', () => {
    const records = [
      record({
        source_type: 'project_number',
        source_id: 'project-2',
        job_code: '60020-MD',
        site_address: 'Short',
        address_valid: false,
      }),
    ];
    const options = listJobCatalogueOptions(records, '60020');
    expect(options).toHaveLength(1);
    expect(options[0].blockReason).toBe('missing_site_address');
    expect(resolveJobCatalogueRecord(records, { jobCode: '60020-MD' }).ok).toBe(false);
    expect(resolveJobCatalogueRecord(records, { jobCode: '60020-MD' }).block_reason).toBe('missing_site_address');
  });
});

describe('CAT-003 ambiguous-code rejection', () => {
  it('rejects unrelated cross-source collisions', () => {
    const records = [
      record({ source_type: 'live_quote', source_id: 'quote-2', job_code: '60100-MD' }),
      record({ source_type: 'legacy_quote', source_id: 'legacy-2', job_code: '60100-MD' }),
    ];
    const resolved = resolveJobCatalogueRecord(records, { jobCode: '60100-MD' });
    expect(resolved.ok).toBe(false);
    expect(resolved.block_reason).toBe('ambiguous_sources');
    expect(listJobCatalogueOptions(records).every((option) => option.isAmbiguous)).toBe(true);
  });
});
