/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuoteDetailsModal } from '@/app/(dashboard)/quotes/components/QuoteDetailsModal';
import { QuoteSettingsTab } from '@/app/(dashboard)/quotes/components/settings/QuoteSettingsTab';
import type { Quote, QuoteStatus } from '@/app/(dashboard)/quotes/types';

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    profile: {
      id: 'user-1',
      full_name: 'Test User',
    },
  }),
}));

vi.mock('@/app/(dashboard)/quotes/components/settings/QuoteFinancialAdjustmentsCard', () => ({
  QuoteFinancialAdjustmentsCard: () => <div>Financial Adjustment Ledger</div>,
}));

function buildQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'quote-1',
    quote_reference: '10001-MS',
    base_quote_reference: '10001-MS',
    quote_thread_id: 'thread-1',
    parent_quote_id: null,
    customer_id: 'customer-1',
    requester_id: 'user-1',
    requester_initials: 'MS',
    quote_date: '2026-07-17',
    attention_name: 'Alex Example',
    attention_email: 'alex@example.com',
    subject_line: 'Test quote',
    project_description: 'Test project',
    scope: 'Test scope',
    salutation: null,
    site_address: '1 Test Street',
    validity_days: 30,
    subtotal: 100,
    total: 120,
    pricing_mode: 'itemized',
    status: 'draft',
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
    signoff_name: 'Test User',
    signoff_title: null,
    custom_footer_text: null,
    revision_number: 1,
    revision_type: 'revision',
    version_label: 'Revision 1',
    version_notes: null,
    is_latest_version: true,
    duplicate_source_quote_id: null,
    manager_name: 'Test User',
    manager_email: 'manager@example.com',
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
    created_at: '2026-07-17T09:00:00.000Z',
    updated_at: '2026-07-17T09:00:00.000Z',
    created_by: 'user-1',
    updated_by: 'user-1',
    sent_at: null,
    accepted_at: null,
    invoiced_at: null,
    sage_posted_at: null,
    sage_posted_by: null,
    customer: {
      id: 'customer-1',
      company_name: 'Example Construction',
      short_name: null,
      contact_name: 'Alex Example',
      contact_email: 'alex@example.com',
    },
    selected_secondary_contacts: [],
    line_items: [],
    attachments: [],
    rams_documents: [],
    invoices: [],
    invoice_requests: [],
    timeline: [],
    invoice_summary: {
      invoicedTotal: 0,
      pendingRequestedTotal: 0,
      remainingBalance: 120,
      availableToRequest: 120,
      lastInvoiceAt: null,
      status: 'not_invoiced',
    },
    ...overrides,
  };
}

function renderDetails(quote: Quote) {
  const onClose = vi.fn();
  const onRefresh = vi.fn();
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }

    return Promise.resolve(new Response(JSON.stringify({ quote }), { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <QuoteDetailsModal
      open
      quoteId={quote.id}
      onClose={onClose}
      onQuoteChange={vi.fn()}
      onEdit={vi.fn()}
      onRefresh={onRefresh}
      managerOptions={[]}
    />,
  );

  return { fetchMock, onClose, onRefresh };
}

describe('quote deletion controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows one high-contrast header action for a latest draft and confirms deletion', async () => {
    const current = buildQuote();
    const previous = buildQuote({
      id: 'quote-older',
      quote_reference: '10001-MS',
      revision_number: 0,
      revision_type: 'original',
      version_label: 'Original',
      is_latest_version: false,
      status: 'sent',
    });
    current.versions = [{ ...current }, previous];
    const { fetchMock, onClose, onRefresh } = renderDetails(current);

    const deleteButton = await screen.findByRole('button', {
      name: 'Delete draft quote 10001-MS',
    });
    expect(deleteButton).toHaveClass('border-2', 'border-red-400', 'bg-red-950/70', 'text-red-100');
    expect(screen.getAllByRole('button', { name: /delete draft quote/i })).toHaveLength(1);
    expect(screen.queryByText('Delete Draft Version')).not.toBeInTheDocument();

    fireEvent.click(deleteButton);

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete draft quote?' })).toBeInTheDocument();
    expect(screen.getByText(/previous quote version will become the latest version again/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Quote' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/quotes/quote-1', { method: 'DELETE' });
      expect(onClose).toHaveBeenCalledOnce();
      expect(onRefresh).toHaveBeenCalledOnce();
    });
  });

  it.each([
    ['sent latest quote', 'sent', true],
    ['completed latest quote', 'completed_full', true],
    ['historical draft quote', 'draft', false],
  ] as Array<[string, QuoteStatus, boolean]>)(
    'does not show the delete action for a %s',
    async (_label, status, isLatestVersion) => {
      renderDetails(buildQuote({ status, is_latest_version: isLatestVersion }));

      await screen.findByText('10001-MS');
      expect(screen.queryByRole('button', { name: /delete draft quote/i })).not.toBeInTheDocument();
    },
  );

  it('keeps the financial ledger and removes draft deletion from Admin Tools', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/manager-series')) {
        return Promise.resolve(new Response(JSON.stringify({
          can_manage: true,
          manager_options: [],
          quote_users: [],
          approvers: [],
        }), { status: 200 }));
      }
      if (url.includes('/email-templates')) {
        return Promise.resolve(new Response(JSON.stringify({
          can_manage: true,
          templates: [],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        can_manage: true,
        settings: {
          default_start_alert_days: null,
          default_estimated_duration_days: null,
        },
        quote_users: [],
        selected_notifications: {},
      }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuoteSettingsTab
        activeTab="admin-tools"
        onTabChange={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText('Financial Adjustment Ledger')).toBeInTheDocument();
    expect(screen.queryByText('Delete Draft Quote')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quote reference')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
