import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;
type MergeGroupRow = Database['public']['Tables']['quote_merge_groups']['Row'];
type MergeMemberRow = Database['public']['Tables']['quote_merge_members']['Row'];
type AliasRow = Database['public']['Tables']['quote_reference_aliases']['Row'];
type SnapshotRow = Database['public']['Tables']['quote_pdf_snapshots']['Row'];

export interface QuoteMergeContext {
  group: MergeGroupRow;
  members: MergeMemberRow[];
  aliases: AliasRow[];
  snapshots: SnapshotRow[];
}

const MERGE_IN_FILTER_CHUNK_SIZE = 100;

async function loadMergeMembersByThreadIds(
  admin: AdminClient,
  threadIds: string[],
): Promise<MergeMemberRow[]> {
  const uniqueIds = Array.from(new Set(threadIds));
  const rows: MergeMemberRow[] = [];
  for (let index = 0; index < uniqueIds.length; index += MERGE_IN_FILTER_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + MERGE_IN_FILTER_CHUNK_SIZE);
    const { data, error } = await admin
      .from('quote_merge_members')
      .select('*')
      .in('quote_thread_id', chunk);
    if (error) throw error;
    if (data?.length) rows.push(...data);
  }
  return rows;
}

export async function loadQuoteMergeContexts(
  admin: AdminClient,
  threadIds?: string[],
): Promise<QuoteMergeContext[]> {
  let seedMembers: MergeMemberRow[];
  if (threadIds?.length) {
    seedMembers = await loadMergeMembersByThreadIds(admin, threadIds);
  } else {
    const { data, error } = await admin.from('quote_merge_members').select('*');
    if (error) throw error;
    seedMembers = data || [];
  }
  if (!seedMembers.length) return [];

  const groupIds = Array.from(new Set(seedMembers.map(member => member.merge_group_id)));
  const [{ data: groups, error: groupError }, { data: members, error: memberError }, { data: aliases, error: aliasError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    admin.from('quote_merge_groups').select('*').in('id', groupIds),
    admin.from('quote_merge_members').select('*').in('merge_group_id', groupIds),
    admin.from('quote_reference_aliases').select('*').in('merge_group_id', groupIds),
    admin.from('quote_pdf_snapshots').select('*').in('merge_group_id', groupIds),
  ]);
  if (groupError) throw groupError;
  if (memberError) throw memberError;
  if (aliasError) throw aliasError;
  if (snapshotError) throw snapshotError;

  const membersByGroup = new Map<string, MergeMemberRow[]>();
  const aliasesByGroup = new Map<string, AliasRow[]>();
  const snapshotsByGroup = new Map<string, SnapshotRow[]>();
  for (const member of members || []) {
    membersByGroup.set(member.merge_group_id, [
      ...(membersByGroup.get(member.merge_group_id) || []),
      member,
    ]);
  }
  for (const alias of aliases || []) {
    aliasesByGroup.set(alias.merge_group_id, [
      ...(aliasesByGroup.get(alias.merge_group_id) || []),
      alias,
    ]);
  }
  for (const snapshot of snapshots || []) {
    snapshotsByGroup.set(snapshot.merge_group_id, [
      ...(snapshotsByGroup.get(snapshot.merge_group_id) || []),
      snapshot,
    ]);
  }

  return (groups || []).map(group => ({
    group,
    members: membersByGroup.get(group.id) || [],
    aliases: aliasesByGroup.get(group.id) || [],
    snapshots: snapshotsByGroup.get(group.id) || [],
  }));
}

export function getMergeContextByThread(
  contexts: QuoteMergeContext[],
): Map<string, QuoteMergeContext> {
  const result = new Map<string, QuoteMergeContext>();
  for (const context of contexts) {
    for (const member of context.members) {
      result.set(member.quote_thread_id, context);
    }
  }
  return result;
}

export function getCanonicalThreadIds(
  contexts: QuoteMergeContext[],
  threadId: string,
): string[] {
  const context = contexts.find(candidate => (
    candidate.members.some(member => member.quote_thread_id === threadId)
  ));
  return context
    ? context.members.map(member => member.quote_thread_id)
    : [threadId];
}

export function serializeMergeContext(
  context: QuoteMergeContext,
) {
  return {
    id: context.group.id,
    survivor_quote_thread_id: context.group.survivor_quote_thread_id,
    merge_mode: context.group.merge_mode,
    merged_at: context.group.merged_at,
    canonical_reference: context.aliases[0]?.canonical_reference || null,
    members: context.members.map(member => ({
      quote_thread_id: member.quote_thread_id,
      source_latest_quote_id: member.source_latest_quote_id,
      base_quote_reference: member.base_quote_reference,
      is_survivor: member.is_survivor,
      merged_at: member.merged_at,
    })),
    aliases: Array.from(new Set(context.aliases.map(alias => alias.alias_reference))).sort(),
    pdf_snapshots: context.snapshots.map(snapshot => ({
      id: snapshot.id,
      quote_id: snapshot.quote_id,
      original_reference: snapshot.original_reference,
      version_label: snapshot.version_label,
      file_size: snapshot.file_size,
      created_at: snapshot.created_at,
    })),
  };
}

export async function resolveCanonicalQuoteId(
  admin: AdminClient,
  quoteId: string,
): Promise<string> {
  const { data: quote, error } = await admin
    .from('quotes')
    .select('id, quote_thread_id')
    .eq('id', quoteId)
    .maybeSingle();
  if (error) throw error;
  if (!quote) return quoteId;

  const [context] = await loadQuoteMergeContexts(admin, [quote.quote_thread_id]);
  if (!context || context.group.survivor_quote_thread_id === quote.quote_thread_id) {
    return quoteId;
  }

  const { data: canonical, error: canonicalError } = await admin
    .from('quotes')
    .select('id')
    .eq('quote_thread_id', context.group.survivor_quote_thread_id)
    .eq('is_latest_version', true)
    .single();
  if (canonicalError || !canonical) {
    throw canonicalError || new Error('Merged quote survivor not found');
  }
  return canonical.id;
}

export function allocateMergeBillingAmount(
  amount: number,
  sourceThreadIds: string[],
  capacities: Record<string, number>,
): Array<{ source_quote_thread_id: string; amount: number }> {
  let remaining = Math.round(amount * 100) / 100;
  const allocations: Array<{ source_quote_thread_id: string; amount: number }> = [];
  for (const threadId of sourceThreadIds) {
    if (remaining <= 0.005) break;
    const capacity = Math.max(0, Math.round(Number(capacities[threadId] || 0) * 100) / 100);
    const allocated = Math.min(remaining, capacity);
    if (allocated <= 0.005) continue;
    allocations.push({
      source_quote_thread_id: threadId,
      amount: Math.round(allocated * 100) / 100,
    });
    remaining = Math.round((remaining - allocated) * 100) / 100;
  }
  if (remaining > 0.005) {
    throw new Error('The selected merged quote sources do not have enough remaining balance.');
  }
  return allocations;
}
