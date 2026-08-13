import { createAdminClient } from '@/lib/supabase/admin';
import {
  QUOTE_JOB_NUMBER_REGEX,
  normalizeCatalogJobCode,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';
import {
  canAllocateJobCatalogueRecord,
  getJobCatalogueBlockMessage,
  getJobCatalogueBlockReason,
  isReliableSiteAddress,
} from '@/lib/utils/job-catalogue';
import type {
  JobCatalogueIdentity,
  JobCatalogueOption,
  JobCatalogueRecord,
  JobCatalogueResolveResult,
  JobCatalogueSourceType,
} from '@/types/job-catalogue';

const SENT_ONWARDS_QUOTE_STATUSES = [
  'sent',
  'won',
  'ready_to_invoice',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
] as const;

const JOB_CODE_FETCH_PAGE_SIZE = 1_000;

interface QuoteJobCodeCustomer {
  status: string | null;
  company_name: string | null;
}

interface QuoteJobCodeRow {
  id: string;
  quote_thread_id: string;
  base_quote_reference: string | null;
  quote_reference: string | null;
  subject_line: string | null;
  project_description: string | null;
  site_address: string | null;
  status: string | null;
  commercial_status: string | null;
  customer: QuoteJobCodeCustomer | QuoteJobCodeCustomer[] | null;
}

interface LegacyQuoteJobCodeRow {
  id: string;
  quote_reference: string | null;
  customer_name: string | null;
  title: string | null;
  site_address: string | null;
}

interface ProjectNumberJobCodeRow {
  id: string;
  project_reference: string | null;
  title: string | null;
  description: string | null;
  site_address: string | null;
  status: 'open' | 'linked' | 'converted' | 'cancelled' | 'merged';
  merged_into_project_number_id: string | null;
  converted_quote_id: string | null;
}

function getQuoteCustomer(row: QuoteJobCodeRow): QuoteJobCodeCustomer | null {
  if (Array.isArray(row.customer)) return row.customer[0] || null;
  return row.customer;
}

function identityKey(identity: JobCatalogueIdentity): string {
  return `${identity.source_type}:${identity.source_id}`;
}

function getLookupMatches(records: JobCatalogueRecord[], rawCode: string): Map<string, JobCatalogueRecord> {
  const code = normalizeCatalogJobCode(rawCode);
  const matches = records.filter((record) => (
    normalizeCatalogJobCode(record.job_code) === code
    || record.aliases.some((alias) => normalizeCatalogJobCode(alias) === code)
  ));
  return new Map(matches.map((record) => [identityKey(record), record]));
}

function recordHasAmbiguousLookup(records: JobCatalogueRecord[], record: JobCatalogueRecord): boolean {
  return [record.job_code, ...record.aliases]
    .some((code) => getLookupMatches(records, code).size > 1);
}

async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const from = rows.length;
    const to = from + JOB_CODE_FETCH_PAGE_SIZE - 1;
    const page = await loadPage(from, to);
    rows.push(...page);
    if (page.length < JOB_CODE_FETCH_PAGE_SIZE) break;
  }
  return rows;
}

