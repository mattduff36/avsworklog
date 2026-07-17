import pg from 'pg';
import { createAdminClient } from '@/lib/supabase/admin';
import { FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH } from '@/app/(dashboard)/quotes/types';
import type {
  Quote,
  QuoteFinancialAdjustment,
  QuoteFinancialAdjustmentType,
  QuoteFinancialWorkspace,
  QuoteInvoice,
  QuoteInvoiceRequest,
  QuoteStatus,
} from '@/app/(dashboard)/quotes/types';
import {
  calculateQuoteFinancials,
  type FinancialQuoteVersion,
} from '@/lib/utils/quote-financial-adjustments';

const { Client } = pg;

const INVOICE_TARGET_TYPES = new Set<QuoteFinancialAdjustmentType>([
  'credit_note',
  'refund',
  'debit_adjustment',
  'invoice_metadata_correction',
  'invoice_void',
]);
const QUOTE_TARGET_TYPES = new Set<QuoteFinancialAdjustmentType>([
  'quote_value_adjustment',
  'write_off',
]);
const VALID_QUOTE_STATUSES = new Set<QuoteStatus>([
  'draft',
  'pending_internal_approval',
  'approved',
  'changes_requested',
  'sent',
  'won',
  'lost',
  'ready_to_invoice',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
  'closed',
]);

interface FinancialState {
  selectedQuote: Quote;
  versions: Quote[];
  invoices: QuoteInvoice[];
  requests: QuoteInvoiceRequest[];
  adjustments: QuoteFinancialAdjustment[];
}

export interface CreateFinancialAdjustmentInput {
  quote_id: string;
  invoice_id?: string | null;
  related_adjustment_id?: string | null;
  adjustment_type: Exclude<QuoteFinancialAdjustmentType, 'reversal'>;
  amount?: number;
  direction?: 'increase' | 'decrease' | null;
  effective_date: string;
  reason: string;
  notes?: string | null;
  external_reference?: string | null;
  metadata_after?: Record<string, unknown>;
  new_status?: QuoteStatus | null;
  confirm_variance?: boolean;
}

export interface ReverseFinancialAdjustmentInput {
  adjustment_id: string;
  effective_date: string;
  reason: string;
  notes?: string | null;
  new_status?: QuoteStatus | null;
  confirm_variance?: boolean;
}

export interface FinancialAdjustmentMutationResult {
  adjustment: QuoteFinancialAdjustment;
  workspace: QuoteFinancialWorkspace;
  cancelledRequests: QuoteInvoiceRequest[];
  statusFrom: QuoteStatus;
  statusTo: QuoteStatus;
}

export interface QuoteFinancialSearchResult {
  id: string;
  quote_thread_id: string;
  quote_reference: string;
  base_quote_reference: string;
  subject_line: string | null;
  status: QuoteStatus;
  is_latest_version: boolean;
  customer: {
    id: string;
    company_name: string;
  } | null;
}

function createPgClient(): pg.Client {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for financial adjustments');
  }

  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
}

function normalizeQuote(row: Record<string, unknown>): Quote {
  return {
    ...row,
    subtotal: Number(row.subtotal || 0),
    total: Number(row.total || 0),
    revision_number: Number(row.revision_number || 0),
  } as unknown as Quote;
}

function normalizeInvoice(row: Record<string, unknown>): QuoteInvoice {
  return {
    ...row,
    amount: Number(row.amount || 0),
  } as unknown as QuoteInvoice;
}

function normalizeRequest(row: Record<string, unknown>): QuoteInvoiceRequest {
  return {
    ...row,
    requested_amount: Number(row.requested_amount || 0),
  } as unknown as QuoteInvoiceRequest;
}

