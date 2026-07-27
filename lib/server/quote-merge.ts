import { createHash, randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  fetchQuoteBundle,
  renderQuotePdfAttachment,
} from '@/lib/server/quote-workflow';
import type { Database, Json } from '@/types/database';
import {
  syncQuoteSiteLocation,
  syncSiteLocation,
} from '@/lib/server/inventory-site-location-sync';
import {
  loadQuoteMergeContexts,
} from '@/lib/server/quote-merge-resolution';

type AdminClient = ReturnType<typeof createAdminClient>;
type QuoteRow = Database['public']['Tables']['quotes']['Row'];
type QuoteLineItemRow = Database['public']['Tables']['quote_line_items']['Row'];

export type QuoteMergeMode = 'consolidated' | 'grouped';
export type QuoteMergeBillingScope = 'single' | 'combined' | 'source';

export interface QuoteMergeRequest {
  quote_ids: string[];
  survivor_quote_id: string;
  merge_mode: QuoteMergeMode;
  irreversible_confirmed: boolean;
}

export interface QuoteMergeResult {
  merge_group_id: string;
  quote_id: string;
  quote_thread_id: string;
  canonical_reference: string;
  aliases: string[];
  merge_mode: QuoteMergeMode;
}

interface SnapshotPayload {
  quote_id: string;
  quote_updated_at: string | null;
  line_state: Json;
  storage_path: string;
  file_sha256: string;
  file_size: number;
}

interface ConsolidatedLinePayload {
  id: string;
  source_quote_thread_id: string;
  source_quote_id: string;
  source_line_item_id: string;
  copy_line_item_id: string;
  source_quote_reference: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_rate: number;
  line_total: number;
  sort_order: number;
}

interface LineProvenance {
  source_quote_thread_id: string;
  source_quote_id: string;
  source_line_item_id: string;
  source_quote_reference: string;
}

interface MergeRpcResult {
  merge_group_id: string;
  quote_id: string;
  quote_thread_id: string;
  canonical_reference: string;
  aliases: string[];
  merge_mode: QuoteMergeMode;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((id): id is string => typeof id === 'string')
      .map(id => id.trim())
      .filter(Boolean),
  ));
}

export function normalizeQuoteMergeRequest(body: Record<string, unknown>): QuoteMergeRequest {
  const quoteIds = normalizeIds(body.quote_ids);
  const survivorQuoteId = typeof body.survivor_quote_id === 'string'
    ? body.survivor_quote_id.trim()
    : '';
  const mergeMode = body.merge_mode === 'grouped' ? 'grouped' : 'consolidated';

  if (quoteIds.length < 2) {
    throw new Error('Select at least two quotes to merge.');
  }
  if (!survivorQuoteId || !quoteIds.includes(survivorQuoteId)) {
    throw new Error('Choose one selected quote number to retain.');
  }
  if (body.irreversible_confirmed !== true) {
    throw new Error('Confirm that this permanent merge cannot be undone.');
  }

  return {
    quote_ids: quoteIds,
    survivor_quote_id: survivorQuoteId,
    merge_mode: mergeMode,
    irreversible_confirmed: true,
  };
}

function ensureEligibleQuotes(quotes: QuoteRow[], input: QuoteMergeRequest): QuoteRow {
  if (quotes.length !== input.quote_ids.length) {
    throw new Error('One or more selected quotes no longer exist.');
  }
  if (quotes.some(quote => !quote.is_latest_version || quote.commercial_status !== 'open')) {
    throw new Error('All selected quotes must be their latest commercially open versions.');
  }

  const customerIds = new Set(quotes.map(quote => quote.customer_id));
  if (customerIds.size !== 1) {
    throw new Error('Quotes can only be merged for the same customer.');
  }

  const managerIds = new Set(quotes.map(quote => quote.requester_id).filter(Boolean));
  if (managerIds.size !== 1 || quotes.some(quote => !quote.requester_id)) {
    throw new Error('Quotes can only be merged when they have the same manager.');
  }

  const survivor = quotes.find(quote => quote.id === input.survivor_quote_id);
  if (!survivor) {
    throw new Error('The retained quote is no longer available.');
  }
  return survivor;
}

function buildCombinedText(
  quotes: QuoteRow[],
  field: 'project_description' | 'scope',
): string | null {
  const sections = quotes
    .map(quote => {
      const value = quote[field]?.trim();
      return value ? `${quote.base_quote_reference}\n${value}` : null;
    })
    .filter((section): section is string => Boolean(section));
  return sections.length > 0 ? sections.join('\n\n') : null;
}

