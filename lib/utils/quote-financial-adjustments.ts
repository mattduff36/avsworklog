import type {
  QuoteEffectiveInvoice,
  QuoteFinancialAdjustment,
  QuoteInvoice,
  QuoteInvoiceRequest,
  QuoteThreadFinancialSummary,
  QuoteVersionFinancialSummary,
} from '@/app/(dashboard)/quotes/types';

export interface FinancialQuoteVersion {
  id: string;
  quote_thread_id: string;
  total: number;
  revision_type: string;
  revision_number: number;
  created_at: string | null;
}

export interface QuoteFinancialCalculation {
  adjustments: QuoteFinancialAdjustment[];
  effectiveInvoices: QuoteEffectiveInvoice[];
  versionSummaries: Record<string, QuoteVersionFinancialSummary>;
  threadSummary: QuoteThreadFinancialSummary;
}

const MONEY_EPSILON = 0.005;
const ADDITIVE_REVISION_TYPES = new Set(['extra', 'variation', 'future_work']);

export function roundCurrency(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function getActiveFinancialAdjustments(
  adjustments: QuoteFinancialAdjustment[],
): QuoteFinancialAdjustment[] {
  const reversedIds = new Set(
    adjustments
      .filter((adjustment) => adjustment.adjustment_type === 'reversal')
      .map((adjustment) => adjustment.reverses_adjustment_id)
      .filter((id): id is string => Boolean(id)),
  );

  return adjustments
    .map((adjustment) => ({
      ...adjustment,
      is_reversed: reversedIds.has(adjustment.id),
    }))
    .filter(
      (adjustment) =>
        adjustment.adjustment_type !== 'reversal' && !adjustment.is_reversed,
    );
}

function adjustmentAmount(
  adjustments: QuoteFinancialAdjustment[],
  type: QuoteFinancialAdjustment['adjustment_type'],
): number {
  return roundCurrency(
    adjustments
      .filter((adjustment) => adjustment.adjustment_type === type)
      .reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0),
  );
}

function quoteValueDelta(adjustments: QuoteFinancialAdjustment[]): number {
  return roundCurrency(
    adjustments
      .filter((adjustment) => adjustment.adjustment_type === 'quote_value_adjustment')
      .reduce(
        (sum, adjustment) =>
          sum +
          (adjustment.direction === 'decrease' ? -1 : 1) *
            Number(adjustment.amount || 0),
        0,
      ),
  );
}

function asInvoiceScope(value: unknown, fallback: 'full' | 'partial') {
  return value === 'full' || value === 'partial' ? value : fallback;
}

export function buildEffectiveInvoices(
  invoices: QuoteInvoice[],
  adjustments: QuoteFinancialAdjustment[],
): QuoteEffectiveInvoice[] {
  const active = getActiveFinancialAdjustments(adjustments);

  return invoices.map((invoice) => {
    const invoiceAdjustments = active
      .filter((adjustment) => adjustment.invoice_id === invoice.id)
      .sort((left, right) =>
        `${left.effective_date}:${left.created_at}`.localeCompare(
          `${right.effective_date}:${right.created_at}`,
        ),
      );
    const metadataCorrections = invoiceAdjustments.filter(
      (adjustment) => adjustment.adjustment_type === 'invoice_metadata_correction',
    );
    const effectiveMetadata = metadataCorrections.reduce<Record<string, unknown>>(
      (current, adjustment) => ({ ...current, ...adjustment.metadata_after }),
      {},
    );
    const creditsTotal = adjustmentAmount(invoiceAdjustments, 'credit_note');
    const debitsTotal = adjustmentAmount(invoiceAdjustments, 'debit_adjustment');
    const voidsTotal = adjustmentAmount(invoiceAdjustments, 'invoice_void');
    const refundsTotal = adjustmentAmount(invoiceAdjustments, 'refund');

    return {
      ...invoice,
      effective_invoice_number:
        typeof effectiveMetadata.invoice_number === 'string'
          ? effectiveMetadata.invoice_number
          : invoice.invoice_number,
      effective_invoice_date:
        typeof effectiveMetadata.invoice_date === 'string'
          ? effectiveMetadata.invoice_date
          : invoice.invoice_date,
      effective_invoice_scope: asInvoiceScope(
        effectiveMetadata.invoice_scope,
        invoice.invoice_scope,
      ),
      effective_comments:
        typeof effectiveMetadata.comments === 'string' ||
        effectiveMetadata.comments === null
          ? (effectiveMetadata.comments as string | null)
          : invoice.comments,
      credits_total: creditsTotal,
      debits_total: debitsTotal,
      voids_total: voidsTotal,
      refunds_total: refundsTotal,
      net_invoiced: roundCurrency(
        Number(invoice.amount || 0) + debitsTotal - creditsTotal - voidsTotal,
      ),
      is_voided: voidsTotal > 0,
    };
  });
}

