import { describe, expect, it } from 'vitest';
import {
  getJobCatalogueBlockReason,
  isPlantDailyCheckCatalogueOptionSelectable,
  isReliableSiteAddress,
} from '@/lib/utils/job-catalogue';
import {
  listJobCatalogueOptions,
  loadJobCatalogueRecords,
  resolveJobCatalogueRecord,
} from '@/lib/server/job-catalogue';
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

  it('rejects exact-source and alias collisions as ambiguous', () => {
    const records = [
      record({
        source_type: 'live_quote',
        source_id: 'quote-3',
        job_code: '60200-MD',
        aliases: ['60199-MD'],
      }),
      record({
        source_type: 'project_number',
        source_id: 'project-3',
        job_code: '60199-MD',
      }),
    ];

    const exact = resolveJobCatalogueRecord(records, {
      sourceType: 'live_quote',
      sourceId: 'quote-3',
      jobCode: '60200-MD',
    });
    expect(exact.ok).toBe(false);
    expect(exact.block_reason).toBe('ambiguous_sources');
    expect(listJobCatalogueOptions(records).every((option) => option.isAmbiguous)).toBe(true);
  });
});

describe('PLC plant daily-check catalogue selection', () => {
  it('PLC-001 allows exact missing-address and ambiguous legacy sources', () => {
    expect(isPlantDailyCheckCatalogueOptionSelectable({
      source: 'legacy_quote',
      blockReason: 'missing_site_address',
    })).toBe(true);
    expect(isPlantDailyCheckCatalogueOptionSelectable({
      source: 'legacy_quote',
      blockReason: 'ambiguous_sources',
    })).toBe(true);
    expect(isPlantDailyCheckCatalogueOptionSelectable({
      source: 'legacy_quote',
      blockReason: null,
    })).toBe(true);
  });

  it('PLC-002 keeps blocked live and project options unselectable', () => {
    expect(isPlantDailyCheckCatalogueOptionSelectable({
      source: 'live_quote',
      blockReason: 'missing_site_address',
    })).toBe(false);
    expect(isPlantDailyCheckCatalogueOptionSelectable({
      source: 'project_number',
      blockReason: 'ambiguous_sources',
    })).toBe(false);
    expect(isPlantDailyCheckCatalogueOptionSelectable({
      source: 'live_quote',
      blockReason: null,
    })).toBe(true);
  });
});

interface CatalogueQuoteFixture {
  id: string;
  quote_thread_id: string;
  base_quote_reference: string | null;
  quote_reference: string | null;
  subject_line: string | null;
  project_description?: string | null;
  site_address: string | null;
  status: string | null;
  commercial_status: string | null;
  revision_number: number;
  created_at: string;
  is_latest_version: boolean;
  customer: { status: string | null; company_name: string | null };
}