function normalizeAdjustment(
  row: Record<string, unknown>,
): QuoteFinancialAdjustment {
  return {
    ...row,
    amount: Number(row.amount || 0),
    metadata_before:
      row.metadata_before && typeof row.metadata_before === 'object'
        ? (row.metadata_before as Record<string, unknown>)
        : {},
    metadata_after:
      row.metadata_after && typeof row.metadata_after === 'object'
        ? (row.metadata_after as Record<string, unknown>)
        : {},
    document_snapshot:
      row.document_snapshot && typeof row.document_snapshot === 'object'
        ? (row.document_snapshot as Record<string, unknown>)
        : {},
  } as unknown as QuoteFinancialAdjustment;
}

function quoteVersionsForCalculation(versions: Quote[]): FinancialQuoteVersion[] {
  return versions.map((version) => ({
    id: version.id,
    quote_thread_id: version.quote_thread_id,
    total: Number(version.total || 0),
    revision_type: version.revision_type,
    revision_number: Number(version.revision_number || 0),
    created_at: version.created_at,
  }));
}

function buildWorkspace(
  state: FinancialState,
  canManage: boolean,
): QuoteFinancialWorkspace {
  const calculated = calculateQuoteFinancials({
    versions: quoteVersionsForCalculation(state.versions),
    invoices: state.invoices,
    requests: state.requests,
    adjustments: state.adjustments,
  });

  const selectedVersion =
    state.versions.find((version) => version.id === state.selectedQuote.id) ||
    state.selectedQuote;

  return {
    quote_thread_id: state.selectedQuote.quote_thread_id,
    quote: {
      ...selectedVersion,
      customer: state.selectedQuote.customer,
      financial_summary: calculated.threadSummary,
    },
    versions: state.versions.map((version) => ({
      ...version,
      financial_summary: calculated.threadSummary,
    })),
    invoices: calculated.effectiveInvoices,
    invoice_requests: state.requests,
    adjustments: calculated.adjustments,
    version_summaries: calculated.versionSummaries,
    thread_summary: calculated.threadSummary,
    can_manage: canManage,
  };
}

