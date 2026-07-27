import pg from 'pg';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';

const { Client } = pg;

type AdminClient = ReturnType<typeof createAdminClient>;
type QuotePurchaseOrderRow = Database['public']['Tables']['quote_purchase_orders']['Row'];
type QuotePurchaseOrderLineRow = Database['public']['Tables']['quote_purchase_order_lines']['Row'];
type QuoteLineItemRow = Database['public']['Tables']['quote_line_items']['Row'];

export interface QuotePurchaseOrderLineLink {
  id: string;
  quote_purchase_order_id: string;
  quote_line_item_id: string;
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

interface QuotePoMutationContext {
  quoteId: string;
  quoteThreadId: string;
  quoteReference: string;
  actorUserId: string;
}

export interface CreateQuotePurchaseOrderInput extends QuotePoMutationContext {
  poNumber: string;
  poValue: number | null;
  notes: string | null;
  receivedAt: string;
  lineItemIds: string[];
}

export interface UpdateQuotePurchaseOrderInput extends QuotePoMutationContext {
  purchaseOrderId: string;
  poNumber: string;
  poValue: number | null;
  notes: string | null;
  updatedAt: string;
  lineItemIds: string[];
}

export interface DeleteQuotePurchaseOrderInput extends QuotePoMutationContext {
  purchaseOrderId: string;
  deletedAt: string;
}

interface QuotePoPgResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface QuotePoPgClient {
  connect(): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<QuotePoPgResult<Row>>;
  end(): Promise<void>;
}

export type QuotePoPgClientFactory = () => QuotePoPgClient;

function createQuotePoPgClient(): QuotePoPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for quote purchase orders');
  }

  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as QuotePoPgClient;
}

async function withQuotePoTransaction<Result>(
  work: (client: QuotePoPgClient) => Promise<Result>,
  createClient: QuotePoPgClientFactory
): Promise<Result> {
  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function replacePurchaseOrderLineLinksInTransaction(
  client: QuotePoPgClient,
  purchaseOrderId: string,
  lineItemIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(lineItemIds.filter(Boolean)));
  await client.query(
    'DELETE FROM public.quote_purchase_order_lines WHERE quote_purchase_order_id = $1',
    [purchaseOrderId]
  );

  if (uniqueIds.length > 0) {
    await client.query(
      `
        INSERT INTO public.quote_purchase_order_lines (
          quote_purchase_order_id,
          quote_line_item_id
        )
        SELECT $1::uuid, line_item_id
        FROM unnest($2::uuid[]) AS line_item_id
      `,
      [purchaseOrderId, uniqueIds]
    );
  }
}

async function syncQuotePoRollupInTransaction(
  client: QuotePoPgClient,
  quoteThreadId: string,
  updatedBy?: string | null
): Promise<void> {
  await client.query(
    `
      WITH rollup AS (
        SELECT
          (ARRAY_AGG(po_number ORDER BY received_at ASC, created_at ASC))[1] AS po_number,
          SUM(po_value) AS po_value,
          MIN(received_at) AS po_received_at
        FROM public.quote_purchase_orders
        WHERE quote_thread_id = $1
      )
      UPDATE public.quotes q
      SET
        po_number = rollup.po_number,
        po_value = rollup.po_value,
        po_received_at = rollup.po_received_at,
        updated_by = COALESCE($2::uuid, q.updated_by)
      FROM rollup
      WHERE q.quote_thread_id = $1
    `,
    [quoteThreadId, updatedBy || null]
  );
}

async function appendPoTimelineEventInTransaction(
  client: QuotePoPgClient,
  input: QuotePoMutationContext & {
    title: string;
    description: string;
    createdAt: string;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO public.quote_timeline_events (
        quote_id,
        quote_thread_id,
        quote_reference,
        event_type,
        title,
        description,
        actor_user_id,
        created_at
      )
      VALUES ($1, $2, $3, 'po_details_saved', $4, $5, $6, $7)
    `,
    [
      input.quoteId,
      input.quoteThreadId,
      input.quoteReference,
      input.title,
      input.description,
      input.actorUserId,
      input.createdAt,
    ]
  );
}

export async function createQuotePurchaseOrderTransaction(
  input: CreateQuotePurchaseOrderInput,
  createClient: QuotePoPgClientFactory = createQuotePoPgClient
): Promise<string> {
  return withQuotePoTransaction(async client => {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO public.quote_purchase_orders (
          quote_thread_id,
          quote_id,
          po_number,
          po_value,
          received_at,
          notes,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        input.quoteThreadId,
        input.quoteId,
        input.poNumber,
        input.poValue,
        input.receivedAt,
        input.notes,
        input.actorUserId,
      ]
    );
    const purchaseOrderId = result.rows[0]?.id;
    if (!purchaseOrderId) {
      throw new Error('Unable to create purchase order');
    }

    await replacePurchaseOrderLineLinksInTransaction(client, purchaseOrderId, input.lineItemIds);
    await syncQuotePoRollupInTransaction(client, input.quoteThreadId, input.actorUserId);
    await appendPoTimelineEventInTransaction(client, {
      ...input,
      title: 'PO added',
      description: [
        `PO: ${input.poNumber}`,
        input.poValue !== null ? `Value: £${input.poValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : null,
        input.lineItemIds.length > 0 ? `Covers ${input.lineItemIds.length} quote line(s)` : null,
      ].filter(Boolean).join(' • '),
      createdAt: input.receivedAt,
    });

    return purchaseOrderId;
  }, createClient);
}

