import type { AdminClient } from '@/lib/server/daily-allocation/auth';
import { normalizeCatalogJobCode } from '@/lib/utils/timesheet-job-codes';
import type {
  WhereaboutsCatalogueFill,
  WhereaboutsJobRef,
} from '@/types/workshop-asset-whereabouts';

const WHEREABOUTS_QUOTE_SELECT =
  'id, quote_reference, base_quote_reference, subject_line, site_address, customer:customers(company_name)';

interface QuoteEnrichRow {
  id: string;
  quote_reference: string | null;
  base_quote_reference: string | null;
  subject_line: string | null;
  site_address: string | null;
  customer: { company_name: string | null } | { company_name: string | null }[] | null;
}

interface LegacyQuoteEnrichRow {
  id: string;
  quote_reference: string | null;
  customer_name: string | null;
  title: string | null;
  site_address: string | null;
}

interface ProjectNumberEnrichRow {
  id: string;
  project_reference: string | null;
  title: string | null;
  site_address: string | null;
}

function customerNameFromQuote(row: QuoteEnrichRow): string | null {
  const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
  return customer?.company_name?.trim() || null;
}

function fillFromQuote(row: QuoteEnrichRow): WhereaboutsCatalogueFill {
  return {
    customerName: customerNameFromQuote(row),
    jobTitle: row.subject_line?.trim() || null,
    siteAddress: row.site_address?.trim() || null,
  };
}

function fillFromLegacy(row: LegacyQuoteEnrichRow): WhereaboutsCatalogueFill {
  return {
    customerName: row.customer_name?.trim() || null,
    jobTitle: row.title?.trim() || null,
    siteAddress: row.site_address?.trim() || null,
  };
}

function fillFromProject(row: ProjectNumberEnrichRow): WhereaboutsCatalogueFill {
  return {
    customerName: null,
    jobTitle: row.title?.trim() || null,
    siteAddress: row.site_address?.trim() || null,
  };
}

export function catalogueIdentityKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export function recordUniqueCodeFill(
  fills: Map<string, WhereaboutsCatalogueFill>,
  codeIdentities: Map<string, string>,
  ambiguousCodes: Set<string>,
  code: string,
  fill: WhereaboutsCatalogueFill,
  identity: string
): void {
  if (!code || !identity || ambiguousCodes.has(code)) return;
  const key = `code:${code}`;
  const existingIdentity = codeIdentities.get(code);
  if (!existingIdentity) {
    fills.set(key, fill);
    codeIdentities.set(code, identity);
    return;
  }
  if (existingIdentity === identity) {
    return;
  }
  fills.delete(key);
  ambiguousCodes.add(code);
}

export function applyCatalogueFill<T extends {
  customerName: string | null;
  jobTitle: string | null;
  siteAddress: string | null;
}>(target: T, fill: WhereaboutsCatalogueFill | null): T {
  if (!fill) return target;
  return {
    ...target,
    customerName: target.customerName || fill.customerName,
    jobTitle: target.jobTitle || fill.jobTitle,
    siteAddress: target.siteAddress || fill.siteAddress,
  };
}

