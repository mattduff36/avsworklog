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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  FileDown,
  Send,
  Files,
  Copy,
  Receipt,
  CalendarClock,
  Pencil,
  Upload,
  FolderKanban,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Quote, QuoteCompletionStatus, QuoteRevisionType } from '../types';
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
  const [poNumber, setPoNumber] = useState('');
  const [poValue, setPoValue] = useState('');
  const [returnComments, setReturnComments] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startAlertDays, setStartAlertDays] = useState('');
  const [completionStatus, setCompletionStatus] = useState<QuoteCompletionStatus>('approved_in_full');
  const [completionComments, setCompletionComments] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceScope, setInvoiceScope] = useState<'full' | 'partial'>('partial');
  const [invoiceComments, setInvoiceComments] = useState('');
  const [revisionType, setRevisionType] = useState<QuoteRevisionType>('revision');
  const [revisionNotes, setRevisionNotes] = useState('');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const activeQuoteId = quote?.id || quoteId;

  const fetchQuote = useCallback(async () => {
    const idToLoad = quote?.id || quoteId;
    if (!idToLoad) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/quotes/${idToLoad}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuote(data.quote);
      setPoNumber(data.quote.po_number || '');
      setPoValue(data.quote.po_value ? String(data.quote.po_value) : '');
      setReturnComments(data.quote.return_comments || '');
      setStartDate(data.quote.start_date || '');
      setStartAlertDays(data.quote.start_alert_days ? String(data.quote.start_alert_days) : '');
      setCompletionStatus(data.quote.completion_status === 'approved_in_part' ? 'approved_in_part' : 'approved_in_full');
      setCompletionComments(data.quote.completion_comments || '');
      setInvoiceNumber('');
      setInvoiceAmount(data.quote.invoice_summary?.remainingBalance ? String(data.quote.invoice_summary.remainingBalance) : '');
      setInvoiceDate(new Date().toISOString().slice(0, 10));
      setInvoiceScope(data.quote.invoice_summary?.remainingBalance === 0 ? 'partial' : 'full');
      setInvoiceComments('');
    } catch {
      toast.error('Failed to load quote details');
    } finally {
      setLoading(false);
    }
  }, [quote?.id, quoteId]);

  useEffect(() => {
    if (open && quoteId) {
      fetchQuote();
    }
  }, [open, quoteId, fetchQuote]);

  async function updateQuote(updates: Record<string, unknown>) {
    if (!activeQuoteId) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (updates.action === 'create_revision' || updates.action === 'duplicate') {
        setQuote(data.quote);
      }
      toast.success('Quote updated');
      if (updates.action !== 'create_revision' && updates.action !== 'duplicate') {
        await fetchQuote();
      }
      onRefresh();
    } catch {
      toast.error('Failed to update quote');
    } finally {
      setActionLoading(false);
    }
  }

  async function callAction(action: string, payload?: Record<string, unknown>) {
    await updateQuote({ action, ...(payload || {}) });
  }

  async function handleAttachmentUpload(file: File) {
    if (!activeQuoteId) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadingAttachment(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to upload attachment');
      }

      toast.success('Attachment uploaded');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload attachment');
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function deleteAttachment(attachmentId: string) {
    if (!activeQuoteId) return;

    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/attachments/${attachmentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Attachment removed');
      await fetchQuote();
      onRefresh();
    } catch {
      toast.error('Failed to delete attachment');
    }
  }

  async function addInvoice() {
    if (!activeQuoteId || !invoiceNumber.trim() || !invoiceAmount) {
      toast.error('Enter an invoice number and amount');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          amount: Number(invoiceAmount),
          invoice_scope: invoiceScope,
          comments: invoiceComments,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add invoice');
      }

      toast.success('Invoice added');
      setInvoiceNumber('');
      setInvoiceComments('');
      await fetchQuote();
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add invoice');
    } finally {
      setActionLoading(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white">
        <DialogHeader className="sr-only">
          <DialogTitle>Quote Details</DialogTitle>
        </DialogHeader>
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
                <div>
                  <span className="text-muted-foreground">Manager</span>
                  <p className="text-white">{quote.manager_name || '—'}</p>
                  {quote.manager_email && <p className="text-xs text-muted-foreground">{quote.manager_email}</p>}
                </div>
                <div>
                  <span className="text-muted-foreground">Version</span>
                  <p className="text-white">{quote.version_label || 'Original'}</p>
                  {quote.base_quote_reference && quote.base_quote_reference !== quote.quote_reference && (
                    <p className="text-xs text-muted-foreground">Base: {quote.base_quote_reference}</p>
                  )}
                </div>
              </div>

              {quote.site_address && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Site Address</span>
                  <p className="text-slate-300 whitespace-pre-wrap">{quote.site_address}</p>
                </div>
              )}

              {quote.project_description && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <p className="text-slate-300 whitespace-pre-wrap">{quote.project_description}</p>
                </div>
              )}

              <Separator className="bg-slate-700" />

              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="bg-slate-800 text-slate-300">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="workflow">Workflow</TabsTrigger>
                  <TabsTrigger value="invoices">Invoices</TabsTrigger>
                  <TabsTrigger value="attachments">Attachments</TabsTrigger>
                  <TabsTrigger value="versions">Versions</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
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

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                      <p className="text-muted-foreground">Quote Total</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                      <p className="text-muted-foreground">Invoiced</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.invoice_summary?.invoicedTotal || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                      <p className="text-muted-foreground">Remaining Balance</p>
                      <p className="mt-1 text-lg font-semibold text-white">£{Number(quote.invoice_summary?.remainingBalance ?? quote.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  {(quote.signoff_name || quote.signoff_title) && (
                    <div className="text-xs text-muted-foreground">
                      {quote.signoff_name && <p>Signed by: {quote.signoff_name}</p>}
                      {quote.signoff_title && <p>{quote.signoff_title}</p>}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="workflow" className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>PO Number</Label>
                      <Input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="bg-slate-800 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label>PO Value</Label>
                      <Input value={poValue} onChange={e => setPoValue(e.target.value)} className="bg-slate-800 border-slate-600" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-slate-800 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label>Alert Days Before Start</Label>
                      <Input value={startAlertDays} onChange={e => setStartAlertDays(e.target.value)} className="bg-slate-800 border-slate-600" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Return / Approval Comments</Label>
                    <Textarea value={returnComments} onChange={e => setReturnComments(e.target.value)} rows={3} className="bg-slate-800 border-slate-600" />
                  </div>

                  <div className="space-y-2">
                    <Label>Completion Status</Label>
                    <Select value={completionStatus} onValueChange={(value: QuoteCompletionStatus) => setCompletionStatus(value)}>
                      <SelectTrigger className="bg-slate-800 border-slate-600">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved_in_full">Approve in full</SelectItem>
                        <SelectItem value="approved_in_part">Approve in part</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Completion Comments</Label>
                    <Textarea value={completionComments} onChange={e => setCompletionComments(e.target.value)} rows={3} className="bg-slate-800 border-slate-600" />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {['draft', 'changes_requested'].includes(quote.status) && (
                      <Button
                        onClick={() => callAction('submit_for_approval')}
                        disabled={actionLoading}
                        className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90"
                      >
                        <Send className="mr-2 h-4 w-4" /> Submit For Approval
                      </Button>
                    )}
                    {quote.status === 'pending_internal_approval' && (
                      <>
                        <Button
                          onClick={() => callAction('approve_and_send')}
                          disabled={actionLoading}
                          className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90"
                        >
                          <Send className="mr-2 h-4 w-4" /> Approve And Send
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => callAction('return_for_changes', { return_comments: returnComments })}
                          disabled={actionLoading}
                          className="border-slate-600 text-muted-foreground"
                        >
                          <Pencil className="mr-2 h-4 w-4" /> Return For Changes
                        </Button>
                      </>
                    )}
                    {['sent', 'approved'].includes(quote.status) && (
                      <Button
                        onClick={() => callAction('mark_po_received', { po_number: poNumber, po_value: poValue ? Number(poValue) : null })}
                        disabled={actionLoading}
                        className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90"
                      >
                        <FolderKanban className="mr-2 h-4 w-4" /> Save PO And Trigger RAMS
                      </Button>
                    )}
                    {['po_received', 'in_progress'].includes(quote.status) && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => callAction('set_job_schedule', {
                            start_date: startDate || null,
                            start_alert_days: startAlertDays ? Number(startAlertDays) : null,
                          })}
                          disabled={actionLoading}
                          className="border-slate-600 text-muted-foreground"
                        >
                          <CalendarClock className="mr-2 h-4 w-4" /> Save Schedule
                        </Button>
                        <Button
                          onClick={() => callAction('mark_complete', {
                            completion_status: completionStatus,
                            completion_comments: completionComments,
                          })}
                          disabled={actionLoading}
                          className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90"
                        >
                          <Receipt className="mr-2 h-4 w-4" /> Mark Complete
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => callAction('toggle_closed')}
                      disabled={actionLoading}
                      className="border-slate-600 text-muted-foreground"
                    >
                      {quote.commercial_status === 'closed' ? 'Reopen Quote' : 'Close Quote'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div><span className="text-muted-foreground">PO Received</span><p className="text-white">{quote.po_received_at ? format(new Date(quote.po_received_at), 'dd MMM yyyy') : '—'}</p></div>
                    <div><span className="text-muted-foreground">Start Date</span><p className="text-white">{quote.start_date ? format(new Date(quote.start_date), 'dd MMM yyyy') : '—'}</p></div>
                    <div><span className="text-muted-foreground">Completion</span><p className="text-white">{quote.completion_status.replace(/_/g, ' ')}</p></div>
                  </div>
                </TabsContent>

                <TabsContent value="invoices" className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Invoice Number</Label>
                      <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="bg-slate-800 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} className="bg-slate-800 border-slate-600" />
                    </div>
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="bg-slate-800 border-slate-600" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Invoice Scope</Label>
                      <Select value={invoiceScope} onValueChange={(value: 'full' | 'partial') => setInvoiceScope(value)}>
                        <SelectTrigger className="bg-slate-800 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">Invoice in full</SelectItem>
                          <SelectItem value="partial">Partial invoice</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Comments</Label>
                      <Textarea value={invoiceComments} onChange={e => setInvoiceComments(e.target.value)} rows={2} className="bg-slate-800 border-slate-600" />
                    </div>
                  </div>

                  <Button
                    onClick={addInvoice}
                    disabled={actionLoading}
                    className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90"
                  >
                    <Receipt className="mr-2 h-4 w-4" /> Add Invoice
                  </Button>

                  <div className="space-y-2">
                    {quote.invoices?.length ? quote.invoices.map(invoice => (
                      <div key={invoice.id} className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-white">{invoice.invoice_number}</p>
                            <p className="text-xs text-muted-foreground">{format(new Date(invoice.invoice_date), 'dd MMM yyyy')} • {invoice.invoice_scope.replace('_', ' ')}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-white">£{Number(invoice.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                          </div>
                        </div>
                        {invoice.comments && <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{invoice.comments}</p>}
                      </div>
                    )) : (
                      <p className="text-sm text-muted-foreground">No invoices recorded yet.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="attachments" className="space-y-4">
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-avs-yellow px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-avs-yellow/90">
                      <Upload className="h-4 w-4" />
                      {uploadingAttachment ? 'Uploading...' : 'Upload Attachment'}
                      <input
                        type="file"
                        className="hidden"
                        onChange={event => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void handleAttachmentUpload(file);
                            event.target.value = '';
                          }
                        }}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">Cost sheets, drawings, and supporting files can be attached here.</p>
                  </div>

                  <div className="space-y-2">
                    {quote.attachments?.length ? quote.attachments.map(attachment => (
                      <div key={attachment.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/30 p-3">
                        <div>
                          <p className="text-sm font-medium text-white">{attachment.file_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {attachment.content_type || 'File'}{attachment.file_size ? ` • ${(attachment.file_size / 1024).toFixed(1)} KB` : ''}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" className="border-slate-600 text-muted-foreground" onClick={() => deleteAttachment(attachment.id)}>
                          Remove
                        </Button>
                      </div>
                    )) : (
                      <p className="text-sm text-muted-foreground">No supporting files attached yet.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="versions" className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Create Revision Type</Label>
                      <Select value={revisionType} onValueChange={(value: QuoteRevisionType) => setRevisionType(value)}>
                        <SelectTrigger className="bg-slate-800 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="revision">Revision</SelectItem>
                          <SelectItem value="extra">Extra</SelectItem>
                          <SelectItem value="variation">Variation</SelectItem>
                          <SelectItem value="future_work">Future Work</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Revision Notes</Label>
                      <Textarea value={revisionNotes} onChange={e => setRevisionNotes(e.target.value)} rows={2} className="bg-slate-800 border-slate-600" />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => callAction('create_revision', { revision_type: revisionType, version_notes: revisionNotes })}
                      disabled={actionLoading}
                      className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90"
                    >
                      <Files className="mr-2 h-4 w-4" /> Create New Version
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => callAction('duplicate', { version_notes: revisionNotes })}
                      disabled={actionLoading}
                      className="border-slate-600 text-muted-foreground"
                    >
                      <Copy className="mr-2 h-4 w-4" /> Duplicate As New Quote
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {quote.versions?.length ? quote.versions.map(version => (
                      <div key={version.id} className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-mono font-medium text-avs-yellow">{version.quote_reference}</p>
                            <p className="text-sm text-white">{version.version_label || 'Original'}</p>
                          </div>
                          <Badge variant="outline" className={QUOTE_STATUS_CONFIG[version.status].color}>
                            {QUOTE_STATUS_CONFIG[version.status].label}
                          </Badge>
                        </div>
                        {version.version_notes && <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{version.version_notes}</p>}
                      </div>
                    )) : (
                      <p className="text-sm text-muted-foreground">No version history yet.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap gap-2">
                {['draft', 'pending_internal_approval', 'changes_requested'].includes(quote.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { onClose(); onEdit(quote); }}
                    className="border-slate-600 text-muted-foreground"
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Edit Quote
                  </Button>
                )}

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
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
