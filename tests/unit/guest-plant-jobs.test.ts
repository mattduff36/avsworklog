import { describe, expect, it } from 'vitest';
import { guestJobCodeMatches, searchGuestPlantJobs } from '@/lib/inspections/guest-plant-jobs';
import type { JobCatalogueRecord } from '@/types/job-catalogue';

const record = (patch: Partial<JobCatalogueRecord> = {}): JobCatalogueRecord => ({
  source_type: 'live_quote', source_id: 'first', job_code: '12345-AB', customer_name: 'Example customer',
  title: 'Drain repairs', is_active: true, address_valid: false, site_address: 'Private address',
  aliases: ['private alias'], block_reason: 'missing_site_address', ...patch,
});
describe('guest Plant catalogue search', () => {
  it('uses the existing picker minimum and code/customer/name matching', () => {
    for (const query of ['', '12', ' 1 2 ']) expect(searchGuestPlantJobs([record()], query)).toEqual([]);
    for (const query of ['123', '12345ab', 'EXAMPLE', 'drain']) expect(searchGuestPlantJobs([record()], query)).toHaveLength(1);
    expect(searchGuestPlantJobs([record()], 'unrelated')).toEqual([]);
  });
  it('retains exact source identities, permits active weak-address/ambiguous jobs and excludes closed jobs', () => {
    const result = searchGuestPlantJobs([record(), record({ source_id: 'second', block_reason: 'ambiguous_sources' }),
      record({ source_id: 'closed', is_active: false }), record({ source_id: 'blocked', block_reason: 'inactive_source' })], '123');
    expect(result.map(r => r.sourceId)).toEqual(['first', 'second']);
    expect(result[0]).toEqual({ sourceType: 'live_quote', sourceId: 'first', code: '12345-AB', title: 'Drain repairs', customerName: 'Example customer' });
    expect(JSON.stringify(result)).not.toContain('Private address');
    expect(searchGuestPlantJobs(Array.from({ length: 90 }, (_, i) => record({ source_id: String(i) })), '123')).toHaveLength(80);
  });
  it('binds full selected codes, keeps old numeric clients and rejects a changed suffix', () => {
    expect(guestJobCodeMatches('12345-AB', '12345-AB')).toBe(true);
    expect(guestJobCodeMatches('12345-AB', '12345')).toBe(true);
    expect(guestJobCodeMatches('PROJECTABC', 'PROJECTABC')).toBe(true);
    expect(guestJobCodeMatches('12345-AB', '12345-CD')).toBe(false);
    expect(guestJobCodeMatches('12345-AB', '12345-AB-WRONG')).toBe(false);
    expect(guestJobCodeMatches('12345-AB', '123')).toBe(false);
  });
});