function createCatalogueAdmin(quotes: CatalogueQuoteFixture[]) {
  const matchQuote = (
    row: CatalogueQuoteFixture,
    eqs: Record<string, unknown>,
    ins: Record<string, unknown[]>
  ) => {
    for (const [column, value] of Object.entries(eqs)) {
      if (column === 'customer.status') {
        if (row.customer.status !== value) return false;
        continue;
      }
      if ((row as Record<string, unknown>)[column] !== value) return false;
    }
    for (const [column, values] of Object.entries(ins)) {
      const actual = (row as Record<string, unknown>)[column];
      if (!values.includes(actual as never)) return false;
    }
    return true;
  };

  return {
    from(table: string) {
      if (table === 'quote_reference_aliases') {
        return {
          select: () => Promise.resolve({ data: [], error: null }),
        };
      }
      if (table === 'legacy_quotes') {
        const query = {
          not: () => query,
          order: () => ({
            range: async () => ({ data: [], error: null }),
          }),
        };
        return { select: () => query };
      }
      if (table === 'quote_project_numbers') {
        const query = {
          in: () => query,
          order: () => ({
            range: async () => ({ data: [], error: null }),
          }),
        };
        return { select: () => query };
      }
      if (table === 'quotes') {
        return {
          select() {
            const eqs: Record<string, unknown> = {};
            const ins: Record<string, unknown[]> = {};
            const query = {
              eq(column: string, value: unknown) {
                eqs[column] = value;
                return query;
              },
              in(column: string, values: unknown[]) {
                ins[column] = values;
                return query;
              },
              order() {
                return {
                  async range(from: number, to: number) {
                    const rows = quotes.filter((row) => matchQuote(row, eqs, ins));
                    return { data: rows.slice(from, to + 1), error: null };
                  },
                };
              },
            };
            return query;
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function quoteFixture(
  partial: Partial<CatalogueQuoteFixture> & Pick<CatalogueQuoteFixture, 'id' | 'quote_thread_id' | 'status' | 'is_latest_version'>
): CatalogueQuoteFixture {
  return {
    base_quote_reference: '40118-GH',
    quote_reference: '40118-GH',
    subject_line: 'Works',
    project_description: null,
    site_address: '12 High Street, Southwell',
    commercial_status: 'open',
    revision_number: 0,
    created_at: '2026-01-01T10:00:00.000Z',
    customer: { status: 'active', company_name: 'Omexom' },
    ...partial,
  };
}

describe('CAT-004 draft revision fallback', () => {
  it('lists po_received original plus latest draft as 40118-GH from the older sent UUID', async () => {
    const original = quoteFixture({
      id: 'quote-original',
      quote_thread_id: 'thread-gh',
      quote_reference: '40118-GH',
      subject_line: 'Original works',
      status: 'po_received',
      is_latest_version: false,
      revision_number: 0,
    });
    const draft = quoteFixture({
      id: 'quote-draft',
      quote_thread_id: 'thread-gh',
      quote_reference: '40118-GH-REV1',
      subject_line: 'Draft revision',
      status: 'draft',
      is_latest_version: true,
      revision_number: 1,
      created_at: '2026-03-01T10:00:00.000Z',
    });
    const records = await loadJobCatalogueRecords(createCatalogueAdmin([original, draft]) as never);
    const options = listJobCatalogueOptions(records, '40118');

    expect(options).toHaveLength(1);
    expect(options[0].value).toBe('40118-GH');
    expect(options[0].sourceId).toBe('quote-original');
    expect(options[0].quoteTitle).toBe('Original works');
    expect(resolveJobCatalogueRecord(records, { jobCode: '40118-GH' }).record?.source_id).toBe('quote-original');
  });
});

describe('CAT-005 never-sent drafts stay hidden', () => {
  it('excludes a draft-only thread', async () => {
    const draft = quoteFixture({
      id: 'quote-never',
      quote_thread_id: 'thread-never',
      status: 'draft',
      is_latest_version: true,
    });
    const records = await loadJobCatalogueRecords(createCatalogueAdmin([draft]) as never);
    expect(listJobCatalogueOptions(records, '40118')).toEqual([]);
    expect(resolveJobCatalogueRecord(records, { jobCode: '40118-GH' }).ok).toBe(false);
  });
});

describe('CAT-006 terminal, commercially closed, and inactive customers stay hidden', () => {
  it('omits latest lost, closed, commercial closed, inactive-customer, and FD-LATEST-001 duplicate-latest terminal threads even with older sent versions', async () => {
    const records = await loadJobCatalogueRecords(createCatalogueAdmin([
      quoteFixture({
        id: 'lost-original',
        quote_thread_id: 'thread-lost',
        base_quote_reference: '40120-GH',
        quote_reference: '40120-GH',
        status: 'sent',
        is_latest_version: false,
      }),
      quoteFixture({
        id: 'lost-latest',
        quote_thread_id: 'thread-lost',
        base_quote_reference: '40120-GH',
        quote_reference: '40120-GH-REV1',
        status: 'lost',
        is_latest_version: true,
        revision_number: 1,
      }),
      quoteFixture({
        id: 'closed-original',
        quote_thread_id: 'thread-closed',
        base_quote_reference: '40121-GH',
        quote_reference: '40121-GH',
        status: 'sent',
        is_latest_version: false,
      }),
      quoteFixture({
        id: 'closed-latest',
        quote_thread_id: 'thread-closed',
        base_quote_reference: '40121-GH',
        quote_reference: '40121-GH-REV1',
        status: 'closed',
        is_latest_version: true,
        revision_number: 1,
      }),
      quoteFixture({
        id: 'commercial-original',
        quote_thread_id: 'thread-commercial',
        base_quote_reference: '40122-GH',
        quote_reference: '40122-GH',
        status: 'sent',
        is_latest_version: false,
      }),
      quoteFixture({
        id: 'commercial-latest',
        quote_thread_id: 'thread-commercial',
        base_quote_reference: '40122-GH',
        quote_reference: '40122-GH-REV1',
        status: 'draft',
        commercial_status: 'closed',
        is_latest_version: true,
        revision_number: 1,
      }),
      quoteFixture({
        id: 'inactive-original',
        quote_thread_id: 'thread-inactive',
        base_quote_reference: '40123-GH',
        quote_reference: '40123-GH',
        status: 'sent',
        is_latest_version: false,
        customer: { status: 'inactive', company_name: 'Inactive Ltd' },
      }),
      quoteFixture({
        id: 'inactive-latest',
        quote_thread_id: 'thread-inactive',
        base_quote_reference: '40123-GH',
        quote_reference: '40123-GH-REV1',
        status: 'draft',
        is_latest_version: true,
        revision_number: 1,
        customer: { status: 'inactive', company_name: 'Inactive Ltd' },
      }),
      quoteFixture({
        id: 'dup-sent',
        quote_thread_id: 'thread-dup-latest',
        base_quote_reference: '40124-GH',
        quote_reference: '40124-GH',
        status: 'sent',
        is_latest_version: true,
        revision_number: 0,
      }),
      quoteFixture({
        id: 'dup-lost',
        quote_thread_id: 'thread-dup-latest',
        base_quote_reference: '40124-GH',
        quote_reference: '40124-GH-REV1',
        status: 'lost',
        is_latest_version: true,
        revision_number: 2,
        created_at: '2026-04-01T10:00:00.000Z',
      }),
    ]) as never);

    expect(listJobCatalogueOptions(records).map((option) => option.value)).toEqual([]);
  });
});

describe('CAT-007 one live_quote row per thread', () => {
  it('resolves two sent-onwards versions to the latest row and a pre-send latest to the highest older sent revision', async () => {
    const original = quoteFixture({
      id: 'quote-old',
      quote_thread_id: 'thread-two-sent',
      status: 'po_received',
      is_latest_version: false,
      revision_number: 0,
      subject_line: 'Older sent',
    });
    const latest = quoteFixture({
      id: 'quote-latest-sent',
      quote_thread_id: 'thread-two-sent',
      quote_reference: '40118-GH-REV1',
      status: 'sent',
      is_latest_version: true,
      revision_number: 1,
      created_at: '2026-03-01T10:00:00.000Z',
      subject_line: 'Latest sent',
    });
    const firstSent = quoteFixture({
      id: 'quote-rev0',
      quote_thread_id: 'thread-tie',
      status: 'po_received',
      is_latest_version: false,
      revision_number: 0,
      created_at: '2026-01-01T10:00:00.000Z',
    });
    const secondSent = quoteFixture({
      id: 'quote-rev1',
      quote_thread_id: 'thread-tie',
      quote_reference: '40118-GH-REV1',
      status: 'sent',
      is_latest_version: false,
      revision_number: 1,
      created_at: '2026-02-01T10:00:00.000Z',
      subject_line: 'Higher sent',
    });
    const draft = quoteFixture({
      id: 'quote-rev2-draft',
      quote_thread_id: 'thread-tie',
      quote_reference: '40118-GH-REV2',
      status: 'pending_internal_approval',
      is_latest_version: true,
      revision_number: 2,
      created_at: '2026-03-01T10:00:00.000Z',
    });

    const latestWins = await loadJobCatalogueRecords(createCatalogueAdmin([original, latest]) as never);
    const latestOptions = listJobCatalogueOptions(latestWins, '40118');
    expect(latestOptions).toHaveLength(1);
    expect(latestOptions[0].sourceId).toBe('quote-latest-sent');
    expect(resolveJobCatalogueRecord(latestWins, { jobCode: '40118-GH' }).record?.source_id).toBe('quote-latest-sent');

    const fallback = await loadJobCatalogueRecords(
      createCatalogueAdmin([firstSent, secondSent, draft]) as never
    );
    expect(listJobCatalogueOptions(fallback).map((option) => option.sourceId)).toEqual(['quote-rev1']);
  });
});