export async function loadWhereaboutsCatalogueFills(
  admin: AdminClient,
  refs: WhereaboutsJobRef[]
): Promise<Map<string, WhereaboutsCatalogueFill>> {
  const fills = new Map<string, WhereaboutsCatalogueFill>();
  const exactByType = {
    live_quote: new Set<string>(),
    legacy_quote: new Set<string>(),
    project_number: new Set<string>(),
  };
  const codes = new Set<string>();

  for (const ref of refs) {
    if (ref.sourceType && ref.sourceId) {
      exactByType[ref.sourceType].add(ref.sourceId);
    }
    const code = normalizeCatalogJobCode(ref.jobCode || '');
    if (code) codes.add(code);
  }

  const codeList = [...codes];
  const [liveExact, legacyExact, projectExact, liveByRef, liveByBase, legacyByCode, projectByCode] =
    await Promise.all([
      exactByType.live_quote.size
        ? admin
            .from('quotes')
            .select(WHEREABOUTS_QUOTE_SELECT)
            .eq('is_latest_version', true)
            .in('id', [...exactByType.live_quote])
        : Promise.resolve({ data: [] as QuoteEnrichRow[], error: null }),
      exactByType.legacy_quote.size
        ? admin
            .from('legacy_quotes')
            .select('id, quote_reference, customer_name, title, site_address')
            .in('id', [...exactByType.legacy_quote])
        : Promise.resolve({ data: [] as LegacyQuoteEnrichRow[], error: null }),
      exactByType.project_number.size
        ? admin
            .from('quote_project_numbers')
            .select('id, project_reference, title, site_address')
            .in('id', [...exactByType.project_number])
        : Promise.resolve({ data: [] as ProjectNumberEnrichRow[], error: null }),
      codeList.length
        ? admin
            .from('quotes')
            .select(WHEREABOUTS_QUOTE_SELECT)
            .eq('is_latest_version', true)
            .in('quote_reference', codeList)
        : Promise.resolve({ data: [] as QuoteEnrichRow[], error: null }),
      codeList.length
        ? admin
            .from('quotes')
            .select(WHEREABOUTS_QUOTE_SELECT)
            .eq('is_latest_version', true)
            .in('base_quote_reference', codeList)
        : Promise.resolve({ data: [] as QuoteEnrichRow[], error: null }),
      codeList.length
        ? admin
            .from('legacy_quotes')
            .select('id, quote_reference, customer_name, title, site_address')
            .in('quote_reference', codeList)
        : Promise.resolve({ data: [] as LegacyQuoteEnrichRow[], error: null }),
      codeList.length
        ? admin
            .from('quote_project_numbers')
            .select('id, project_reference, title, site_address')
            .in('project_reference', codeList)
        : Promise.resolve({ data: [] as ProjectNumberEnrichRow[], error: null }),
    ]);

  if (liveExact.error) throw liveExact.error;
  if (legacyExact.error) throw legacyExact.error;
  if (projectExact.error) throw projectExact.error;
  if (liveByRef.error) throw liveByRef.error;
  if (liveByBase.error) throw liveByBase.error;
  if (legacyByCode.error) throw legacyByCode.error;
  if (projectByCode.error) throw projectByCode.error;

  for (const row of (liveExact.data || []) as QuoteEnrichRow[]) {
    fills.set(`id:live_quote:${row.id}`, fillFromQuote(row));
  }
  for (const row of (legacyExact.data || []) as LegacyQuoteEnrichRow[]) {
    fills.set(`id:legacy_quote:${row.id}`, fillFromLegacy(row));
  }
  for (const row of (projectExact.data || []) as ProjectNumberEnrichRow[]) {
    fills.set(`id:project_number:${row.id}`, fillFromProject(row));
  }
  const ambiguousCodes = new Set<string>();
  const codeIdentities = new Map<string, string>();
  const liveByCodeRows = [
    ...((liveByRef.data || []) as QuoteEnrichRow[]),
    ...((liveByBase.data || []) as QuoteEnrichRow[]),
  ];
  for (const row of liveByCodeRows) {
    const codesForRow = [
      normalizeCatalogJobCode(row.quote_reference || ''),
      normalizeCatalogJobCode(row.base_quote_reference || ''),
    ].filter(Boolean);
    for (const code of codesForRow) {
      recordUniqueCodeFill(
        fills,
        codeIdentities,
        ambiguousCodes,
        code,
        fillFromQuote(row),
        catalogueIdentityKey('live_quote', row.id)
      );
    }
  }
  for (const row of (legacyByCode.data || []) as LegacyQuoteEnrichRow[]) {
    recordUniqueCodeFill(
      fills,
      codeIdentities,
      ambiguousCodes,
      normalizeCatalogJobCode(row.quote_reference || ''),
      fillFromLegacy(row),
      catalogueIdentityKey('legacy_quote', row.id)
    );
  }
  for (const row of (projectByCode.data || []) as ProjectNumberEnrichRow[]) {
    recordUniqueCodeFill(
      fills,
      codeIdentities,
      ambiguousCodes,
      normalizeCatalogJobCode(row.project_reference || ''),
      fillFromProject(row),
      catalogueIdentityKey('project_number', row.id)
    );
  }

  return fills;
}

export function resolveCatalogueFill(
  fills: Map<string, WhereaboutsCatalogueFill>,
  ref: WhereaboutsJobRef
): WhereaboutsCatalogueFill | null {
  if (ref.sourceType && ref.sourceId) {
    const exact = fills.get(`id:${ref.sourceType}:${ref.sourceId}`);
    if (exact) return exact;
  }
  const code = normalizeCatalogJobCode(ref.jobCode || '');
  return code ? fills.get(`code:${code}`) || null : null;
}
