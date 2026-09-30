'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Columns2, FileDown, GalleryVertical, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Quote, QuoteMergeGroupMember } from '../types';

const VIEW_STORAGE_KEY = 'avs:quote-merge-group-view';
type MergeGroupView = 'list' | 'cards';

interface QuoteMergeGroupDialogProps {
  open: boolean;
  quoteId: string | null;
  onClose: () => void;
  onOpenQuote: (quoteId: string) => void;
  onRefresh: () => void;
}

function money(value: number | null | undefined): string {
  return `£${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function readStoredView(): MergeGroupView | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return value === 'list' || value === 'cards' ? value : null;
}

function MemberFacts({ member }: { member: QuoteMergeGroupMember }) {
  const summary = member.financial_summary;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{member.is_survivor ? 'Survivor' : 'Merged source'}</Badge>
        {member.sage_posted ? <Badge variant="outline">On Sage</Badge> : null}
      </div>
      <p className="text-muted-foreground">{member.project_description || 'No description recorded.'}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Quote value</p>
          <p className="font-semibold">{money(summary?.adjusted_quote_value)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Invoiced</p>
          <p className="font-semibold">{money(summary?.net_invoiced)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Available to request</p>
          <p className="font-semibold">{money(summary?.available_to_request)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Purchase orders</p>
          <p className="font-semibold">{member.purchase_orders.length}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {member.line_items.length === 0 ? (
              <tr><td className="px-3 py-3 text-muted-foreground" colSpan={3}>No priced lines on this quote.</td></tr>
            ) : member.line_items.map((item, index) => (
              <tr key={item.id || `${member.quote_id}-${index}`} className="border-t border-border">
                <td className="px-3 py-2">{item.description}</td>
                <td className="px-3 py-2">{item.quantity} {item.unit}</td>
                <td className="px-3 py-2">{money(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        {member.customer_id ? (
          <Link className="rounded border border-border px-2 py-1 text-xs hover:bg-slate-800" href={`/customers/${member.customer_id}/history`}>
            {member.customer_name || 'Customer'}
          </Link>
        ) : null}
        {member.show_financial_link ? (
          <Link className="rounded border border-border px-2 py-1 text-xs hover:bg-slate-800" href={`/quotes/overview/${encodeURIComponent(member.reference)}`}>
            Financial overview
          </Link>
        ) : null}
        {member.pdf_snapshots.map(snapshot => (
          <a
            key={snapshot.id}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-slate-800"
            href={`/api/quotes/${snapshot.quote_id}/merge-snapshot`}
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
            {snapshot.original_reference}
          </a>
        ))}
      </div>
      {member.invoices.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {member.invoices.map(invoice => (
            <li key={invoice.id}>{invoice.invoice_number} · {invoice.invoice_date} · {money(invoice.amount)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function QuoteMergeGroupDialog({
  open,
  quoteId,
  onClose,
  onOpenQuote,
  onRefresh,
}: QuoteMergeGroupDialogProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [view, setView] = useState<MergeGroupView>('list');
  const [amount, setAmount] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const stored = readStoredView();
    if (stored) {
      setView(stored);
      return;
    }
    setView(window.matchMedia('(max-width: 767px)').matches ? 'cards' : 'list');
  }, []);

  useEffect(() => {
    if (!open || !quoteId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/quotes/${quoteId}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || 'Unable to load the merged quotes.');
        }
        return response.json() as Promise<{ quote: Quote }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setQuote(payload.quote);
        const first = payload.quote.merge_group_members?.[0];
        setSelectedThreadId(first?.quote_thread_id || null);
        setExpandedThreadId(first?.quote_thread_id || null);
        const today = new Date().toISOString().slice(0, 10);
        setInvoiceDate(today);
        setAmount(first?.financial_summary?.available_to_request
          ? String(first.financial_summary.available_to_request)
          : '');
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load the merged quotes.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, quoteId]);

  const members = quote?.merge_group_members || [];
  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return members;
    return members.filter(member => (
      member.reference.toLowerCase().includes(normalized)
      || (member.subject_line || '').toLowerCase().includes(normalized)
      || (member.project_description || '').toLowerCase().includes(normalized)
    ));
  }, [members, query]);
  const selected = visibleMembers.find(member => member.quote_thread_id === selectedThreadId) || visibleMembers[0] || null;
  const totals = quote?.financial_summary;

  function changeView(nextView: MergeGroupView) {
    setView(nextView);
    window.localStorage.setItem(VIEW_STORAGE_KEY, nextView);
  }

  function selectMember(member: QuoteMergeGroupMember) {
    setSelectedThreadId(member.quote_thread_id);
    setAmount(member.financial_summary?.available_to_request
      ? String(member.financial_summary.available_to_request)
      : '');
  }

  async function requestInvoice(member = selected) {
    if (!quote || !member) return;
    const requestedAmount = Number(amount);
    const available = member.financial_summary?.available_to_request || 0;
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount - available > 0.005) {
      toast.error(`Enter an amount up to ${money(available)}.`);
      return;
    }
    if (!invoiceDate) {
      toast.error('Enter the requested invoice date.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/quotes/${quote.id}/invoice-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_amount: requestedAmount,
          requested_invoice_date: invoiceDate,
          requested_invoice_scope: Math.abs(requestedAmount - available) <= 0.005 ? 'full' : 'partial',
          manager_comments: comments,
          merge_billing_scope: 'source',
          merge_source_thread_ids: [member.quote_thread_id],
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || 'Unable to request this invoice.');
      }
      toast.success(`Invoice requested for ${member.reference}`);
      setComments('');
      onRefresh();
      onClose();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : 'Unable to request this invoice.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-6xl overflow-y-auto bg-slate-900">
        <DialogHeader>
          <DialogTitle>Merged quotes</DialogTitle>
          <DialogDescription>
            {quote?.merge_info
              ? `${quote.base_quote_reference} includes ${members.length} quotes. Select one to review its details or request an invoice.`
              : 'Review every quote in this merge without opening each record separately.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Search merged quotes" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search quote number or title" />
            </div>
            <div className="flex rounded-md border border-border p-1" role="group" aria-label="Merged quote view">
              <Button type="button" size="sm" variant={view === 'list' ? 'default' : 'ghost'} aria-pressed={view === 'list'} onClick={() => changeView('list')}>
                <Columns2 className="mr-1 h-4 w-4" aria-hidden="true" /> List
              </Button>
              <Button type="button" size="sm" variant={view === 'cards' ? 'default' : 'ghost'} aria-pressed={view === 'cards'} onClick={() => changeView('cards')}>
                <GalleryVertical className="mr-1 h-4 w-4" aria-hidden="true" /> Cards
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading merged quotes</div>
          ) : null}
          {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
          {!loading && !error && visibleMembers.length === 0 ? <p className="text-sm text-muted-foreground">No quotes match that search.</p> : null}

          {view === 'list' && visibleMembers.length > 0 ? (
            <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
              <div className="max-h-[55dvh] space-y-2 overflow-y-auto" role="listbox" aria-label="Merged quotes">
                {visibleMembers.map(member => (
                  <button
                    key={member.quote_thread_id}
                    type="button"
                    role="option"
                    aria-selected={selected?.quote_thread_id === member.quote_thread_id}
                    className={`w-full rounded-md border p-3 text-left ${selected?.quote_thread_id === member.quote_thread_id ? 'border-avs-yellow bg-slate-800' : 'border-border bg-slate-950/40'}`}
                    onClick={() => selectMember(member)}
                  >
                    <span className="block font-semibold">{member.reference}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{member.subject_line || 'Untitled quote'}</span>
                    <span className="mt-2 block text-xs">{money(member.financial_summary?.adjusted_quote_value)} · invoiced {money(member.financial_summary?.net_invoiced)}</span>
                  </button>
                ))}
              </div>
              {selected ? (
                <div className="max-h-[55dvh] space-y-4 overflow-y-auto rounded-md border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">{selected.reference}</h3>
                      <p className="text-sm text-muted-foreground">{selected.subject_line || 'Untitled quote'}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => onOpenQuote(selected.quote_id)}>Open full quote</Button>
                  </div>
                  <MemberFacts member={selected} />
                  <InvoiceRequestForm
                    amount={amount}
                    available={selected.financial_summary?.available_to_request || 0}
                    comments={comments}
                    invoiceDate={invoiceDate}
                    submitting={submitting}
                    onAmountChange={setAmount}
                    onCommentsChange={setComments}
                    onDateChange={setInvoiceDate}
                    onSubmit={() => void requestInvoice()}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {view === 'cards' && visibleMembers.length > 0 ? (
            <div className="max-h-[60dvh] space-y-3 overflow-y-auto">
              {visibleMembers.map(member => {
                const expanded = expandedThreadId === member.quote_thread_id;
                return (
                  <section key={member.quote_thread_id} className="rounded-md border border-border bg-slate-950/40">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 p-3 text-left"
                      aria-expanded={expanded}
                      onClick={() => {
                        setExpandedThreadId(expanded ? null : member.quote_thread_id);
                        selectMember(member);
                      }}
                    >
                      <span>
                        <span className="block font-semibold">{member.reference}</span>
                        <span className="block text-xs text-muted-foreground">{member.subject_line || 'Untitled quote'}</span>
                      </span>
                      <span className="text-sm">{money(member.financial_summary?.adjusted_quote_value)}</span>
                    </button>
                    {expanded ? (
                      <div className="space-y-4 border-t border-border p-3">
                        <MemberFacts member={member} />
                        <InvoiceRequestForm
                          amount={selected?.quote_thread_id === member.quote_thread_id ? amount : String(member.financial_summary?.available_to_request || '')}
                          available={member.financial_summary?.available_to_request || 0}
                          comments={comments}
                          invoiceDate={invoiceDate}
                          submitting={submitting}
                          onAmountChange={setAmount}
                          onCommentsChange={setComments}
                          onDateChange={setInvoiceDate}
                          onSubmit={() => {
                            selectMember(member);
                            void requestInvoice(member);
                          }}
                        />
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-slate-950/50 p-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Combined value</p><p className="font-semibold">{money(totals?.adjusted_quote_value)}</p></div>
            <div><p className="text-xs text-muted-foreground">Invoiced</p><p className="font-semibold">{money(totals?.net_invoiced)}</p></div>
            <div><p className="text-xs text-muted-foreground">Still available</p><p className="font-semibold">{money(totals?.available_to_request)}</p></div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceRequestForm({
  amount,
  available,
  comments,
  invoiceDate,
  submitting,
  onAmountChange,
  onCommentsChange,
  onDateChange,
  onSubmit,
}: {
  amount: string;
  available: number;
  comments: string;
  invoiceDate: string;
  submitting: boolean;
  onAmountChange: (value: string) => void;
  onCommentsChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <Label htmlFor="merge-invoice-amount">Request amount</Label>
        <Input id="merge-invoice-amount" inputMode="decimal" value={amount} onChange={(event) => onAmountChange(event.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">{money(available)} available for this quote</p>
      </div>
      <div>
        <Label htmlFor="merge-invoice-date">Invoice date</Label>
        <Input id="merge-invoice-date" type="date" value={invoiceDate} onChange={(event) => onDateChange(event.target.value)} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="merge-invoice-comments">Comments</Label>
        <Textarea id="merge-invoice-comments" value={comments} onChange={(event) => onCommentsChange(event.target.value)} />
      </div>
      <Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-500 md:col-span-3 md:justify-self-start" disabled={submitting || available <= 0}>
        {submitting ? 'Requesting…' : 'Request invoice for this quote'}
      </Button>
    </form>
  );
}