export async function updateQuotePurchaseOrderTransaction(
  input: UpdateQuotePurchaseOrderInput,
  createClient: QuotePoPgClientFactory = createQuotePoPgClient
): Promise<void> {
  await withQuotePoTransaction(async client => {
    const existing = await client.query<{ id: string }>(
      `
        SELECT id
        FROM public.quote_purchase_orders
        WHERE id = $1 AND quote_thread_id = $2
        FOR UPDATE
      `,
      [input.purchaseOrderId, input.quoteThreadId]
    );
    if (!existing.rows[0]) {
      throw new Error('Purchase order not found for this quote');
    }

    await client.query(
      `
        UPDATE public.quote_purchase_orders
        SET
          quote_id = $2,
          po_number = $3,
          po_value = $4,
          notes = $5,
          updated_at = $6
        WHERE id = $1
      `,
      [
        input.purchaseOrderId,
        input.quoteId,
        input.poNumber,
        input.poValue,
        input.notes,
        input.updatedAt,
      ]
    );
    await replacePurchaseOrderLineLinksInTransaction(
      client,
      input.purchaseOrderId,
      input.lineItemIds
    );
    await syncQuotePoRollupInTransaction(client, input.quoteThreadId, input.actorUserId);
    await appendPoTimelineEventInTransaction(client, {
      ...input,
      title: 'PO details updated',
      description: [
        `PO: ${input.poNumber}`,
        input.poValue !== null ? `Value: £${input.poValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : null,
      ].filter(Boolean).join(' • '),
      createdAt: input.updatedAt,
    });
  }, createClient);
}

export async function deleteQuotePurchaseOrderTransaction(
  input: DeleteQuotePurchaseOrderInput,
  createClient: QuotePoPgClientFactory = createQuotePoPgClient
): Promise<void> {
  await withQuotePoTransaction(async client => {
    const existing = await client.query<{
      id: string;
      po_number: string;
      po_value: string | number | null;
    }>(
      `
        SELECT id, po_number, po_value
        FROM public.quote_purchase_orders
        WHERE id = $1 AND quote_thread_id = $2
        FOR UPDATE
      `,
      [input.purchaseOrderId, input.quoteThreadId]
    );
    const purchaseOrder = existing.rows[0];
    if (!purchaseOrder) {
      throw new Error('Purchase order not found for this quote');
    }

    await client.query('DELETE FROM public.quote_purchase_orders WHERE id = $1', [
      input.purchaseOrderId,
    ]);
    await syncQuotePoRollupInTransaction(client, input.quoteThreadId, input.actorUserId);
    const poValue = purchaseOrder.po_value === null ? null : Number(purchaseOrder.po_value);
    await appendPoTimelineEventInTransaction(client, {
      ...input,
      title: 'PO removed',
      description: [
        `PO: ${purchaseOrder.po_number}`,
        poValue !== null ? `Value: £${poValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : null,
      ].filter(Boolean).join(' • '),
      createdAt: input.deletedAt,
    });
  }, createClient);
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

  const valuedPurchaseOrders = purchaseOrders.filter(po => po.po_value !== null);
  const poValueSum = valuedPurchaseOrders.length > 0
    ? valuedPurchaseOrders.reduce((sum, po) => sum + Number(po.po_value), 0)
    : null;

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
  },
  createClient: QuotePoPgClientFactory = createQuotePoPgClient
): Promise<void> {
  const purchaseOrders = await listQuotePurchaseOrders(supabase, input.quoteThreadId);
  if (purchaseOrders.length === 0) {
    await syncQuotePoRollup(supabase, input.quoteThreadId);
    return;
  }

  const remappedOrders = purchaseOrders.map(order => {
    const previousLinkedIds = order.lines
      .map(line => line.quote_line_item_id)
      .filter((id): id is string => Boolean(id));
    return {
      id: order.id,
      lineItemIds: mapLineItemIdsAcrossRevision(
        input.previousLineItems,
        input.nextLineItems,
        previousLinkedIds
      ),
    };
  });

  await withQuotePoTransaction(async client => {
    for (const order of remappedOrders) {
      await replacePurchaseOrderLineLinksInTransaction(client, order.id, order.lineItemIds);
      await client.query(
        'UPDATE public.quote_purchase_orders SET quote_id = $2 WHERE id = $1',
        [order.id, input.nextQuoteId]
      );
    }
    await syncQuotePoRollupInTransaction(client, input.quoteThreadId);
  }, createClient);
}
