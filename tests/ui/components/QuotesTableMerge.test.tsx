/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuotesTable } from '@/app/(dashboard)/quotes/components/QuotesTable';
import type { Quote } from '@/app/(dashboard)/quotes/types';

function buildQuote(id: string, reference: string, overrides: Partial<Quote> = {}): Quote {
  return {
    id,
    quote_reference: reference,
    base_quote_reference: reference,
    quote_thread_id: id,
    parent_quote_id: null,
    customer_id: 'customer-1',
    requester_id: 'manager-1',
    requester_initials: 'MD',
    quote_date: '2026-07-27',
    attention_name: 'Customer',
    attention_email: 'customer@example.com',
    subject_line: `${reference} works`,
    project_description: null,
    scope: null,
    salutation: null,
    site_address: null,
    validity_days: 30,
    subtotal: 100,
    total: 100,
    pricing_mode: 'itemized',
    status: 'sent',
    accepted: false,
    po_number: null,
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
    version_label: 'Original',
    version_notes: null,
    is_latest_version: true,
    duplicate_source_quote_id: null,
    manager_name: 'Matt Duffill',
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
    created_at: '2026-07-27T10:00:00Z',
    updated_at: '2026-07-27T10:00:00Z',
    created_by: 'user-1',
    updated_by: 'user-1',
    sent_at: null,
    accepted_at: null,
    invoiced_at: null,
    sage_posted_at: null,
    sage_posted_by: null,
    customer: {
      id: 'customer-1',
      company_name: 'Customer Ltd',
      short_name: 'Customer',
    },
    ...overrides,
  };
}

describe('QuotesTable live quote merge', () => {
  it('requires permanent-merge confirmation before submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        quotes: [
          {
            id: 'quote-1',
            reference: '80004-MD',
            total: 100,
            line_items: [],
            purchase_orders: [],
            rams_count: 0,
            attachment_count: 0,
            invoice_count: 0,
            version_count: 1,
            sage_posted: false,
          },
          {
            id: 'quote-2',
            reference: '80005-MD',
            total: 100,
            line_items: [],
            purchase_orders: [],
            rams_count: 0,
            attachment_count: 0,
            invoice_count: 0,
            version_count: 1,
            sage_posted: false,
          },
        ],
      }),
    }));
    render(
      <QuotesTable
        quotes={[
          buildQuote('quote-1', '80004-MD'),
          buildQuote('quote-2', '80005-MD'),
        ]}
        onRowClick={vi.fn()}
        canMerge
        onMerged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Merge Quotes' }));
    fireEvent.click(screen.getAllByLabelText(/for merge/i)[0]);
    fireEvent.click(screen.getAllByLabelText(/for merge/i)[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Review Merge' }));

    expect(await screen.findByText(/cannot be un-merged/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Permanently Merge Quotes' });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: /retired numbers will permanently redirect/i,
    }));
    expect(submit).toBeEnabled();
  });
});