export async function loadJobCatalogueRecords(
  admin: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<JobCatalogueRecord[]> {
  const [quoteRows, legacyRows, projectRows, aliasResult] = await Promise.all([
    fetchAllPages(async (from, to) => {
      const result = await admin
        .from('quotes')
        .select(`
          id,
          quote_thread_id,
          base_quote_reference,
          quote_reference,
          subject_line,
          project_description,
          site_address,
          status,
          commercial_status,
          customer:customers!inner(status, company_name)
        `)
        .eq('is_latest_version', true)
        .eq('commercial_status', 'open')
        .in('status', SENT_ONWARDS_QUOTE_STATUSES)
        .eq('customer.status', 'active')
        .order('base_quote_reference', { ascending: true })
        .range(from, to);
      if (result.error) throw result.error;
      return (result.data || []) as QuoteJobCodeRow[];
    }),
    fetchAllPages(async (from, to) => {
      const result = await admin
        .from('legacy_quotes')
        .select('id, quote_reference, customer_name, title, site_address')
        .not('quote_reference', 'is', null)
        .order('quote_reference', { ascending: true })
        .range(from, to);
      if (result.error) throw result.error;
      return (result.data || []) as LegacyQuoteJobCodeRow[];
    }),
    fetchAllPages(async (from, to) => {
      const result = await admin
        .from('quote_project_numbers')
        .select(`
          id,
          project_reference,
          title,
          description,
          site_address,
          status,
          merged_into_project_number_id,
          converted_quote_id
        `)
        .in('status', ['open', 'merged', 'converted'])
        .order('project_reference', { ascending: true })
        .range(from, to);
      if (result.error) throw result.error;
      return (result.data || []) as ProjectNumberJobCodeRow[];
    }),
    admin
      .from('quote_reference_aliases')
      .select('alias_reference, source_quote_thread_id, canonical_quote_thread_id'),
  ]);

  if (aliasResult.error) throw aliasResult.error;

  const aliasesByCanonicalThread = new Map<string, string[]>();
  const retiredThreadIds = new Set<string>();
  for (const alias of aliasResult.data || []) {
    retiredThreadIds.add(alias.source_quote_thread_id);
    aliasesByCanonicalThread.set(alias.canonical_quote_thread_id, [
      ...(aliasesByCanonicalThread.get(alias.canonical_quote_thread_id) || []),
      alias.alias_reference,
    ]);
  }

  const quotesById = new Map(quoteRows.map((row) => [row.id, row]));
  const quotesByThread = new Map(quoteRows.map((row) => [row.quote_thread_id, row]));
  const projectsById = new Map(projectRows.map((row) => [row.id, row]));
  const extraAliases = new Map<string, string[]>();

  const addExtraAlias = (identity: JobCatalogueIdentity, alias: string) => {
    const normalizedAlias = normalizeCatalogJobCode(alias);
    if (!normalizedAlias) return;
    const key = identityKey(identity);
    extraAliases.set(key, [...(extraAliases.get(key) || []), normalizedAlias]);
  };

  const followMergedProject = (startId: string): ProjectNumberJobCodeRow | null => {
    const seen = new Set<string>();
    let current = projectsById.get(startId) || null;
    while (current?.status === 'merged' && current.merged_into_project_number_id) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      current = projectsById.get(current.merged_into_project_number_id) || null;
    }
    return current;
  };

  const records: JobCatalogueRecord[] = [];
  const seenIdentities = new Set<string>();

  const pushRecord = (record: JobCatalogueRecord) => {
    const key = identityKey(record);
    if (seenIdentities.has(key)) return;
    seenIdentities.add(key);
    records.push(record);
  };

  for (const row of quoteRows) {
    if (retiredThreadIds.has(row.quote_thread_id)) continue;
    const jobCode = normalizeJobNumberInput(row.base_quote_reference || row.quote_reference || '');
    if (!QUOTE_JOB_NUMBER_REGEX.test(jobCode)) continue;
    const customer = getQuoteCustomer(row);
    const siteAddress = row.site_address?.trim() || null;
    const addressValid = isReliableSiteAddress(siteAddress);
    const isActive = row.commercial_status === 'open' && row.status !== 'lost' && row.status !== 'closed';
    pushRecord({
      source_type: 'live_quote',
      source_id: row.id,
      job_code: jobCode,
      customer_name: customer?.company_name || null,
      title: row.subject_line || row.project_description || null,
      site_address: siteAddress,
      address_valid: addressValid,
      aliases: aliasesByCanonicalThread.get(row.quote_thread_id) || [],
      is_active: isActive,
      block_reason: getJobCatalogueBlockReason({ is_active: isActive, address_valid: addressValid }),
    });
  }

  for (const row of projectRows) {
    if (row.status === 'converted' && row.converted_quote_id) {
      const quote = quotesById.get(row.converted_quote_id) || quotesByThread.get(row.converted_quote_id);
      if (quote) {
        addExtraAlias(
          { source_type: 'live_quote', source_id: quote.id, job_code: '' },
          row.project_reference || ''
        );
        continue;
      }
    }
    if (row.status === 'merged' && row.merged_into_project_number_id) {
      const survivor = followMergedProject(row.merged_into_project_number_id);
      if (survivor?.status === 'converted' && survivor.converted_quote_id) {
        const quote = quotesById.get(survivor.converted_quote_id) || quotesByThread.get(survivor.converted_quote_id);
        if (quote) {
          addExtraAlias(
            { source_type: 'live_quote', source_id: quote.id, job_code: '' },
            row.project_reference || ''
          );
          continue;
        }
      }
      if (survivor && survivor.status === 'open') {
        addExtraAlias(
          { source_type: 'project_number', source_id: survivor.id, job_code: '' },
          row.project_reference || ''
        );
      }
      continue;
    }
    const jobCode = normalizeJobNumberInput(row.project_reference || '');
    if (!QUOTE_JOB_NUMBER_REGEX.test(jobCode) && !jobCode) continue;
    if (!jobCode) continue;
    const siteAddress = row.site_address?.trim() || null;
    const addressValid = isReliableSiteAddress(siteAddress);
    const isActive = row.status === 'open';
    pushRecord({
      source_type: 'project_number',
      source_id: row.id,
      job_code: jobCode,
      customer_name: 'Project number',
      title: row.title || row.description || null,
      site_address: siteAddress,
      address_valid: addressValid,
      aliases: [],
      is_active: isActive,
      block_reason: getJobCatalogueBlockReason({ is_active: isActive, address_valid: addressValid }),
    });
  }

  for (const row of legacyRows) {
    const jobCode = normalizeCatalogJobCode(row.quote_reference || '');
    if (!jobCode) continue;
    const siteAddress = row.site_address?.trim() || null;
    const addressValid = isReliableSiteAddress(siteAddress);
    pushRecord({
      source_type: 'legacy_quote',
      source_id: row.id,
      job_code: jobCode,
      customer_name: row.customer_name || null,
      title: row.title || null,
      site_address: siteAddress,
      address_valid: addressValid,
      aliases: [],
      is_active: true,
      block_reason: getJobCatalogueBlockReason({ is_active: true, address_valid: addressValid }),
    });
  }

  for (const record of records) {
    const extras = extraAliases.get(identityKey(record)) || [];
    if (extras.length === 0) continue;
    record.aliases = Array.from(new Set([...record.aliases, ...extras]));
  }

  return records;
}