function buildConsolidatedLines(
  quotes: QuoteRow[],
  lineItems: QuoteLineItemRow[],
  survivorThreadId: string,
  provenanceByLineId: Map<string, LineProvenance> = new Map(),
): ConsolidatedLinePayload[] {
  const quoteById = new Map(quotes.map(quote => [quote.id, quote]));
  const sortedQuotes = [...quotes].sort((left, right) => {
    if (left.quote_thread_id === survivorThreadId) return -1;
    if (right.quote_thread_id === survivorThreadId) return 1;
    return left.base_quote_reference.localeCompare(right.base_quote_reference);
  });
  const quoteRank = new Map(sortedQuotes.map((quote, index) => [quote.id, index]));

  return [...lineItems]
    .sort((left, right) => {
      const quoteDifference = (quoteRank.get(left.quote_id) || 0) - (quoteRank.get(right.quote_id) || 0);
      return quoteDifference || left.sort_order - right.sort_order;
    })
    .map((line, index) => {
      const sourceQuote = quoteById.get(line.quote_id);
      if (!sourceQuote) {
        throw new Error('A quote line no longer belongs to the selected quotes.');
      }
      const provenance = provenanceByLineId.get(line.id);
      return {
        id: randomUUID(),
        source_quote_thread_id: provenance?.source_quote_thread_id || sourceQuote.quote_thread_id,
        source_quote_id: provenance?.source_quote_id || sourceQuote.id,
        source_line_item_id: provenance?.source_line_item_id || line.id,
        copy_line_item_id: line.id,
        source_quote_reference: provenance?.source_quote_reference || sourceQuote.base_quote_reference,
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unit_rate: Number(line.unit_rate),
        line_total: Number(line.line_total),
        sort_order: index,
      };
    });
}

async function stagePdfSnapshots(
  admin: AdminClient,
  versions: QuoteRow[],
  actorUserId: string,
): Promise<{ snapshots: SnapshotPayload[]; uploadedPaths: string[] }> {
  const uploadedPaths: string[] = [];
  const { data: snapshotLineRows, error: snapshotLineError } = await admin
    .from('quote_line_items')
    .select('quote_id, description, quantity, unit, unit_rate, line_total, sort_order')
    .in('quote_id', versions.map(version => version.id))
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (snapshotLineError) throw snapshotLineError;
  const lineStateByQuoteId = new Map<string, Json[]>();
  for (const line of snapshotLineRows || []) {
    lineStateByQuoteId.set(line.quote_id, [
      ...(lineStateByQuoteId.get(line.quote_id) || []),
      {
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unit_rate: Number(line.unit_rate),
        line_total: Number(line.line_total),
        sort_order: line.sort_order,
      },
    ]);
  }
  const { data: existingSnapshots, error: existingError } = await admin
    .from('quote_pdf_snapshots')
    .select('quote_id, storage_path, file_sha256, file_size')
    .in('quote_id', versions.map(version => version.id));
  if (existingError) throw existingError;
  const existingByQuoteId = new Map(
    (existingSnapshots || []).map(snapshot => [snapshot.quote_id, snapshot]),
  );
  const snapshots: SnapshotPayload[] = [];
  try {
    for (const version of versions) {
      const existing = existingByQuoteId.get(version.id);
      if (existing) {
        snapshots.push({
          quote_id: existing.quote_id,
          quote_updated_at: version.updated_at,
          line_state: lineStateByQuoteId.get(version.id) || [],
          storage_path: existing.storage_path,
          file_sha256: existing.file_sha256,
          file_size: existing.file_size,
        });
        continue;
      }
      const bundle = await fetchQuoteBundle(admin, version.id);
      const attachment = await renderQuotePdfAttachment(bundle);
      const bytes = Buffer.from(attachment.content, 'base64');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const storagePath = `${actorUserId}/${version.id}/${randomUUID()}-${sha256.slice(0, 12)}.pdf`;
      const { error } = await admin.storage
        .from('quote-pdf-snapshots')
        .upload(storagePath, bytes, {
          contentType: 'application/pdf',
          cacheControl: '31536000',
          upsert: false,
        });
      if (error) throw error;
      uploadedPaths.push(storagePath);
      snapshots.push({
        quote_id: version.id,
        quote_updated_at: version.updated_at,
        line_state: lineStateByQuoteId.get(version.id) || [],
        storage_path: storagePath,
        file_sha256: sha256,
        file_size: bytes.byteLength,
      });
    }
    return { snapshots, uploadedPaths };
  } catch (error) {
    await removeStagedSnapshots(admin, uploadedPaths);
    throw error;
  }
}

