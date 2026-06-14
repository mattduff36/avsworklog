/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QuotesTable } from '@/app/(dashboard)/quotes/components/QuotesTable';
import type { Quote, QuoteListSummary, QuoteStatus } from '@/app/(dashboard)/quotes/types';

const ALL_STATUSES: QuoteStatus[] = [
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
];

function buildQuote(overrides: Partial<Quote>): Quote {
  const quoteReference = overrides.quote_reference || '50000-LC';

  return {
    id: overrides.id || quoteReference,
    quote_reference: quoteReference,
    base_quote_reference: overrides.base_quote_reference || quoteReference,
    quote_thread_id: overrides.quote_thread_id || quoteReference,
    parent_quote_id: null,
    customer_id: 'customer-1',
    requester_id: 'manager-1',
    requester_initials: 'LC',
    quote_date: overrides.quote_date || '2026-06-12',
    attention_name: null,
    attention_email: null,
    subject_line: overrides.subject_line || null,
    project_description: overrides.project_description || 'Drainage works',
    scope: null,
    salutation: null,
    site_address: null,
    validity_days: 30,
    subtotal: overrides.subtotal ?? 100,
    total: overrides.total ?? 100,
    pricing_mode: 'itemized',
    status: overrides.status || 'sent',
    accepted: false,
    po_number: overrides.po_number ?? null,
    po_received_at: null,
    po_value: null,
    started: false,
    start_date: null,
    start_alert_days: null,
    start_alert_sent_at: null,
    estimated_duration_days: null,
    invoice_number: null,
    invoice_notes: null,
    last_invoice_at: null,
    signoff_name: null,
    signoff_title: null,
    custom_footer_text: null,
    revision_number: 0,
    revision_type: 'original',
    version_label: null,
    version_notes: null,
    is_latest_version: true,
    duplicate_source_quote_id: null,
    manager_name: 'Louis Cree',
    manager_email: null,
    approver_profile_id: null,
    approved_by: null,
    approved_at: null,
    returned_at: null,
    return_comments: null,
    customer_sent_at: null,
    customer_sent_by: null,
    completion_status: 'not_completed',
    completion_comments: null,
    commercial_status: 'open',
    closed_at: null,
    rams_requested_at: null,
    created_at: '2026-06-12T00:00:00Z',
    updated_at: '2026-06-12T00:00:00Z',
    created_by: null,
    updated_by: null,
    sent_at: null,
    accepted_at: null,
    invoiced_at: null,
    sage_posted_at: overrides.sage_posted_at ?? null,
    sage_posted_by: null,
    customer: {
      id: 'customer-1',
      company_name: overrides.customer?.company_name || 'Customer Ltd',
      short_name: null,
    },
    previous_versions: [],
    invoice_summary: {
      invoicedTotal: 0,
      pendingRequestedTotal: 0,
      remainingBalance: overrides.total ?? 100,
      availableToRequest: overrides.total ?? 100,
      lastInvoiceAt: null,
      status: overrides.invoice_summary?.status || 'not_invoiced',
    },
  };
}

function buildStatusCounts(quotes: Quote[]): QuoteListSummary['status_counts'] {
  const counts = ALL_STATUSES.reduce<Record<QuoteStatus | 'all', number>>(
    (acc, status) => ({ ...acc, [status]: 0 }),
    { all: quotes.length } as Record<QuoteStatus | 'all', number>
  );

  quotes.forEach((quote) => {
    counts[quote.status] += 1;
  });

  return counts;
}

describe('QuotesTable filters', () => {
  it('moves workflow status into a multi-select dropdown', () => {
    const quotes = [
      buildQuote({ id: 'draft', quote_reference: '50001-LC', status: 'draft' }),
      buildQuote({ id: 'confirmed', quote_reference: '50002-LC', status: 'sent' }),
      buildQuote({ id: 'accepted', quote_reference: '50003-LC', status: 'po_received' }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /All workflow/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All dates/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All PO/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All billing/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All Sage/ })).toBeInTheDocument();
    expect(screen.queryByText('Workflow Status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All workflow/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmed/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Accepted/ }));

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('50001-LC')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50002-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50003-LC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument();
  });

  it('filters by date range and places reset before filter dropdowns', () => {
    const quotes = [
      buildQuote({ id: 'early', quote_reference: '50001-LC', quote_date: '2026-06-01' }),
      buildQuote({ id: 'middle', quote_reference: '50002-LC', quote_date: '2026-06-12' }),
      buildQuote({ id: 'late', quote_reference: '50003-LC', quote_date: '2026-06-30' }),
    ];
    const { container } = render(
      <QuotesTable
        quotes={quotes}
        statusCounts={buildStatusCounts(quotes)}
        onRowClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /All dates/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-20' } });

    const tableBody = container.querySelector('tbody');
    expect(tableBody).not.toBeNull();
    expect(within(tableBody as HTMLElement).queryByText('50001-LC')).not.toBeInTheDocument();
    expect(within(tableBody as HTMLElement).getByText('50002-LC')).toBeInTheDocument();
    expect(within(tableBody as HTMLElement).queryByText('50003-LC')).not.toBeInTheDocument();

    const filterRow = screen.getByRole('button', { name: /Reset Filters/ }).parentElement;
    expect(filterRow?.children[0]).toHaveTextContent('Reset Filters');
    expect(filterRow?.children[1]).toHaveTextContent('2026-06-10 to 2026-06-20');
  });
});