export async function fetchQuoteFinancialWorkspace(
  quoteId: string,
  canManage: boolean,
): Promise<QuoteFinancialWorkspace> {
  const admin = createAdminClient();
  const { data: selectedQuote, error: quoteError } = await admin
    .from('quotes')
    .select(`
      *,
      customer:customers(id, company_name, short_name, contact_name, contact_email, address_line_1, address_line_2, city, county, postcode)
    `)
    .eq('id', quoteId)
    .single();

  if (quoteError || !selectedQuote) {
    throw quoteError || new Error('Quote not found');
  }

  const normalizedSelected = normalizeQuote(
    selectedQuote as unknown as Record<string, unknown>,
  );
  const { data: versions, error: versionsError } = await admin
    .from('quotes')
    .select('*')
    .eq('quote_thread_id', normalizedSelected.quote_thread_id)
    .order('created_at', { ascending: true });

  if (versionsError) throw versionsError;

  const normalizedVersions = (versions || []).map((row) =>
    normalizeQuote(row as Record<string, unknown>),
  );
  const versionIds = normalizedVersions.map((version) => version.id);
  const [invoiceResult, requestResult, adjustmentResult] = await Promise.all([
    admin
      .from('quote_invoices')
      .select('*')
      .in('quote_id', versionIds)
      .order('invoice_date', { ascending: false }),
    admin
      .from('quote_invoice_requests')
      .select('*')
      .in('quote_id', versionIds)
      .order('requested_at', { ascending: false }),
    admin
      .from('quote_financial_adjustments')
      .select('*, actor:profiles!quote_financial_adjustments_created_by_fkey(id, full_name)')
      .eq('quote_thread_id', normalizedSelected.quote_thread_id)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);

  if (invoiceResult.error) throw invoiceResult.error;
  if (requestResult.error) throw requestResult.error;
  if (adjustmentResult.error) throw adjustmentResult.error;

  return buildWorkspace(
    {
      selectedQuote: normalizedSelected,
      versions: normalizedVersions,
      invoices: (invoiceResult.data || []).map((row) =>
        normalizeInvoice(row as Record<string, unknown>),
      ),
      requests: (requestResult.data || []).map((row) =>
        normalizeRequest(row as Record<string, unknown>),
      ),
      adjustments: (adjustmentResult.data || []).map((row) =>
        normalizeAdjustment(row as Record<string, unknown>),
      ),
    },
    canManage,
  );
}

export async function searchQuoteFinancialRecords(
  rawTerm: string,
): Promise<QuoteFinancialSearchResult[]> {
  const term = rawTerm.trim();
  if (term.length < FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH) {
    throw new Error(
      `Enter at least ${FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH} characters to search the financial adjustment ledger.`,
    );
  }

  const escapedTerm = term.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escapedTerm}%`;
  const client = createPgClient();
  await client.connect();

  try {
    const result = await client.query<
      QuoteFinancialSearchResult & { updated_at: string }
    >(
      `
        WITH matching_threads AS (
          SELECT DISTINCT q.quote_thread_id
          FROM public.quotes q
          LEFT JOIN public.customers c ON c.id = q.customer_id
          WHERE q.status <> 'draft'
            AND (
              q.quote_reference ILIKE $1
              OR q.base_quote_reference ILIKE $1
              OR q.subject_line ILIKE $1
              OR c.company_name ILIKE $1
              OR EXISTS (
                SELECT 1
                FROM public.quote_invoices i
                WHERE i.quote_id = q.id
                  AND i.invoice_number ILIKE $1
              )
              OR EXISTS (
                SELECT 1
                FROM public.quote_financial_adjustments a
                WHERE a.quote_thread_id = q.quote_thread_id
                  AND (
                    a.adjustment_number ILIKE $1
                    OR a.external_reference ILIKE $1
                    OR a.metadata_after->>'invoice_number' ILIKE $1
                  )
              )
            )
        )
        SELECT *
        FROM (
          SELECT DISTINCT ON (q.quote_thread_id)
            q.id,
            q.quote_thread_id,
            q.quote_reference,
            q.base_quote_reference,
            q.subject_line,
            q.status,
            q.is_latest_version,
            q.updated_at,
            CASE
              WHEN c.id IS NULL THEN NULL
              ELSE jsonb_build_object('id', c.id, 'company_name', c.company_name)
            END AS customer
          FROM public.quotes q
          INNER JOIN matching_threads matches
            ON matches.quote_thread_id = q.quote_thread_id
          LEFT JOIN public.customers c ON c.id = q.customer_id
          WHERE q.status <> 'draft'
          ORDER BY
            q.quote_thread_id,
            q.is_latest_version DESC,
            q.updated_at DESC
        ) unique_threads
        ORDER BY updated_at DESC
      `,
      [pattern],
    );

    return result.rows.map((row) => ({
      id: row.id,
      quote_thread_id: row.quote_thread_id,
      quote_reference: row.quote_reference,
      base_quote_reference: row.base_quote_reference,
      subject_line: row.subject_line,
      status: row.status,
      is_latest_version: row.is_latest_version,
      customer: row.customer,
    }));
  } finally {
    await client.end();
  }
}

async function loadFinancialStateWithPg(
  client: pg.Client,
  quoteId: string,
): Promise<FinancialState> {
  const quoteResult = await client.query<Record<string, unknown>>(
    `
      SELECT q.*, row_to_json(c.*) AS customer
      FROM public.quotes q
      LEFT JOIN public.customers c ON c.id = q.customer_id
      WHERE q.id = $1
    `,
    [quoteId],
  );
  if (!quoteResult.rows[0]) throw new Error('Quote not found');

  const selectedQuote = normalizeQuote(quoteResult.rows[0]);
  await client.query(
    'SELECT id FROM public.quotes WHERE quote_thread_id = $1 FOR UPDATE',
    [selectedQuote.quote_thread_id],
  );

  const [versionsResult, invoicesResult, requestsResult, adjustmentsResult] =
    await Promise.all([
      client.query<Record<string, unknown>>(
        'SELECT * FROM public.quotes WHERE quote_thread_id = $1 ORDER BY created_at',
        [selectedQuote.quote_thread_id],
      ),
      client.query<Record<string, unknown>>(
        `
          SELECT i.*
          FROM public.quote_invoices i
          JOIN public.quotes q ON q.id = i.quote_id
          WHERE q.quote_thread_id = $1
          ORDER BY i.invoice_date DESC, i.created_at DESC
        `,
        [selectedQuote.quote_thread_id],
      ),
      client.query<Record<string, unknown>>(
        `
          SELECT r.*
          FROM public.quote_invoice_requests r
          JOIN public.quotes q ON q.id = r.quote_id
          WHERE q.quote_thread_id = $1
          ORDER BY r.requested_at DESC
        `,
        [selectedQuote.quote_thread_id],
      ),
      client.query<Record<string, unknown>>(
        `
          SELECT *
          FROM public.quote_financial_adjustments
          WHERE quote_thread_id = $1
          ORDER BY effective_date, created_at
        `,
        [selectedQuote.quote_thread_id],
      ),
    ]);

  return {
    selectedQuote,
    versions: versionsResult.rows.map(normalizeQuote),
    invoices: invoicesResult.rows.map(normalizeInvoice),
    requests: requestsResult.rows.map(normalizeRequest),
    adjustments: adjustmentsResult.rows.map(normalizeAdjustment),
  };
}

function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Enter a valid effective date.');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (value > today) {
    throw new Error('The effective date cannot be in the future.');
  }
  return value;
}

function validateStatus(value: QuoteStatus | null | undefined): QuoteStatus | null {
  if (!value) return null;
  if (!VALID_QUOTE_STATUSES.has(value)) {
    throw new Error('Select a valid quote status.');
  }
  return value;
}

function cleanMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!value) return {};
  const result: Record<string, unknown> = {};
  if (typeof value.invoice_number === 'string' && value.invoice_number.trim()) {
    result.invoice_number = value.invoice_number.trim();
  }
  if (
    typeof value.invoice_date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.invoice_date)
  ) {
    result.invoice_date = value.invoice_date;
  }
  if (value.invoice_scope === 'full' || value.invoice_scope === 'partial') {
    result.invoice_scope = value.invoice_scope;
  }
  if (typeof value.comments === 'string' || value.comments === null) {
    result.comments =
      typeof value.comments === 'string' ? value.comments.trim() || null : null;
  }
  return result;
}

async function cancelExcessPendingRequests(
  client: pg.Client,
  state: FinancialState,
) {
  const calculated = calculateQuoteFinancials({
    versions: quoteVersionsForCalculation(state.versions),
    invoices: state.invoices,
    requests: state.requests,
    adjustments: state.adjustments,
  });
  const capacity = Math.max(0, calculated.threadSummary.remaining_to_invoice);
  const pending = state.requests
    .filter((request) => request.status === 'pending')
    .sort((left, right) => right.requested_at.localeCompare(left.requested_at));
  let pendingTotal = pending.reduce(
    (sum, request) => sum + Number(request.requested_amount || 0),
    0,
  );
  const cancelledIds: string[] = [];

  for (const request of pending) {
    if (pendingTotal <= capacity + 0.005) break;
    cancelledIds.push(request.id);
    pendingTotal -= Number(request.requested_amount || 0);
  }

  if (cancelledIds.length === 0) return [];

  const result = await client.query<Record<string, unknown>>(
    `
      UPDATE public.quote_invoice_requests
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ANY($1::UUID[])
        AND status = 'pending'
      RETURNING *
    `,
    [cancelledIds],
  );
  const cancelled = result.rows.map(normalizeRequest);
  const cancelledSet = new Set(cancelled.map((request) => request.id));
  state.requests = state.requests.map((request) =>
    cancelledSet.has(request.id) ? { ...request, status: 'cancelled' } : request,
  );
  return cancelled;
}

function projectedWorkspace(
  state: FinancialState,
  adjustment: QuoteFinancialAdjustment,
) {
  return buildWorkspace(
    { ...state, adjustments: [...state.adjustments, adjustment] },
    true,
  );
}

function validateVariance(
  workspace: QuoteFinancialWorkspace,
  confirmed: boolean | undefined,
) {
  if (workspace.thread_summary.has_variance && !confirmed) {
    const error = new Error(
      'This entry creates a reconciliation variance. Confirm the variance to continue.',
    );
    Object.assign(error, {
      code: 'VARIANCE_CONFIRMATION_REQUIRED',
      financial_summary: workspace.thread_summary,
    });
    throw error;
  }
}

export async function createFinancialAdjustment(
  input: CreateFinancialAdjustmentInput,
  actorUserId: string,
): Promise<FinancialAdjustmentMutationResult> {
  const client = createPgClient();
  await client.connect();

  try {
    await client.query('BEGIN');
    const state = await loadFinancialStateWithPg(client, input.quote_id);
    if (state.selectedQuote.status === 'draft') {
      throw new Error('Draft quotes should be corrected using normal quote editing.');
    }

    const reason = input.reason?.trim();
    if (!reason) throw new Error('Enter a reason for this adjustment.');
    const effectiveDate = validateDate(input.effective_date);
    const newStatus = validateStatus(input.new_status);
    const invoice = input.invoice_id
      ? state.invoices.find((candidate) => candidate.id === input.invoice_id)
      : null;

    if (INVOICE_TARGET_TYPES.has(input.adjustment_type) && !invoice) {
      throw new Error('Select an invoice for this adjustment type.');
    }
    if (invoice && invoice.quote_id !== input.quote_id) {
      throw new Error('The selected invoice does not belong to this quote version.');
    }
    if (QUOTE_TARGET_TYPES.has(input.adjustment_type) && input.invoice_id) {
      throw new Error('This adjustment type must target the quote version.');
    }

    const metadataAfter =
      input.adjustment_type === 'invoice_metadata_correction'
        ? cleanMetadata(input.metadata_after)
        : {};
    if (
      input.adjustment_type === 'invoice_metadata_correction' &&
      Object.keys(metadataAfter).length === 0
    ) {
      throw new Error('Enter at least one corrected invoice field.');
    }

    const beforeCalculation = calculateQuoteFinancials({
      versions: quoteVersionsForCalculation(state.versions),
      invoices: state.invoices,
      requests: state.requests,
      adjustments: state.adjustments,
    });
    const effectiveInvoice = invoice
      ? beforeCalculation.effectiveInvoices.find(
          (candidate) => candidate.id === invoice.id,
        )
      : null;
    let amount =
      input.adjustment_type === 'invoice_metadata_correction'
        ? 0
        : Number(input.amount || 0);
    if (input.adjustment_type === 'invoice_void') {
      amount = Number(effectiveInvoice?.net_invoiced || 0);
    }
    if (
      input.adjustment_type !== 'invoice_metadata_correction' &&
      (!Number.isFinite(amount) || amount <= 0)
    ) {
      throw new Error('Enter an amount greater than zero.');
    }
    if (
      input.adjustment_type === 'quote_value_adjustment' &&
      !['increase', 'decrease'].includes(input.direction || '')
    ) {
      throw new Error('Choose whether the quote value increases or decreases.');
    }

    if (input.adjustment_type === 'refund') {
      const related = state.adjustments.find(
        (adjustment) => adjustment.id === input.related_adjustment_id,
      );
      const isReversed = state.adjustments.some(
        (adjustment) => adjustment.reverses_adjustment_id === related?.id,
      );
      if (
        !related ||
        isReversed ||
        !['credit_note', 'invoice_void'].includes(related.adjustment_type) ||
        related.invoice_id !== invoice?.id
      ) {
        throw new Error(
          'Select an active credit note or invoice void for this refund.',
        );
      }
    }

    const metadataBefore = effectiveInvoice
      ? {
          invoice_number: effectiveInvoice.effective_invoice_number,
          invoice_date: effectiveInvoice.effective_invoice_date,
          invoice_scope: effectiveInvoice.effective_invoice_scope,
          comments: effectiveInvoice.effective_comments,
        }
      : {};
    const temporaryAdjustment: QuoteFinancialAdjustment = {
      id: crypto.randomUUID(),
      adjustment_number: 'PENDING',
      quote_thread_id: state.selectedQuote.quote_thread_id,
      quote_id: input.quote_id,
      invoice_id: invoice?.id || null,
      related_adjustment_id: input.related_adjustment_id || null,
      reverses_adjustment_id: null,
      adjustment_type: input.adjustment_type,
      amount,
      direction:
        input.adjustment_type === 'quote_value_adjustment'
          ? input.direction || null
          : null,
      effective_date: effectiveDate,
      reason,
      notes: input.notes?.trim() || null,
      external_reference: input.external_reference?.trim() || null,
      metadata_before: metadataBefore,
      metadata_after: metadataAfter,
      document_snapshot: {},
      created_by: actorUserId,
      created_at: new Date().toISOString(),
    };
    const projected = projectedWorkspace(state, temporaryAdjustment);
    validateVariance(projected, input.confirm_variance);

    const documentSnapshot = {
      quote_reference: state.selectedQuote.quote_reference,
      base_quote_reference: state.selectedQuote.base_quote_reference,
      customer: state.selectedQuote.customer || null,
      invoice: effectiveInvoice || null,
      adjustment_type: input.adjustment_type,
      amount,
      direction: temporaryAdjustment.direction,
      effective_date: effectiveDate,
      reason,
      notes: temporaryAdjustment.notes,
      external_reference: temporaryAdjustment.external_reference,
      before_summary: beforeCalculation.threadSummary,
      after_summary: projected.thread_summary,
      metadata_before: metadataBefore,
      metadata_after: metadataAfter,
      created_by: actorUserId,
      created_at: temporaryAdjustment.created_at,
    };
    const insertResult = await client.query<Record<string, unknown>>(
      `
        INSERT INTO public.quote_financial_adjustments (
          quote_thread_id,
          quote_id,
          invoice_id,
          related_adjustment_id,
          adjustment_type,
          amount,
          direction,
          effective_date,
          reason,
          notes,
          external_reference,
          metadata_before,
          metadata_after,
          document_snapshot,
          created_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::JSONB, $13::JSONB, $14::JSONB, $15
        )
        RETURNING *
      `,
      [
        state.selectedQuote.quote_thread_id,
        input.quote_id,
        invoice?.id || null,
        input.related_adjustment_id || null,
        input.adjustment_type,
        amount,
        temporaryAdjustment.direction,
        effectiveDate,
        reason,
        temporaryAdjustment.notes,
        temporaryAdjustment.external_reference,
        JSON.stringify(metadataBefore),
        JSON.stringify(metadataAfter),
        JSON.stringify(documentSnapshot),
        actorUserId,
      ],
    );
    const adjustment = normalizeAdjustment(insertResult.rows[0]);
    state.adjustments.push(adjustment);
    const cancelledRequests = await cancelExcessPendingRequests(client, state);
    const statusFrom = state.selectedQuote.status;
    const statusTo = newStatus || statusFrom;

    if (newStatus && newStatus !== statusFrom) {
      await client.query(
        `
          UPDATE public.quotes
          SET status = $1, updated_by = $2, updated_at = NOW()
          WHERE id = $3
        `,
        [newStatus, actorUserId, input.quote_id],
      );
      state.selectedQuote = { ...state.selectedQuote, status: newStatus };
      state.versions = state.versions.map((version) =>
        version.id === input.quote_id ? { ...version, status: newStatus } : version,
      );
    }

    await client.query('COMMIT');
    return {
      adjustment,
      workspace: buildWorkspace(state, true),
      cancelledRequests,
      statusFrom,
      statusTo,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

export async function reverseFinancialAdjustment(
  input: ReverseFinancialAdjustmentInput,
  actorUserId: string,
): Promise<FinancialAdjustmentMutationResult> {
  const client = createPgClient();
  await client.connect();

  try {
    await client.query('BEGIN');
    const targetResult = await client.query<Record<string, unknown>>(
      'SELECT * FROM public.quote_financial_adjustments WHERE id = $1',
      [input.adjustment_id],
    );
    if (!targetResult.rows[0]) throw new Error('Adjustment not found.');
    const target = normalizeAdjustment(targetResult.rows[0]);
    if (target.adjustment_type === 'reversal') {
      throw new Error('A reversal cannot itself be reversed.');
    }
    const state = await loadFinancialStateWithPg(client, target.quote_id);
    if (
      state.adjustments.some(
        (adjustment) => adjustment.reverses_adjustment_id === target.id,
      )
    ) {
      throw new Error('This adjustment has already been reversed.');
    }

    const reason = input.reason?.trim();
    if (!reason) throw new Error('Enter a reason for this reversal.');
    const effectiveDate = validateDate(input.effective_date);
    const newStatus = validateStatus(input.new_status);
    const temporaryReversal: QuoteFinancialAdjustment = {
      ...target,
      id: crypto.randomUUID(),
      adjustment_number: 'PENDING',
      adjustment_type: 'reversal',
      related_adjustment_id: null,
      reverses_adjustment_id: target.id,
      direction: null,
      effective_date: effectiveDate,
      reason,
      notes: input.notes?.trim() || null,
      external_reference: null,
      metadata_before: target.metadata_after,
      metadata_after: target.metadata_before,
      document_snapshot: {},
      created_by: actorUserId,
      created_at: new Date().toISOString(),
    };
    const projected = projectedWorkspace(state, temporaryReversal);
    validateVariance(projected, input.confirm_variance);
    const documentSnapshot = {
      quote_reference: state.selectedQuote.quote_reference,
      base_quote_reference: state.selectedQuote.base_quote_reference,
      customer: state.selectedQuote.customer || null,
      adjustment_type: 'reversal',
      reverses_adjustment_number: target.adjustment_number,
      amount: target.amount,
      effective_date: effectiveDate,
      reason,
      notes: temporaryReversal.notes,
      after_summary: projected.thread_summary,
      created_by: actorUserId,
      created_at: temporaryReversal.created_at,
    };
    const insertResult = await client.query<Record<string, unknown>>(
      `
        INSERT INTO public.quote_financial_adjustments (
          quote_thread_id,
          quote_id,
          invoice_id,
          reverses_adjustment_id,
          adjustment_type,
          amount,
          effective_date,
          reason,
          notes,
          metadata_before,
          metadata_after,
          document_snapshot,
          created_by
        )
        VALUES (
          $1, $2, $3, $4, 'reversal', $5, $6, $7, $8,
          $9::JSONB, $10::JSONB, $11::JSONB, $12
        )
        RETURNING *
      `,
      [
        target.quote_thread_id,
        target.quote_id,
        target.invoice_id,
        target.id,
        target.amount,
        effectiveDate,
        reason,
        temporaryReversal.notes,
        JSON.stringify(temporaryReversal.metadata_before),
        JSON.stringify(temporaryReversal.metadata_after),
        JSON.stringify(documentSnapshot),
        actorUserId,
      ],
    );
    const adjustment = normalizeAdjustment(insertResult.rows[0]);
    state.adjustments.push(adjustment);
    const cancelledRequests = await cancelExcessPendingRequests(client, state);
    const statusFrom = state.selectedQuote.status;
    const statusTo = newStatus || statusFrom;

    if (newStatus && newStatus !== statusFrom) {
      await client.query(
        `
          UPDATE public.quotes
          SET status = $1, updated_by = $2, updated_at = NOW()
          WHERE id = $3
        `,
        [newStatus, actorUserId, target.quote_id],
      );
      state.selectedQuote = { ...state.selectedQuote, status: newStatus };
      state.versions = state.versions.map((version) =>
        version.id === target.quote_id ? { ...version, status: newStatus } : version,
      );
    }

    await client.query('COMMIT');
    return {
      adjustment,
      workspace: buildWorkspace(state, true),
      cancelledRequests,
      statusFrom,
      statusTo,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
