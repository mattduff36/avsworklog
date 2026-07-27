import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;
type QuotePurchaseOrderRow = Database['public']['Tables']['quote_purchase_orders']['Row'];
type QuotePurchaseOrderLineRow = Database['public']['Tables']['quote_purchase_order_lines']['Row'];
type QuoteLineItemRow = Database['public']['Tables']['quote_line_items']['Row'];

export interface QuotePurchaseOrderLineLink {
  id: string;
  quote_purchase_order_id: string;
  quote_line_item_id: string | null;
  created_at: string;
  description?: string | null;
  line_total?: number | null;
  sort_order?: number | null;
}

export interface QuotePurchaseOrderRecord extends QuotePurchaseOrderRow {
  po_value: number | null;
  lines: QuotePurchaseOrderLineLink[];
}

export interface QuotePoCoverageSummary {
  quoteTotal: number;
  poTotal: number;
  remaining: number;
  coveredLineCount: number;
  totalLineCount: number;
  purchaseOrderCount: number;
}

export function buildQuotePoCoverageSummary(input: {
  quoteTotal: number;
  lineItemIds: string[];
  purchaseOrders: Array<{ po_value: number | null; lines: Array<{ quote_line_item_id: string | null }> }>;
}): QuotePoCoverageSummary {
  const poTotal = input.purchaseOrders.reduce((sum, po) => sum + Number(po.po_value || 0), 0);
  const covered = new Set<string>();
  for (const po of input.purchaseOrders) {
    for (const line of po.lines) {
      if (line.quote_line_item_id) covered.add(line.quote_line_item_id);
    }
  }
  const totalLineCount = input.lineItemIds.length;
  const coveredLineCount = input.lineItemIds.filter(id => covered.has(id)).length;

  return {
    quoteTotal: Number(input.quoteTotal || 0),
    poTotal,
    remaining: Number(input.quoteTotal || 0) - poTotal,
    coveredLineCount,
    totalLineCount,
    purchaseOrderCount: input.purchaseOrders.length,
  };
}

export function computeQuotePoRollup(purchaseOrders: Array<{
  po_number: string;
  po_value: number | null;
  received_at: string;
  created_at: string;
}>): {
  po_number: string | null;
  po_value: number | null;
  po_received_at: string | null;
} {
  if (purchaseOrders.length === 0) {
    return {
      po_number: null,
      po_value: null,
      po_received_at: null,
    };
  }

  const sorted = [...purchaseOrders].sort((a, b) => {
    const receivedCompare = a.received_at.localeCompare(b.received_at);
    if (receivedCompare !== 0) return receivedCompare;
    return a.created_at.localeCompare(b.created_at);
  });

  const poValueSum = purchaseOrders.reduce((sum, po) => sum + Number(po.po_value || 0), 0);

  return {
    po_number: sorted[0]?.po_number || null,
    po_value: poValueSum,
    po_received_at: sorted[0]?.received_at || null,
  };
}

export function formatPurchaseOrderNumbersForEmail(
  purchaseOrders: Array<{ po_number: string; received_at: string; created_at: string }>
): string {
  if (purchaseOrders.length === 0) return 'Not supplied';
  const sorted = [...purchaseOrders].sort((a, b) => {
    const receivedCompare = a.received_at.localeCompare(b.received_at);
    if (receivedCompare !== 0) return receivedCompare;
    return a.created_at.localeCompare(b.created_at);
  });
  return sorted.map(po => po.po_number).join(', ');
}

