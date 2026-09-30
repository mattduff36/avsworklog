import { describe, expect, it } from 'vitest';
import { buildQuoteMergeGroupMembers } from '@/lib/server/quote-merge-group';
import type { QuoteLineItem } from '@/app/(dashboard)/quotes/types';

function line(description: string, threadId: string, quoteId: string): QuoteLineItem {
  return {
    description,
    quantity: 1,
    unit: 'item',
    unit_rate: 10,
    line_total: 10,
    sort_order: 1,
    source_quote_thread_id: threadId,
    quote_id: quoteId,
  };
}

describe('buildQuoteMergeGroupMembers', () => {
  const members = [
    {
      quote_thread_id: 'thread-survivor',
      source_latest_quote_id: 'quote-survivor',
      base_quote_reference: 'Q-100',
      is_survivor: true,
    },
    {
      quote_thread_id: 'thread-alias',
      source_latest_quote_id: 'quote-alias',
      base_quote_reference: 'Q-200',
      is_survivor: false,
    },
  ];
  const versions = [
    {
      id: 'quote-survivor',
      quote_thread_id: 'thread-survivor',
      is_latest_version: true,
      base_quote_reference: 'Q-100',
      subject_line: 'Survivor',
      project_description: null,
      customer_id: 'customer-1',
      sage_posted_at: '2026-09-01T00:00:00Z',
    },
    {
      id: 'quote-alias',
      quote_thread_id: 'thread-alias',
      is_latest_version: true,
      base_quote_reference: 'Q-200',
      subject_line: 'Alias',
      project_description: null,
      customer_id: 'customer-1',
      sage_posted_at: null,
    },
  ];

  it('keeps consolidated lines with the source thread that created them', () => {
    const grouped = buildQuoteMergeGroupMembers({
      mergeMode: 'consolidated',
      openedThreadId: 'thread-survivor',
      customerName: 'Acme',
      members,
      versions,
      survivorLineItems: [
        line('Survivor work', 'thread-survivor', 'quote-survivor'),
        line('Alias work', 'thread-alias', 'quote-survivor'),
      ],
      memberLineItems: [],
      financialSummaries: {},
      invoices: [],
      invoiceSourceThreadIds: {},
      purchaseOrders: [],
      pdfSnapshots: [],
      canViewCustomers: true,
      canViewQuoteFinancials: true,
    });

    expect(grouped.map((member) => member.reference)).toEqual(['Q-100', 'Q-200']);
    expect(grouped[0].line_items.map((item) => item.description)).toEqual(['Survivor work']);
    expect(grouped[1].line_items.map((item) => item.description)).toEqual(['Alias work']);
    expect(grouped[0].sage_posted).toBe(true);
    expect(grouped[1].customer_name).toBe('Acme');
  });

  it('uses each member quote for grouped mode and source-scoped invoices', () => {
    const grouped = buildQuoteMergeGroupMembers({
      mergeMode: 'grouped',
      openedThreadId: 'thread-survivor',
      customerName: null,
      members,
      versions,
      survivorLineItems: [],
      memberLineItems: [line('Alias only', 'thread-alias', 'quote-alias')],
      financialSummaries: {},
      invoiceSourceThreadIds: { 'invoice-1': ['thread-alias'] },
      invoices: [{
        id: 'invoice-1',
        quote_id: 'other-version',
        invoice_request_id: null,
        invoice_number: 'INV-1',
        invoice_date: '2026-09-02',
        amount: 25,
        invoice_scope: 'partial',
        comments: null,
        created_by: null,
        created_at: '2026-09-02T00:00:00Z',
        updated_at: '2026-09-02T00:00:00Z',
        merge_billing_scope: 'source',
        merge_source_thread_ids: ['thread-survivor'],
      }],
      purchaseOrders: [],
      pdfSnapshots: [],
      canViewCustomers: false,
      canViewQuoteFinancials: true,
    });

    expect(grouped[1].line_items).toHaveLength(1);
    expect(grouped[1].invoices).toEqual([
      expect.objectContaining({ invoice_number: 'INV-1', merge_billing_scope: 'source' }),
    ]);
    expect(grouped[0].invoices).toEqual([]);
    expect(grouped[1].customer_id).toBeNull();
  });
});