function buildVersionSummary(input: {
  version: FinancialQuoteVersion;
  invoices: QuoteEffectiveInvoice[];
  requests: QuoteInvoiceRequest[];
  adjustments: QuoteFinancialAdjustment[];
}): QuoteVersionFinancialSummary {
  const versionAdjustments = input.adjustments.filter(
    (adjustment) => adjustment.quote_id === input.version.id,
  );
  const versionInvoices = input.invoices.filter(
    (invoice) => invoice.quote_id === input.version.id,
  );
  const pendingRequestedTotal = roundCurrency(
    input.requests
      .filter(
        (request) =>
          request.quote_id === input.version.id && request.status === 'pending',
      )
      .reduce((sum, request) => sum + Number(request.requested_amount || 0), 0),
  );
  const originalQuoteValue = roundCurrency(Number(input.version.total || 0));
  const quoteAdjustments = quoteValueDelta(versionAdjustments);
  const adjustedQuoteValue = roundCurrency(
    originalQuoteValue + quoteAdjustments,
  );
  const grossInvoiced = roundCurrency(
    versionInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.amount || 0),
      0,
    ),
  );
  const creditsTotal = roundCurrency(
    versionInvoices.reduce((sum, invoice) => sum + invoice.credits_total, 0),
  );
  const debitsTotal = roundCurrency(
    versionInvoices.reduce((sum, invoice) => sum + invoice.debits_total, 0),
  );
  const voidsTotal = roundCurrency(
    versionInvoices.reduce((sum, invoice) => sum + invoice.voids_total, 0),
  );
  const netInvoiced = roundCurrency(
    versionInvoices.reduce((sum, invoice) => sum + invoice.net_invoiced, 0),
  );
  const refundsTotal = roundCurrency(
    versionInvoices.reduce((sum, invoice) => sum + invoice.refunds_total, 0),
  );
  const writeOffsTotal = adjustmentAmount(versionAdjustments, 'write_off');
  const remainingToInvoice = roundCurrency(
    adjustedQuoteValue - netInvoiced - writeOffsTotal,
  );
  const availableToRequest = Math.max(
    0,
    roundCurrency(remainingToInvoice - pendingRequestedTotal),
  );

  return {
    quote_id: input.version.id,
    original_quote_value: originalQuoteValue,
    quote_adjustments: quoteAdjustments,
    adjusted_quote_value: adjustedQuoteValue,
    gross_invoiced: grossInvoiced,
    credits_total: creditsTotal,
    debits_total: debitsTotal,
    voids_total: voidsTotal,
    net_invoiced: netInvoiced,
    refunds_total: refundsTotal,
    write_offs_total: writeOffsTotal,
    pending_requested_total: pendingRequestedTotal,
    remaining_to_invoice: remainingToInvoice,
    available_to_request: availableToRequest,
    has_variance:
      remainingToInvoice < -MONEY_EPSILON ||
      pendingRequestedTotal - Math.max(0, remainingToInvoice) > MONEY_EPSILON ||
      versionInvoices.some((invoice) => invoice.net_invoiced < -MONEY_EPSILON),
  };
}

function compareVersions(
  left: FinancialQuoteVersion,
  right: FinancialQuoteVersion,
): number {
  if (left.revision_number !== right.revision_number) {
    return left.revision_number - right.revision_number;
  }
  return (left.created_at || '').localeCompare(right.created_at || '');
}