async function removeStagedSnapshots(admin: AdminClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from('quote-pdf-snapshots').remove(paths);
  if (error) {
    console.error('Unable to remove failed live quote merge PDF staging files:', error);
  }
}

function isMergeRpcResult(value: unknown): value is MergeRpcResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.merge_group_id === 'string'
    && typeof result.quote_id === 'string'
    && typeof result.quote_thread_id === 'string'
    && typeof result.canonical_reference === 'string'
    && Array.isArray(result.aliases)
    && (result.merge_mode === 'consolidated' || result.merge_mode === 'grouped')
  );
}

export async function mergeLiveQuotes(
  admin: AdminClient,
  body: Record<string, unknown>,
  actorUserId: string,
): Promise<QuoteMergeResult> {
  const input = normalizeQuoteMergeRequest(body);
  const { data: quoteRows, error: quoteError } = await admin
    .from('quotes')
    .select('*')
    .in('id', input.quote_ids);
  if (quoteError) throw quoteError;

  let quotes = (quoteRows || []) as QuoteRow[];
  if (quotes.length !== input.quote_ids.length) {
    throw new Error('One or more selected quotes no longer exist.');
  }
  const survivorCandidate = quotes.find(quote => quote.id === input.survivor_quote_id);
  if (!survivorCandidate) {
    throw new Error('The retained quote is no longer available.');
  }
  const [candidateContext] = await loadQuoteMergeContexts(
    admin,
    [survivorCandidate.quote_thread_id],
  );
  if (
    candidateContext
    && candidateContext.group.survivor_quote_thread_id === survivorCandidate.quote_thread_id
    && quotes.every(quote => (
      candidateContext.members.some(member => member.quote_thread_id === quote.quote_thread_id)
    ))
  ) {
    const { data: currentLatest, error: currentLatestError } = await admin
      .from('quotes')
      .select('id')
      .eq('quote_thread_id', candidateContext.group.survivor_quote_thread_id)
      .eq('is_latest_version', true)
      .single();
    if (currentLatestError || !currentLatest) {
      throw currentLatestError || new Error('Merged quote survivor not found');
    }
    return {
      merge_group_id: candidateContext.group.id,
      quote_id: currentLatest.id,
      quote_thread_id: candidateContext.group.survivor_quote_thread_id,
      canonical_reference: candidateContext.aliases[0]?.canonical_reference
        || survivorCandidate.base_quote_reference,
      aliases: Array.from(new Set(
        candidateContext.aliases.map(alias => alias.alias_reference),
      )).sort(),
      merge_mode: candidateContext.group.merge_mode,
    };
  }
  let survivor = ensureEligibleQuotes(quotes, input);
  const existingContext = candidateContext;
  if (existingContext) {
    if (existingContext.group.survivor_quote_thread_id !== survivor.quote_thread_id) {
      throw new Error('A retired quote cannot be used as the retained quote.');
    }
    if (existingContext.group.merge_mode !== input.merge_mode) {
      throw new Error(`This merge group already uses ${existingContext.group.merge_mode} document handling.`);
    }
    const existingThreadIds = existingContext.members.map(member => member.quote_thread_id);
    const { data: existingLatestRows, error: existingLatestError } = await admin
      .from('quotes')
      .select('*')
      .in('quote_thread_id', existingThreadIds)
      .eq('is_latest_version', true);
    if (existingLatestError) throw existingLatestError;
    const quoteByThreadId = new Map(
      [...(existingLatestRows || []), ...quotes].map(quote => [quote.quote_thread_id, quote as QuoteRow]),
    );
    quotes = Array.from(quoteByThreadId.values());
    input.quote_ids = quotes.map(quote => quote.id);
    survivor = ensureEligibleQuotes(quotes, input);
  }
  const threadIds = quotes.map(quote => quote.quote_thread_id);

  const existingThreadIdSet = new Set(existingContext?.members.map(member => member.quote_thread_id) || []);
  const lineQuoteIds = existingContext
    ? quotes
        .filter(quote => (
          quote.quote_thread_id === survivor.quote_thread_id
          || !existingThreadIdSet.has(quote.quote_thread_id)
        ))
        .map(quote => quote.id)
    : input.quote_ids;
  const [{ data: versionRows, error: versionError }, { data: lineRows, error: lineError }] = await Promise.all([
    admin.from('quotes').select('*').in('quote_thread_id', threadIds),
    admin.from('quote_line_items').select('*').in('quote_id', lineQuoteIds),
  ]);
  if (versionError) throw versionError;
  if (lineError) throw lineError;

  const versions = (versionRows || []) as QuoteRow[];
  const lines = (lineRows || []) as QuoteLineItemRow[];
  const { data: lineProvenanceRows, error: lineProvenanceError } = await admin
    .from('quote_line_item_merge_sources')
    .select('consolidated_line_item_id, source_quote_thread_id, source_quote_id, source_line_item_id, source_quote_reference')
    .in('consolidated_line_item_id', lines.map(line => line.id));
  if (lineProvenanceError) throw lineProvenanceError;
  const provenanceByLineId = new Map(
    (lineProvenanceRows || []).map(row => [row.consolidated_line_item_id, row]),
  );
  const { snapshots, uploadedPaths } = await stagePdfSnapshots(admin, versions, actorUserId);
  let rpcSubmitted = false;

  try {
    const consolidatedLines = input.merge_mode === 'consolidated'
      ? buildConsolidatedLines(quotes, lines, survivor.quote_thread_id, provenanceByLineId)
      : [];
    const totals = calculateQuoteTotals(consolidatedLines);
    const nextRevisionNumber = Math.max(
      0,
      ...versions
        .filter(version => version.quote_thread_id === survivor.quote_thread_id)
        .map(version => version.revision_number),
    ) + 1;
    const consolidatedQuote = input.merge_mode === 'consolidated'
      ? {
          id: randomUUID(),
          quote_reference: buildVersionReference(
            survivor.base_quote_reference,
            'revision',
            nextRevisionNumber,
          ),
          base_quote_reference: survivor.base_quote_reference,
          quote_thread_id: survivor.quote_thread_id,
          parent_quote_id: survivor.id,
          revision_number: nextRevisionNumber,
          version_label: buildVersionLabel('revision', nextRevisionNumber),
          version_notes: `Permanent merge of ${quotes.map(quote => quote.base_quote_reference).join(', ')}`,
          quote_date: new Date().toISOString().slice(0, 10),
          project_description: buildCombinedText(quotes, 'project_description'),
          scope: buildCombinedText(quotes, 'scope'),
          subtotal: totals.subtotal,
          total: totals.total,
        }
      : null;

    type MergeRpc = (
      name: 'merge_live_quotes',
      args: {
        p_quote_ids: string[];
        p_survivor_quote_id: string;
        p_merge_mode: string;
        p_consolidated_quote: Json;
        p_line_items: Json;
        p_snapshots: Json;
        p_actor_user_id: string;
      },
    ) => Promise<{ data: Json | null; error: { message: string } | null }>;
    const callMergeRpc = admin.rpc.bind(admin) as unknown as MergeRpc;
    rpcSubmitted = true;
    const { data, error } = await callMergeRpc('merge_live_quotes', {
      p_quote_ids: input.quote_ids,
      p_survivor_quote_id: input.survivor_quote_id,
      p_merge_mode: input.merge_mode,
      p_consolidated_quote: consolidatedQuote as Json,
      p_line_items: consolidatedLines as unknown as Json,
      p_snapshots: snapshots as unknown as Json,
      p_actor_user_id: actorUserId,
    });
    if (error) throw new Error(error.message);
    if (!isMergeRpcResult(data)) {
      throw new Error('The live quote merge returned an invalid result.');
    }
    const canonicalQuote = input.merge_mode === 'consolidated'
      ? {
          ...survivor,
          id: data.quote_id,
          quote_reference: consolidatedQuote?.quote_reference || survivor.quote_reference,
          base_quote_reference: data.canonical_reference,
          status: 'draft' as const,
        }
      : survivor;
    const inventoryResults = await Promise.allSettled([
      syncQuoteSiteLocation(admin, canonicalQuote, actorUserId),
      ...quotes
        .filter(quote => quote.id !== survivor.id)
        .map(quote => syncSiteLocation(admin, {
          sourceType: 'quote',
          sourceId: quote.id,
          externalReference: quote.base_quote_reference || quote.quote_reference,
          name: `Site - ${quote.base_quote_reference || quote.quote_reference}`,
          description: quote.site_address || quote.subject_line,
          isActive: false,
          actorUserId,
        })),
    ]);
    inventoryResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Live quote merge inventory sync failed:', result.reason);
      }
    });
    return data;
  } catch (error) {
    if (!rpcSubmitted) {
      await removeStagedSnapshots(admin, uploadedPaths);
    }
    throw error;
  }
}