export async function listQuotePurchaseOrders(
  supabase: AdminClient,
  quoteThreadId: string
): Promise<QuotePurchaseOrderRecord[]> {
  const { data: orders, error } = await supabase
    .from('quote_purchase_orders')
    .select('*')
    .eq('quote_thread_id', quoteThreadId)
    .order('received_at', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  const purchaseOrders = (orders || []) as QuotePurchaseOrderRow[];
  if (purchaseOrders.length === 0) return [];

  const orderIds = purchaseOrders.map(order => order.id);
  const { data: lineLinks, error: linesError } = await supabase
    .from('quote_purchase_order_lines')
    .select('*')
    .in('quote_purchase_order_id', orderIds);

  if (linesError) throw linesError;

  const links = (lineLinks || []) as QuotePurchaseOrderLineRow[];
  const lineItemIds = Array.from(
    new Set(links.map(link => link.quote_line_item_id).filter((id): id is string => Boolean(id)))
  );

  const lineItemsById = new Map<string, QuoteLineItemRow>();
  if (lineItemIds.length > 0) {
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('quote_line_items')
      .select('*')
      .in('id', lineItemIds);

    if (lineItemsError) throw lineItemsError;
    for (const item of (lineItems || []) as QuoteLineItemRow[]) {
      lineItemsById.set(item.id, item);
    }
  }

  const linksByOrder = new Map<string, QuotePurchaseOrderLineLink[]>();
  for (const link of links) {
    const item = link.quote_line_item_id ? lineItemsById.get(link.quote_line_item_id) : null;
    const list = linksByOrder.get(link.quote_purchase_order_id) || [];
    list.push({
      id: link.id,
      quote_purchase_order_id: link.quote_purchase_order_id,
      quote_line_item_id: link.quote_line_item_id,
      created_at: link.created_at,
      description: item?.description ?? null,
      line_total: item ? Number(item.line_total || 0) : null,
      sort_order: item?.sort_order ?? null,
    });
    linksByOrder.set(link.quote_purchase_order_id, list);
  }

  return purchaseOrders.map(order => ({
    ...order,
    po_value: order.po_value === null || order.po_value === undefined ? null : Number(order.po_value),
    lines: (linksByOrder.get(order.id) || []).sort((a, b) => {
      const sortA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const sortB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (sortA !== sortB) return sortA - sortB;
      return (a.description || '').localeCompare(b.description || '');
    }),
  }));
}

export async function syncQuotePoRollup(
  supabase: AdminClient,
  quoteThreadId: string,
  updatedBy?: string | null
): Promise<{
  po_number: string | null;
  po_value: number | null;
  po_received_at: string | null;
}> {
  const { data: orders, error } = await supabase
    .from('quote_purchase_orders')
    .select('po_number, po_value, received_at, created_at')
    .eq('quote_thread_id', quoteThreadId);

  if (error) throw error;

  const rollup = computeQuotePoRollup(
    ((orders || []) as Array<{
      po_number: string;
      po_value: number | null;
      received_at: string;
      created_at: string;
    }>).map(order => ({
      ...order,
      po_value: order.po_value === null || order.po_value === undefined ? null : Number(order.po_value),
    }))
  );

  const updatePayload: Database['public']['Tables']['quotes']['Update'] = {
    po_number: rollup.po_number,
    po_value: rollup.po_value,
    po_received_at: rollup.po_received_at,
  };
  if (updatedBy) {
    updatePayload.updated_by = updatedBy;
  }

  const { error: updateError } = await supabase
    .from('quotes')
    .update(updatePayload)
    .eq('quote_thread_id', quoteThreadId);

  if (updateError) throw updateError;
  return rollup;
}

export async function replacePurchaseOrderLineLinks(
  supabase: AdminClient,
  purchaseOrderId: string,
  lineItemIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(lineItemIds.filter(Boolean)));

  const { error: deleteError } = await supabase
    .from('quote_purchase_order_lines')
    .delete()
    .eq('quote_purchase_order_id', purchaseOrderId);

  if (deleteError) throw deleteError;

  if (uniqueIds.length === 0) return;

  const { error: insertError } = await supabase
    .from('quote_purchase_order_lines')
    .insert(
      uniqueIds.map(quoteLineItemId => ({
        quote_purchase_order_id: purchaseOrderId,
        quote_line_item_id: quoteLineItemId,
      }))
    );

  if (insertError) throw insertError;
}

export function mapLineItemIdsAcrossRevision(
  previousLines: Array<{ id: string; description: string | null; sort_order: number | null }>,
  nextLines: Array<{ id: string; description: string | null; sort_order: number | null }>,
  linkedPreviousIds: string[]
): string[] {
  const bySort = new Map<number, string>();
  const byDescription = new Map<string, string[]>();

  for (const line of nextLines) {
    if (typeof line.sort_order === 'number') {
      bySort.set(line.sort_order, line.id);
    }
    const key = (line.description || '').trim().toLowerCase();
    if (!key) continue;
    const list = byDescription.get(key) || [];
    list.push(line.id);
    byDescription.set(key, list);
  }

  const previousById = new Map(previousLines.map(line => [line.id, line]));
  const mapped: string[] = [];
  const usedNextIds = new Set<string>();

  for (const previousId of linkedPreviousIds) {
    const previous = previousById.get(previousId);
    if (!previous) continue;

    let nextId: string | null = null;
    if (typeof previous.sort_order === 'number') {
      const candidate = bySort.get(previous.sort_order) || null;
      if (candidate && !usedNextIds.has(candidate)) {
        nextId = candidate;
      }
    }

    if (!nextId) {
      const key = (previous.description || '').trim().toLowerCase();
      const candidates = key ? byDescription.get(key) || [] : [];
      nextId = candidates.find(id => !usedNextIds.has(id)) || null;
    }

    if (nextId) {
      usedNextIds.add(nextId);
      mapped.push(nextId);
    }
  }

  return mapped;
}

export async function remapPurchaseOrderLinesForRevision(
  supabase: AdminClient,
  input: {
    quoteThreadId: string;
    previousQuoteId: string;
    nextQuoteId: string;
    previousLineItems: Array<{ id: string; description: string | null; sort_order: number | null }>;
    nextLineItems: Array<{ id: string; description: string | null; sort_order: number | null }>;
  }
): Promise<void> {
  const purchaseOrders = await listQuotePurchaseOrders(supabase, input.quoteThreadId);
  if (purchaseOrders.length === 0) {
    await syncQuotePoRollup(supabase, input.quoteThreadId);
    return;
  }

  for (const order of purchaseOrders) {
    const previousLinkedIds = order.lines
      .map(line => line.quote_line_item_id)
      .filter((id): id is string => Boolean(id));
    const nextLinkedIds = mapLineItemIdsAcrossRevision(
      input.previousLineItems,
      input.nextLineItems,
      previousLinkedIds
    );

    await replacePurchaseOrderLineLinks(supabase, order.id, nextLinkedIds);

    const { error: updateError } = await supabase
      .from('quote_purchase_orders')
      .update({ quote_id: input.nextQuoteId })
      .eq('id', order.id);

    if (updateError) throw updateError;
  }

  await syncQuotePoRollup(supabase, input.quoteThreadId);
}
