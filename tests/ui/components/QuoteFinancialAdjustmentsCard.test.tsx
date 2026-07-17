/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QuoteFinancialAdjustmentsCard } from '@/app/(dashboard)/quotes/components/settings/QuoteFinancialAdjustmentsCard';
import type { QuoteFinancialWorkspace } from '@/app/(dashboard)/quotes/types';

const searchResult = {
  id: 'quote-1',
  quote_thread_id: 'thread-1',
  quote_reference: '10001-MS',
  base_quote_reference: '10001-MS',
  subject_line: 'Crane works',
  status: 'completed_full',
  is_latest_version: true,
  customer: { id: 'customer-1', company_name: 'Example Construction' },
};

function workspace(canManage: boolean): QuoteFinancialWorkspace {
  return {
    quote_thread_id: 'thread-1',
    quote: {
      id: 'quote-1',
      quote_reference: '10001-MS',
      quote_thread_id: 'thread-1',
      is_latest_version: true,
      status: 'completed_full',
      revision_type: 'original',
      revision_number: 0,
      total: 1_000,
      customer: { id: 'customer-1', company_name: 'Example Construction', short_name: null },
    } as QuoteFinancialWorkspace['quote'],
    versions: [
      {
        id: 'quote-1',
        quote_reference: '10001-MS',
        quote_thread_id: 'thread-1',
        is_latest_version: true,
        revision_type: 'original',
        revision_number: 0,
        total: 1_000,
      } as QuoteFinancialWorkspace['versions'][number],
    ],
    invoices: [],
    invoice_requests: [],
    adjustments: [
      {
        id: 'adjustment-1',
        adjustment_number: 'ADJ-0001',
        quote_thread_id: 'thread-1',
        quote_id: 'quote-1',
        invoice_id: null,
        related_adjustment_id: null,
        reverses_adjustment_id: null,
        adjustment_type: 'quote_value_adjustment',
        amount: 100,
        direction: 'decrease',
        effective_date: '2026-07-17',
        reason: 'Sage reconciliation',
        notes: null,
        external_reference: 'SAGE-123',
        metadata_before: {},
        metadata_after: {},
        document_snapshot: {},
        created_by: 'user-1',
        created_at: '2026-07-17T10:00:00.000Z',
        actor: { id: 'user-1', full_name: 'Accounts User' },
        is_reversed: false,
      },
    ],
    version_summaries: {
      'quote-1': {
        quote_id: 'quote-1',
        original_quote_value: 1_000,
        quote_adjustments: -100,
        adjusted_quote_value: 900,
        gross_invoiced: 800,
        credits_total: 50,
        debits_total: 0,
        voids_total: 0,
        net_invoiced: 750,
        refunds_total: 50,
        write_offs_total: 0,
        pending_requested_total: 0,
        remaining_to_invoice: 150,
        available_to_request: 150,
        has_variance: false,
      },
    },
    thread_summary: {
      quote_id: 'quote-1',
      quote_thread_id: 'thread-1',
      included_quote_ids: ['quote-1'],
      superseded_quote_ids: [],
      original_quote_value: 1_000,
      quote_adjustments: -100,
      adjusted_quote_value: 900,
      gross_invoiced: 800,
      credits_total: 50,
      debits_total: 0,
      voids_total: 0,
      net_invoiced: 750,
      refunds_total: 50,
      write_offs_total: 0,
      pending_requested_total: 0,
      remaining_to_invoice: 150,
      available_to_request: 150,
      has_variance: false,
      reconciliation_status: 'outstanding',
      invoice_status: 'partially_invoiced',
    },
    can_manage: canManage,
  };
}

describe('QuoteFinancialAdjustmentsCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the ledger as a table and opens bordered, high-contrast adjustment controls in the modal', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [searchResult], can_manage: true }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workspace: workspace(true) }), { status: 200 }),
      );

    render(<QuoteFinancialAdjustmentsCard />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('columnheader', { name: 'Job Number' })).toBeTruthy();
    expect(screen.queryByText('Append-only audit')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Record adjustment' })).toBeNull();

    const searchInput = screen.getByPlaceholderText(/Search quote, customer/i);
    expect(searchInput).toHaveClass(
      'border-slate-600',
      'bg-slate-950/60',
      'text-white',
      'focus-visible:ring-2',
    );

    const searchButton = screen.getByRole('button', { name: 'Search' });
    expect(searchButton).toBeDisabled();
    expect(searchButton).toHaveClass(
      'border',
      'border-slate-500',
      'bg-slate-800',
      'text-white',
      'hover:bg-slate-700',
    );

    fireEvent.change(searchInput, { target: { value: '100' } });
    expect(searchButton).toBeEnabled();
    fireEvent.click(searchButton);

    expect(await screen.findByRole('cell', { name: '10001-MS' })).toBeTruthy();
    const adjustmentsButton = screen.getByRole('button', { name: 'Adjustments' });
    expect(adjustmentsButton).toHaveClass('border', 'border-slate-500', 'text-white');
    fireEvent.click(adjustmentsButton);

    const workspaceDialog = await screen.findByRole('dialog');
    expect(workspaceDialog).toHaveClass('max-w-4xl', 'overflow-hidden', 'flex');
    expect(screen.getByText('10001-MS financial adjustments')).toBeTruthy();
    expect(await screen.findByText('Adjusted quote')).toBeTruthy();
    expect(screen.getAllByText('£900.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('£750.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '1. Choose the target' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2. Enter adjustment details' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'New adjustment' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.queryByRole('heading', { name: 'Immutable history' })).toBeNull();

    const invoiceSelect = screen.getByRole('combobox', { name: /Invoice.*required/i });
    const amountInput = screen.getByRole('spinbutton', { name: /Amount.*required/i });
    const reasonInput = screen.getByRole('textbox', { name: /Reason.*required/i });
    expect(invoiceSelect).toHaveAttribute('aria-required', 'true');
    expect(amountInput).toBeRequired();
    expect(amountInput).toHaveAttribute('aria-required', 'true');
    expect(reasonInput).toBeRequired();
    expect(document.querySelector('label[for="financial-adjustment-invoice"]')).toHaveTextContent(
      /Invoice\s*\*/,
    );
    expect(document.querySelector('label[for="financial-adjustment-amount"]')).toHaveTextContent(
      /Amount\s*\*/,
    );
    expect(document.querySelector('label[for="financial-adjustment-reason"]')).toHaveTextContent(
      /Reason\s*\*/,
    );

    const notesInput = screen.getByRole('textbox', { name: 'Notes (optional)' });
    const externalReferenceInput = screen.getByRole('textbox', {
      name: 'Sage / external reference (optional)',
    });
    expect(notesInput).not.toBeRequired();
    expect(externalReferenceInput).not.toBeRequired();
    expect(document.querySelector('label[for="financial-adjustment-notes"]')).not.toHaveTextContent(
      '*',
    );
    expect(
      document.querySelector('label[for="financial-adjustment-external-reference"]'),
    ).not.toHaveTextContent('*');

    fireEvent.click(screen.getByRole('combobox', { name: /Adjustment type.*required/i }));
    fireEvent.click(
      await screen.findByRole('option', { name: 'Correct invoice details' }),
    );
    expect(screen.getByText('Enter at least one corrected invoice field.')).toBeTruthy();
    expect(
      document.querySelector('label[for="financial-adjustment-correct-invoice-number"]'),
    ).not.toHaveTextContent('*');
    expect(
      document.querySelector('label[for="financial-adjustment-correct-invoice-date"]'),
    ).not.toHaveTextContent('*');
    expect(screen.queryByRole('spinbutton', { name: /Amount/ })).toBeNull();

    const closeButton = screen.getByRole('button', { name: 'Close financial adjustments' });
    expect(closeButton).toHaveClass('border', 'border-slate-500', 'bg-slate-800', 'text-white');
    expect(screen.getByRole('button', { name: 'Close', exact: true })).toHaveClass(
      'border',
      'border-slate-500',
      'bg-slate-800',
      'text-white',
    );

    const reviewButton = screen.getByRole('button', { name: /Review immutable entry/i });
    expect(reviewButton).toHaveClass(
      'border',
      'border-amber-300',
      'bg-amber-300',
      'text-slate-950',
      'disabled:bg-slate-800',
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Versions & totals' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole('heading', { name: 'Reconciliation totals' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Version breakdown' })).toBeTruthy();
    const refreshButton = screen.getByRole('button', { name: 'Refresh ledger' });
    expect(refreshButton).toHaveClass('border', 'border-slate-500', 'bg-slate-800', 'text-white');
    expect(screen.queryByRole('button', { name: /Review immutable entry/i })).toBeNull();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'History (1)' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole('heading', { name: 'Immutable history' })).toBeTruthy();
    const pdfLink = screen.getByRole('link', { name: 'PDF' });
    expect(pdfLink).toHaveClass('border', 'border-slate-500', 'bg-slate-800', 'text-white');

    const reverseButton = screen.getByRole('button', { name: 'Reverse' });
    expect(reverseButton).toHaveClass('border', 'border-red-400/70', 'bg-red-950/70', 'text-red-100');
    fireEvent.click(reverseButton);

    const reversalDialog = await screen.findByRole('alertdialog');
    expect(workspaceDialog).toBeInTheDocument();
    expect(within(reversalDialog).getByPlaceholderText('Required audit reason')).toHaveClass(
      'border-slate-600',
      'bg-slate-900',
      'text-white',
    );
    expect(within(reversalDialog).getByRole('button', { name: 'Create reversal' })).toHaveClass(
      'border',
      'border-red-400/70',
      'text-red-100',
    );
    expect(within(reversalDialog).getByRole('button', { name: 'Cancel' })).toHaveClass(
      'border',
      'border-slate-500',
      'text-white',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('auto-searches once after the debounce delay', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [searchResult], can_manage: true }), {
        status: 200,
      }),
    );

    render(<QuoteFinancialAdjustmentsCard />);
    const searchInput = screen.getByPlaceholderText(/Search quote, customer/i);
    fireEvent.change(searchInput, { target: { value: '100' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/quotes/financial-adjustments?q=100',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole('cell', { name: '10001-MS' })).toBeTruthy();
  });

  it('collapses rapid typing into one request for the latest term', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [searchResult], can_manage: true }), {
        status: 200,
      }),
    );

    render(<QuoteFinancialAdjustmentsCard />);
    const searchInput = screen.getByPlaceholderText(/Search quote, customer/i);

    fireEvent.change(searchInput, { target: { value: '100' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(searchInput, { target: { value: '1000' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(searchInput, { target: { value: '10001' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/quotes/financial-adjustments?q=10001',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('blocks short searches and keeps the minimum-length instruction in the table', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    render(<QuoteFinancialAdjustmentsCard />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.getByRole('cell', {
        name: 'Enter at least 3 characters to search.',
      }),
    ).toBeTruthy();
    const searchInput = screen.getByPlaceholderText(/Search quote, customer/i);
    const searchButton = screen.getByRole('button', { name: 'Search' });

    expect(searchButton).toBeDisabled();
    fireEvent.change(searchInput, { target: { value: ' ab ' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(searchButton).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Adjustments' })).toBeNull();
  });

  it('shows read-only history access for non-Accounts quote users', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [searchResult], can_manage: false }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ workspace: workspace(false) }), { status: 200 }),
      );

    render(<QuoteFinancialAdjustmentsCard />);
    const searchInput = screen.getByPlaceholderText(/Search quote, customer/i);
    fireEvent.change(searchInput, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjustments' }));

    expect(
      await screen.findByText(/Read-only access\. Only Accounts/i),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Review immutable entry/i }),
      ).toBeDisabled();
    });
  });
});