export function listJobCatalogueOptions(
  records: JobCatalogueRecord[],
  query = ''
): JobCatalogueOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedJobQuery = normalizeJobNumberInput(query).toLowerCase();
  const byCode = new Map<string, JobCatalogueRecord[]>();

  for (const record of records) {
    const bucket = byCode.get(record.job_code) || [];
    bucket.push(record);
    byCode.set(record.job_code, bucket);
  }

  const options: JobCatalogueOption[] = [];
  for (const [jobCode, matches] of byCode.entries()) {
    const uniqueIdentities = new Map(matches.map((record) => [identityKey(record), record]));
    for (const record of uniqueIdentities.values()) {
      const isAmbiguous = recordHasAmbiguousLookup(records, record);
      const haystack = [
        record.job_code,
        record.customer_name,
        record.title,
        record.site_address,
        ...record.aliases,
      ].filter(Boolean).join(' ').toLowerCase();
      if (
        normalizedQuery
        && !haystack.includes(normalizedQuery)
        && !(normalizedJobQuery && record.job_code.toLowerCase().includes(normalizedJobQuery))
      ) {
        continue;
      }

      const blockReason = getJobCatalogueBlockReason(record, isAmbiguous);
      options.push({
        value: jobCode,
        label: jobCode,
        customerName: record.customer_name,
        quoteTitle: record.title,
        source: record.source_type,
        sourceId: record.source_id,
        siteAddress: record.site_address,
        addressValid: record.address_valid && !isAmbiguous,
        aliases: record.aliases,
        isAmbiguous,
        blockReason,
      });
    }
  }

  return options.sort((a, b) => a.value.localeCompare(b.value));
}

export function resolveJobCatalogueRecord(
  records: JobCatalogueRecord[],
  input: { jobCode?: string | null; sourceType?: JobCatalogueSourceType | null; sourceId?: string | null }
): JobCatalogueResolveResult {
  if (input.sourceType && input.sourceId) {
    const exact = records.find(
      (record) => record.source_type === input.sourceType && record.source_id === input.sourceId
    );
    if (!exact) {
      return {
        ok: false,
        record: null,
        block_reason: 'not_found',
        message: getJobCatalogueBlockMessage('not_found'),
      };
    }
    const isAmbiguous = recordHasAmbiguousLookup(records, exact);
    const blockReason = getJobCatalogueBlockReason(exact, isAmbiguous);
    return {
      ok: canAllocateJobCatalogueRecord(exact) && !isAmbiguous,
      record: exact,
      block_reason: blockReason,
      message: getJobCatalogueBlockMessage(blockReason),
    };
  }

  const jobCode = normalizeCatalogJobCode(input.jobCode || '');
  if (!jobCode) {
    return {
      ok: false,
      record: null,
      block_reason: 'not_found',
      message: getJobCatalogueBlockMessage('not_found'),
    };
  }

  const unique = getLookupMatches(records, jobCode);
  if (unique.size === 0) {
    return {
      ok: false,
      record: null,
      block_reason: 'not_found',
      message: getJobCatalogueBlockMessage('not_found'),
    };
  }
  if (unique.size > 1) {
    return {
      ok: false,
      record: null,
      block_reason: 'ambiguous_sources',
      message: getJobCatalogueBlockMessage('ambiguous_sources'),
    };
  }

  const record = Array.from(unique.values())[0];
  return {
    ok: canAllocateJobCatalogueRecord(record),
    record,
    block_reason: record.block_reason,
    message: getJobCatalogueBlockMessage(record.block_reason),
  };
}

export async function resolveAllocatableJob(
  input: { jobCode?: string | null; sourceType?: JobCatalogueSourceType | null; sourceId?: string | null },
  admin: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<JobCatalogueResolveResult> {
  const records = await loadJobCatalogueRecords(admin);
  return resolveJobCatalogueRecord(records, input);
}
