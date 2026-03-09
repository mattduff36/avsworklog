'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Loader2,
  FileDown,
  Send,
  CheckCircle2,
  XCircle,
  Receipt,
  DollarSign,
  Pencil,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Quote, QuoteStatus } from '../types';
import { QUOTE_STATUS_CONFIG } from '../types';

interface QuoteDetailsModalProps {
  open: boolean;
  onClose: () => void;
  quoteId: string | null;
  onEdit: (quote: Quote) => void;
  onRefresh: () => void;
}

export function QuoteDetailsModal({ open, onClose, quoteId, onEdit, onRefresh }: QuoteDetailsModalProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [poInput, setPoInput] = useState('');
  const [invoiceInput, setInvoiceInput] = useState('');
  const [showPoField, setShowPoField] = useState(false);
  const [showInvoiceField, setShowInvoiceField] = useState(false);

  const fetchQuote = useCallback(async () => {
    if (!quoteId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuote(data.quote);
      setPoInput(data.quote.po_number || '');
      setInvoiceInput(data.quote.invoice_number || '');
    } catch {
      toast.error('Failed to load quote details');
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    if (open && quoteId) {
      fetchQuote();
      setShowPoField(false);
      setShowInvoiceField(false);
    }
  }, [open, quoteId, fetchQuote]);

  async function updateQuote(updates: Partial<Quote>) {
    if (!quoteId) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error();
      toast.success('Quote updated');
      await fetchQuote();
      onRefresh();
    } catch {
      toast.error('Failed to update quote');
    } finally {
      setActionLoading(false);
    }
  }

  function getAvailableTransitions(status: QuoteStatus): Array<{ status: QuoteStatus; label: string; icon: React.ReactNode; variant: 'default' | 'outline' | 'destructive' }> {
    switch (status) {
      case 'draft':
        return [
          { status: 'pending_internal_approval', label: 'Submit for Approval', icon: <Send className="h-4 w-4 mr-1" />, variant: 'default' },
        ];
      case 'pending_internal_approval':
        return [
          { status: 'sent', label: 'Approve & Mark Sent', icon: <Send className="h-4 w-4 mr-1" />, variant: 'default' },
          { status: 'draft', label: 'Return to Draft', icon: <Pencil className="h-4 w-4 mr-1" />, variant: 'outline' },
        ];
      case 'sent':
        return [
          { status: 'won', label: 'Mark Won', icon: <CheckCircle2 className="h-4 w-4 mr-1" />, variant: 'default' },
          { status: 'lost', label: 'Mark Lost', icon: <XCircle className="h-4 w-4 mr-1" />, variant: 'destructive' },
        ];
      case 'won':
        return [
          { status: 'ready_to_invoice', label: 'Ready to Invoice', icon: <Receipt className="h-4 w-4 mr-1" />, variant: 'default' },
        ];
      case 'ready_to_invoice':
        return [
          { status: 'invoiced', label: 'Mark Invoiced', icon: <DollarSign className="h-4 w-4 mr-1" />, variant: 'default' },
        ];
      default:
        return [];
    }
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white">
        {loading || !quote ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-avs-yellow" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="text-white flex items-center gap-2">
                  <span className="font-mono text-avs-yellow">{quote.quote_reference}</span>
                  <Badge variant="outline" className={QUOTE_STATUS_CONFIG[quote.status].color}>
                    {QUOTE_STATUS_CONFIG[quote.status].label}
                  </Badge>
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              {/* Customer & Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Customer</span>
                  <p className="font-medium text-white">{quote.customer?.company_name || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date</span>
                  <p className="text-white">{format(new Date(quote.quote_date), 'dd MMMM yyyy')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">For the attention of</span>
                  <p className="text-white">{quote.attention_name || '—'}</p>
                  {quote.attention_email && <p className="text-xs text-muted-foreground">{quote.attention_email}</p>}
                </div>
                <div>
                  <span className="text-muted-foreground">Subject</span>
                  <p className="text-white">{quote.subject_line || '—'}</p>
                </div>
              </div>

              {quote.project_description && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <p className="text-slate-300 whitespace-pre-wrap">{quote.project_description}</p>
                </div>
              )}

              <Separator className="bg-slate-700" />

              {/* Line Items */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">Line Items</h4>
                {quote.line_items && quote.line_items.length > 0 ? (
                  <div className="border border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-800/80 border-b border-slate-700">
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium">Item</th>
                          <th className="text-right px-3 py-2 text-muted-foreground font-medium">Qty</th>
                          <th className="text-right px-3 py-2 text-muted-foreground font-medium">Rate</th>
                          <th className="text-right px-3 py-2 text-muted-foreground font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {quote.line_items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 text-white">
                              {item.description}
                              {item.unit && <span className="text-muted-foreground ml-1">({item.unit})</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-300">{item.quantity}</td>
                            <td className="px-3 py-2 text-right text-slate-300">
                              £{Number(item.unit_rate).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-white">
                              £{Number(item.line_total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No line items.</p>
                )}
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="text-sm space-y-1 text-right">
                  <div className="flex justify-between gap-8">
                    <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                    <span className="font-semibold text-white">£{Number(quote.subtotal).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between gap-8">
                    <span className="text-muted-foreground">VAT ({Number(quote.vat_rate)}%)</span>
                    <span className="text-slate-300">£{Number(quote.vat_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between gap-8 border-t border-slate-700 pt-1">
                    <span className="font-semibold text-white">Total</span>
                    <span className="font-bold text-white text-base">£{Number(quote.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <Separator className="bg-slate-700" />

              {/* PO & Invoice fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">PO Number</span>
                  {showPoField ? (
                    <div className="flex gap-2 mt-1">
                      <Input
                        value={poInput}
                        onChange={e => setPoInput(e.target.value)}
                        className="bg-slate-800 border-slate-600 h-8 text-sm"
                        placeholder="Enter PO number"
                      />
                      <Button
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => { updateQuote({ po_number: poInput }); setShowPoField(false); }}
                        className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90 h-8"
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-white">{quote.po_number || '—'}</p>
                      <Button variant="ghost" size="sm" onClick={() => setShowPoField(true)} className="h-6 px-2 text-muted-foreground hover:text-white">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Invoice Number</span>
                  {showInvoiceField ? (
                    <div className="flex gap-2 mt-1">
                      <Input
                        value={invoiceInput}
                        onChange={e => setInvoiceInput(e.target.value)}
                        className="bg-slate-800 border-slate-600 h-8 text-sm"
                        placeholder="Enter invoice number"
                      />
                      <Button
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => { updateQuote({ invoice_number: invoiceInput }); setShowInvoiceField(false); }}
                        className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90 h-8"
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-white">{quote.invoice_number || '—'}</p>
                      <Button variant="ghost" size="sm" onClick={() => setShowInvoiceField(true)} className="h-6 px-2 text-muted-foreground hover:text-white">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Accepted</span>
                  <p className="text-white">{quote.accepted ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Started</span>
                  <p className="text-white">{quote.started ? 'Yes' : 'No'}</p>
                </div>
              </div>

              <Separator className="bg-slate-700" />

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {/* Status transitions */}
                {getAvailableTransitions(quote.status).map(t => (
                  <Button
                    key={t.status}
                    variant={t.variant}
                    size="sm"
                    disabled={actionLoading}
                    onClick={() => {
                      const updates: Partial<Quote> = { status: t.status };
                      if (t.status === 'won') updates.accepted = true;
                      updateQuote(updates);
                    }}
                    className={t.variant === 'default' ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90' : ''}
                  >
                    {t.icon} {t.label}
                  </Button>
                ))}

                {/* Quick toggles */}
                {quote.status === 'won' && !quote.started && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionLoading}
                    onClick={() => updateQuote({ started: true })}
                    className="border-slate-600 text-muted-foreground"
                  >
                    Mark Started
                  </Button>
                )}

                {/* Edit (draft/pending only) */}
                {['draft', 'pending_internal_approval'].includes(quote.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { onClose(); onEdit(quote); }}
                    className="border-slate-600 text-muted-foreground"
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Edit Quote
                  </Button>
                )}

                {/* PDF Download */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.open(`/api/quotes/${quote.id}/pdf`, '_blank');
                  }}
                  className="border-slate-600 text-muted-foreground"
                >
                  <FileDown className="h-4 w-4 mr-1" /> Download PDF
                </Button>
              </div>

              {/* Sign-off details */}
              {(quote.signoff_name || quote.signoff_title) && (
                <div className="text-xs text-muted-foreground">
                  {quote.signoff_name && <p>Signed by: {quote.signoff_name}</p>}
                  {quote.signoff_title && <p>{quote.signoff_title}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