export function calculateQuoteFinancials(input: {
  versions: FinancialQuoteVersion[];
  invoices: QuoteInvoice[];
  requests?: QuoteInvoiceRequest[];
  adjustments?: QuoteFinancialAdjustment[];
}): QuoteFinancialCalculation {
  if (input.versions.length === 0) {
    throw new Error('At least one quote version is required');
  }

  const adjustments = input.adjustments || [];
  const activeAdjustments = getActiveFinancialAdjustments(adjustments);
  const effectiveInvoices = buildEffectiveInvoices(input.invoices, adjustments);
  const requests = input.requests || [];
  const versionSummaries = Object.fromEntries(
    input.versions.map((version) => [
      version.id,
      buildVersionSummary({
        version,
        invoices: effectiveInvoices,
        requests,
        adjustments: activeAdjustments,
      }),
    ]),
  );
  const baseVersions = input.versions
    .filter((version) => ['original', 'revision'].includes(version.revision_type))
    .sort(compareVersions);
  const selectedBase = baseVersions.at(-1) || [...input.versions].sort(compareVersions).at(-1)!;
  const additiveVersions = input.versions.filter((version) =>
    ADDITIVE_REVISION_TYPES.has(version.revision_type),
  );
  const includedQuoteIds = Array.from(
    new Set([selectedBase.id, ...additiveVersions.map((version) => version.id)]),
  );
  const supersededQuoteIds = input.versions
    .filter(
      (version) =>
        !includedQuoteIds.includes(version.id) &&
        ['original', 'revision'].includes(version.revision_type),
    )
    .map((version) => version.id);
  const includedSummaries = includedQuoteIds
    .map((id) => versionSummaries[id])
    .filter((summary): summary is QuoteVersionFinancialSummary => Boolean(summary));
  const sumIncluded = (
    key: keyof QuoteVersionFinancialSummary,
  ) =>
    roundCurrency(
      includedSummaries.reduce(
        (sum, summary) => sum + Number(summary[key] || 0),
        0,
      ),
    );
  const sumAllVersions = (
    key: keyof QuoteVersionFinancialSummary,
  ) =>
    roundCurrency(
      Object.values(versionSummaries).reduce(
        (sum, summary) => sum + Number(summary[key] || 0),
        0,
      ),
    );
  const adjustedQuoteValue = sumIncluded('adjusted_quote_value');
  const netInvoiced = sumAllVersions('net_invoiced');
  const writeOffsTotal = sumAllVersions('write_offs_total');
  const pendingRequestedTotal = sumAllVersions('pending_requested_total');
  const remainingToInvoice = roundCurrency(
    adjustedQuoteValue - netInvoiced - writeOffsTotal,
  );
  const availableToRequest = Math.max(
    0,
    roundCurrency(remainingToInvoice - pendingRequestedTotal),
  );
  const hasVariance =
    remainingToInvoice < -MONEY_EPSILON ||
    pendingRequestedTotal - Math.max(0, remainingToInvoice) > MONEY_EPSILON ||
    Object.values(versionSummaries).some((summary) => summary.has_variance);
  const invoiceStatus =
    remainingToInvoice <= MONEY_EPSILON && netInvoiced >= adjustedQuoteValue - MONEY_EPSILON
      ? 'invoiced'
      : pendingRequestedTotal > MONEY_EPSILON
        ? 'ready_to_invoice'
        : netInvoiced > MONEY_EPSILON
          ? 'partially_invoiced'
          : 'not_invoiced';
  const reconciliationStatus =
    remainingToInvoice < -MONEY_EPSILON
      ? 'over_invoiced'
      : Math.abs(remainingToInvoice) <= MONEY_EPSILON
        ? writeOffsTotal > MONEY_EPSILON
          ? 'written_off'
          : 'balanced'
        : 'outstanding';

  return {
    adjustments: adjustments.map((adjustment) => ({
      ...adjustment,
      is_reversed: adjustments.some(
        (candidate) =>
          candidate.adjustment_type === 'reversal' &&
          candidate.reverses_adjustment_id === adjustment.id,
      ),
    })),
    effectiveInvoices,
    versionSummaries,
    threadSummary: {
      quote_id: selectedBase.id,
      quote_thread_id: input.versions[0].quote_thread_id,
      included_quote_ids: includedQuoteIds,
      superseded_quote_ids: supersededQuoteIds,
      original_quote_value: sumIncluded('original_quote_value'),
      quote_adjustments: sumIncluded('quote_adjustments'),
      adjusted_quote_value: adjustedQuoteValue,
      gross_invoiced: sumAllVersions('gross_invoiced'),
      credits_total: sumAllVersions('credits_total'),
      debits_total: sumAllVersions('debits_total'),
      voids_total: sumAllVersions('voids_total'),
      net_invoiced: netInvoiced,
      refunds_total: sumAllVersions('refunds_total'),
      write_offs_total: writeOffsTotal,
      pending_requested_total: pendingRequestedTotal,
      remaining_to_invoice: remainingToInvoice,
      available_to_request: availableToRequest,
      has_variance: hasVariance,
      reconciliation_status: reconciliationStatus,
      invoice_status: invoiceStatus,
    },
  };
}
