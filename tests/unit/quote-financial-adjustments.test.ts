import { describe, expect, it } from 'vitest';
import type {
  QuoteFinancialAdjustment,
  QuoteInvoice,
  QuoteInvoiceRequest,
} from '@/app/(dashboard)/quotes/types';
import {
  buildEffectiveInvoices,
  calculateQuoteFinancials,
} from '@/lib/utils/quote-financial-adjustments';
import { searchQuoteFinancialRecords } from '@/lib/server/quote-financial-adjustments';

function invoice(
  overrides: Partial<QuoteInvoice> & Pick<QuoteInvoice, 'id' | 'quote_id' | 'amount'>,
): QuoteInvoice {
  return {
    invoice_request_id: null,
    invoice_number: `INV-${overrides.id}`,
    invoice_date: '2026-07-01',
    invoice_scope: 'partial',
    comments: null,
    created_by: 'user-1',
    created_at: '2026-07-01T09:00:00.000Z',
    updated_at: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

function adjustment(
  overrides: Partial<QuoteFinancialAdjustment> &
    Pick<QuoteFinancialAdjustment, 'id' | 'quote_id' | 'adjustment_type' | 'amount'>,
): QuoteFinancialAdjustment {
  return {
    adjustment_number: `ADJ-${overrides.id}`,
    quote_thread_id: 'thread-1',
    invoice_id: null,
    related_adjustment_id: null,
    reverses_adjustment_id: null,
    direction: null,
    effective_date: '2026-07-10',
    reason: 'Reconcile with Sage',
    notes: null,
    external_reference: null,
    metadata_before: {},
    metadata_after: {},
    document_snapshot: {},
    created_by: 'user-1',
    created_at: '2026-07-10T09:00:00.000Z',
    ...overrides,
  };
}

function request(
  overrides: Partial<QuoteInvoiceRequest> &
    Pick<QuoteInvoiceRequest, 'id' | 'quote_id' | 'requested_amount'>,
): QuoteInvoiceRequest {
  return {
    requested_invoice_date: '2026-07-15',
    requested_invoice_scope: 'partial',
    manager_comments: null,
    status: 'pending',
    requested_by: 'manager-1',
    requested_at: '2026-07-10T09:00:00.000Z',
    notified_at: null,
    fulfilled_invoice_id: null,
    fulfilled_by: null,
    fulfilled_at: null,
    created_at: '2026-07-10T09:00:00.000Z',
    updated_at: '2026-07-10T09:00:00.000Z',
    ...overrides,
  };
}

const versions = [
  {
    id: 'original',
    quote_thread_id: 'thread-1',
    total: 1_000,
    revision_type: 'original',
    revision_number: 0,
    created_at: '2026-06-01T09:00:00.000Z',
  },
  {
    id: 'revision',
    quote_thread_id: 'thread-1',
    total: 1_200,
    revision_type: 'revision',
    revision_number: 1,
    created_at: '2026-06-10T09:00:00.000Z',
  },
  {
    id: 'extra',
    quote_thread_id: 'thread-1',
    total: 200,
    revision_type: 'extra',
    revision_number: 2,
    created_at: '2026-06-15T09:00:00.000Z',
  },
];

describe('quote financial adjustment calculations', () => {
  it('uses the newest base revision and adds extras without double-counting the original', () => {
    const result = calculateQuoteFinancials({
      versions,
      invoices: [],
    });

    expect(result.threadSummary.original_quote_value).toBe(1_400);
    expect(result.threadSummary.adjusted_quote_value).toBe(1_400);
    expect(result.threadSummary.included_quote_ids).toEqual(['revision', 'extra']);
    expect(result.threadSummary.superseded_quote_ids).toEqual(['original']);
  });

  it('keeps refunds cash-only while applying credits, debits, voids, and write-offs', () => {
    const invoices = [
      invoice({ id: 'invoice-1', quote_id: 'revision', amount: 1_000 }),
      invoice({ id: 'invoice-2', quote_id: 'extra', amount: 200 }),
    ];
    const adjustments = [
      adjustment({
        id: 'credit',
        quote_id: 'revision',
        invoice_id: 'invoice-1',
        adjustment_type: 'credit_note',
        amount: 100,
      }),
      adjustment({
        id: 'refund',
        quote_id: 'revision',
        invoice_id: 'invoice-1',
        related_adjustment_id: 'credit',
        adjustment_type: 'refund',
        amount: 100,
      }),
      adjustment({
        id: 'debit',
        quote_id: 'revision',
        invoice_id: 'invoice-1',
        adjustment_type: 'debit_adjustment',
        amount: 50,
      }),
      adjustment({
        id: 'void',
        quote_id: 'extra',
        invoice_id: 'invoice-2',
        adjustment_type: 'invoice_void',
        amount: 200,
      }),
      adjustment({
        id: 'write-off',
        quote_id: 'extra',
        adjustment_type: 'write_off',
        amount: 50,
      }),
    ];
    const result = calculateQuoteFinancials({ versions, invoices, adjustments });

    expect(result.threadSummary.gross_invoiced).toBe(1_200);
    expect(result.threadSummary.net_invoiced).toBe(950);
    expect(result.threadSummary.refunds_total).toBe(100);
    expect(result.threadSummary.write_offs_total).toBe(50);
    expect(result.threadSummary.remaining_to_invoice).toBe(400);
  });

  it('removes an adjustment effect when a linked reversal exists', () => {
    const credit = adjustment({
      id: 'credit',
      quote_id: 'revision',
      invoice_id: 'invoice-1',
      adjustment_type: 'credit_note',
      amount: 100,
    });
    const reversal = adjustment({
      id: 'reversal',
      quote_id: 'revision',
      invoice_id: 'invoice-1',
      adjustment_type: 'reversal',
      amount: 100,
      reverses_adjustment_id: credit.id,
    });
    const result = calculateQuoteFinancials({
      versions,
      invoices: [invoice({ id: 'invoice-1', quote_id: 'revision', amount: 1_000 })],
      adjustments: [credit, reversal],
    });

    expect(result.threadSummary.credits_total).toBe(0);
    expect(result.threadSummary.net_invoiced).toBe(1_000);
    expect(result.adjustments.find((entry) => entry.id === credit.id)?.is_reversed).toBe(true);
  });

  it('applies the latest invoice metadata overlay without changing original fields', () => {
    const original = invoice({ id: 'invoice-1', quote_id: 'revision', amount: 500 });
    const corrected = buildEffectiveInvoices(
      [original],
      [
        adjustment({
          id: 'metadata',
          quote_id: 'revision',
          invoice_id: original.id,
          adjustment_type: 'invoice_metadata_correction',
          amount: 0,
          metadata_after: {
            invoice_number: 'SAGE-9001',
            invoice_date: '2026-07-09',
            invoice_scope: 'full',
          },
        }),
      ],
    )[0];

    expect(corrected.invoice_number).toBe('INV-invoice-1');
    expect(corrected.effective_invoice_number).toBe('SAGE-9001');
    expect(corrected.effective_invoice_date).toBe('2026-07-09');
    expect(corrected.effective_invoice_scope).toBe('full');
  });

  it('flags over-invoicing and pending requests above adjusted capacity', () => {
    const result = calculateQuoteFinancials({
      versions: [versions[1]],
      invoices: [invoice({ id: 'invoice-1', quote_id: 'revision', amount: 1_300 })],
      requests: [request({ id: 'request-1', quote_id: 'revision', requested_amount: 100 })],
    });

    expect(result.threadSummary.remaining_to_invoice).toBe(-100);
    expect(result.threadSummary.available_to_request).toBe(0);
    expect(result.threadSummary.has_variance).toBe(true);
    expect(result.threadSummary.reconciliation_status).toBe('over_invoiced');
  });
});

describe('quote financial adjustment search', () => {
  it('rejects terms shorter than three trimmed characters before querying', async () => {
    await expect(searchQuoteFinancialRecords(' ab ')).rejects.toThrow(
      'Enter at least 3 characters',
    );
  });
});
