'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  FileClock,
  Loader2,
  SlidersHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH,
  QUOTE_STATUS_CONFIG,
  getQuoteStatusConfig,
  type QuoteFinancialAdjustment,
  type QuoteFinancialAdjustmentType,
  type QuoteFinancialWorkspace,
  type QuoteStatus,
} from '../../types';

interface QuoteFinancialAdjustmentsCardProps {
  onRefresh?: () => void | Promise<void>;
}

interface QuoteFinancialSearchResult {
  id: string;
  quote_thread_id: string;
  quote_reference: string;
  base_quote_reference: string;
  subject_line: string | null;
  status: QuoteStatus;
  is_latest_version: boolean;
  customer: {
    id: string;
    company_name: string;
  } | null;
}

interface AdjustmentFormState {
  adjustmentType: Exclude<QuoteFinancialAdjustmentType, 'reversal'>;
  quoteId: string;
  invoiceId: string;
  relatedAdjustmentId: string;
  amount: string;
  direction: 'increase' | 'decrease';
  effectiveDate: string;
  reason: string;
  notes: string;
  externalReference: string;
  newStatus: QuoteStatus | 'unchanged';
  invoiceNumber: string;
  invoiceDate: string;
  invoiceScope: 'full' | 'partial';
  invoiceComments: string;
  confirmVariance: boolean;
}

const ADJUSTMENT_OPTIONS: Array<{
  value: AdjustmentFormState['adjustmentType'];
  label: string;
  scope: 'invoice' | 'quote';
}> = [
  { value: 'credit_note', label: 'Credit note', scope: 'invoice' },
  { value: 'refund', label: 'Refund', scope: 'invoice' },
  { value: 'debit_adjustment', label: 'Debit adjustment', scope: 'invoice' },
  { value: 'invoice_void', label: 'Void invoice', scope: 'invoice' },
  { value: 'invoice_metadata_correction', label: 'Correct invoice details', scope: 'invoice' },
  { value: 'quote_value_adjustment', label: 'Correct quote value', scope: 'quote' },
  { value: 'write_off', label: 'Write off remaining value', scope: 'quote' },
];

const FORM_CONTROL_CLASS =
  'border-slate-600 bg-slate-900 text-white placeholder:text-slate-400 hover:border-slate-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/50 focus-visible:border-amber-300 focus-visible:ring-2 focus-visible:ring-amber-300/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:border-slate-700 disabled:bg-slate-900/60 disabled:text-slate-500 disabled:opacity-100';
const SECONDARY_ACTION_CLASS =
  'border border-slate-500 bg-slate-800 text-white shadow-sm hover:border-slate-400 hover:bg-slate-700 hover:text-white focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500 disabled:opacity-100';
const PRIMARY_ACTION_CLASS =
  'border border-amber-300 bg-amber-300 text-slate-950 shadow-sm hover:border-amber-200 hover:bg-amber-200 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:border-slate-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:opacity-100';
const DANGER_ACTION_CLASS =
  'border border-red-400/70 bg-red-950/70 text-red-100 shadow-sm hover:border-red-300 hover:bg-red-900 hover:text-white focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500 disabled:opacity-100';
const SEARCH_DEBOUNCE_MS = 300;

const today = () => new Date().toISOString().slice(0, 10);

function initialForm(quoteId = ''): AdjustmentFormState {
  return {
    adjustmentType: 'credit_note',
    quoteId,
    invoiceId: '',
    relatedAdjustmentId: '',
    amount: '',
    direction: 'decrease',
    effectiveDate: today(),
    reason: '',
    notes: '',
    externalReference: '',
    newStatus: 'unchanged',
    invoiceNumber: '',
    invoiceDate: today(),
    invoiceScope: 'partial',
    invoiceComments: '',
    confirmVariance: false,
  };
}

function formatCurrency(value: number) {
  return `£${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatType(value: string) {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'positive' | 'warning';
}) {
  const valueClass =
    tone === 'positive'
      ? 'text-emerald-300'
      : tone === 'warning'
        ? 'text-amber-300'
        : 'text-white';

  return (
    <div className="rounded-lg border border-slate-700/80 bg-slate-950/55 px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{formatCurrency(value)}</p>
    </div>
  );
}

export function QuoteFinancialAdjustmentsCard({
  onRefresh,
}: QuoteFinancialAdjustmentsCardProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QuoteFinancialSearchResult[]>([]);
  const [workspace, setWorkspace] = useState<QuoteFinancialWorkspace | null>(null);
  const [form, setForm] = useState<AdjustmentFormState>(() => initialForm());
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState('adjustment');
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reversalTarget, setReversalTarget] = useState<QuoteFinancialAdjustment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const searchRequestId = useRef(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const activeSearchTermRef = useRef<string | null>(null);
  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length >= FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH;

  const search = useCallback(async (value: string) => {
    const term = value.trim();
    if (term.length < FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH) {
      searchRequestId.current += 1;
      searchAbortControllerRef.current?.abort();
      searchAbortControllerRef.current = null;
      activeSearchTermRef.current = null;
      setResults([]);
      setHasSearched(false);
      setLoadingSearch(false);
      return;
    }

    if (
      activeSearchTermRef.current === term &&
      searchAbortControllerRef.current
    ) {
      return;
    }

    searchAbortControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    searchAbortControllerRef.current = controller;
    activeSearchTermRef.current = term;
    setLoadingSearch(true);
    setHasSearched(true);
    try {
      const response = await fetch(
        `/api/quotes/financial-adjustments?q=${encodeURIComponent(term)}`,
        { signal: controller.signal },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to search quotes.');
      if (searchRequestId.current === requestId) {
        setResults(payload.results || []);
      }
    } catch (error) {
      if (
        searchRequestId.current === requestId &&
        !(error instanceof Error && error.name === 'AbortError')
      ) {
        toast.error(error instanceof Error ? error.message : 'Unable to search quotes.');
      }
    } finally {
      if (searchRequestId.current === requestId) {
        setLoadingSearch(false);
      }
      if (searchAbortControllerRef.current === controller) {
        searchAbortControllerRef.current = null;
        activeSearchTermRef.current = null;
      }
    }
  }, []);

  const submitSearch = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    void search(query);
  }, [query, search]);

  useEffect(() => {
    if (!canSearch) return;

    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null;
      void search(trimmedQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [canSearch, search, trimmedQuery]);

  useEffect(
    () => () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      searchRequestId.current += 1;
      searchAbortControllerRef.current?.abort();
    },
    [],
  );

  const loadWorkspace = useCallback(async (quoteId: string) => {
    setWorkspaceOpen(true);
    setWorkspaceTab('adjustment');
    setWorkspace(null);
    setLoadingWorkspace(true);
    try {
      const response = await fetch(
        `/api/quotes/financial-adjustments?quote_id=${encodeURIComponent(quoteId)}`,
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load financial workspace.');
      const nextWorkspace = payload.workspace as QuoteFinancialWorkspace;
      setWorkspace(nextWorkspace);
      const targetQuote =
        nextWorkspace.versions.find((version) => version.is_latest_version) ||
        nextWorkspace.quote;
      setForm(initialForm(targetQuote.id));
    } catch (error) {
      setWorkspaceOpen(false);
      toast.error(
        error instanceof Error ? error.message : 'Unable to load financial workspace.',
      );
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  const selectedType = ADJUSTMENT_OPTIONS.find(
    (option) => option.value === form.adjustmentType,
  )!;
  const selectedVersion = workspace?.versions.find(
    (version) => version.id === form.quoteId,
  );
  const availableInvoices = useMemo(
    () => workspace?.invoices.filter((invoice) => invoice.quote_id === form.quoteId) || [],
    [form.quoteId, workspace?.invoices],
  );
  const selectedInvoice = availableInvoices.find(
    (invoice) => invoice.id === form.invoiceId,
  );
  const refundableAdjustments = useMemo(
    () =>
      (workspace?.adjustments || []).filter(
        (adjustment) =>
          adjustment.invoice_id === form.invoiceId &&
          !adjustment.is_reversed &&
          ['credit_note', 'invoice_void'].includes(adjustment.adjustment_type),
      ),
    [form.invoiceId, workspace?.adjustments],
  );
  useEffect(() => {
    if (!selectedInvoice) return;
    setForm((current) => ({
      ...current,
      invoiceNumber: selectedInvoice.effective_invoice_number,
      invoiceDate: selectedInvoice.effective_invoice_date,
      invoiceScope: selectedInvoice.effective_invoice_scope,
      invoiceComments: selectedInvoice.effective_comments || '',
      relatedAdjustmentId: '',
    }));
  }, [selectedInvoice]);

  function updateForm<K extends keyof AdjustmentFormState>(
    key: K,
    value: AdjustmentFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const preview = useMemo(() => {
    if (!workspace) return null;
    const amount = Number(form.amount || 0);
    let quoteDelta = 0;
    let invoiceDelta = 0;
    let writeOffDelta = 0;

    if (form.adjustmentType === 'quote_value_adjustment') {
      quoteDelta = form.direction === 'decrease' ? -amount : amount;
    } else if (form.adjustmentType === 'credit_note') {
      invoiceDelta = -amount;
    } else if (form.adjustmentType === 'debit_adjustment') {
      invoiceDelta = amount;
    } else if (form.adjustmentType === 'invoice_void') {
      invoiceDelta = -(selectedInvoice?.net_invoiced || 0);
    } else if (form.adjustmentType === 'write_off') {
      writeOffDelta = amount;
    }

    return {
      adjustedQuoteValue: workspace.thread_summary.adjusted_quote_value + quoteDelta,
      netInvoiced: workspace.thread_summary.net_invoiced + invoiceDelta,
      remaining:
        workspace.thread_summary.remaining_to_invoice +
        quoteDelta -
        invoiceDelta -
        writeOffDelta,
    };
  }, [form.adjustmentType, form.amount, form.direction, selectedInvoice?.net_invoiced, workspace]);

  function buildPayload() {
    const metadataAfter =
      form.adjustmentType === 'invoice_metadata_correction'
        ? {
            invoice_number: form.invoiceNumber,
            invoice_date: form.invoiceDate,
            invoice_scope: form.invoiceScope,
            comments: form.invoiceComments,
          }
        : undefined;

    return {
      action: 'create',
      quote_id: form.quoteId,
      invoice_id: selectedType.scope === 'invoice' ? form.invoiceId || null : null,
      related_adjustment_id:
        form.adjustmentType === 'refund' ? form.relatedAdjustmentId || null : null,
      adjustment_type: form.adjustmentType,
      amount: Number(form.amount || 0),
      direction:
        form.adjustmentType === 'quote_value_adjustment' ? form.direction : null,
      effective_date: form.effectiveDate,
      reason: form.reason,
      notes: form.notes || null,
      external_reference: form.externalReference || null,
      metadata_after: metadataAfter,
      new_status: form.newStatus === 'unchanged' ? null : form.newStatus,
      confirm_variance: form.confirmVariance,
    };
  }

  async function submitAdjustment() {
    setSaving(true);
    try {
      const response = await fetch('/api/quotes/financial-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.code === 'VARIANCE_CONFIRMATION_REQUIRED') {
          updateForm('confirmVariance', true);
        }
        throw new Error(payload.error || 'Unable to record adjustment.');
      }
      setWorkspace(payload.workspace);
      setForm(initialForm(form.quoteId));
      setConfirmOpen(false);
      toast.success(`${payload.adjustment.adjustment_number} recorded.`);
      await onRefresh?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to record adjustment.');
    } finally {
      setSaving(false);
    }
  }

  async function submitReversal() {
    if (!reversalTarget) return;
    setSaving(true);
    try {
      const response = await fetch('/api/quotes/financial-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reverse',
          adjustment_id: reversalTarget.id,
          effective_date: today(),
          reason: reversalReason,
          confirm_variance: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to reverse adjustment.');
      setWorkspace(payload.workspace);
      setReversalTarget(null);
      setReversalReason('');
      toast.success(`${reversalTarget.adjustment_number} reversed.`);
      await onRefresh?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to reverse adjustment.');
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    workspace?.can_manage &&
    form.quoteId &&
    form.reason.trim() &&
    form.effectiveDate &&
    (selectedType.scope === 'quote' || form.invoiceId) &&
    (form.adjustmentType !== 'refund' || form.relatedAdjustmentId) &&
    (form.adjustmentType === 'invoice_metadata_correction' ||
      form.adjustmentType === 'invoice_void' ||
      Number(form.amount) > 0);
  const workspaceStatus = workspace ? getQuoteStatusConfig(workspace.quote.status) : null;

  return (
    <Card className="overflow-hidden border-slate-700 bg-slate-900/75">
      <CardHeader className="border-b border-slate-700/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.78))]">
        <CardTitle className="flex items-center gap-2 text-white">
          <ShieldCheck className="h-5 w-5 text-amber-300" />
          Financial Adjustment Ledger
        </CardTitle>
        <CardDescription className="mt-2 max-w-3xl">
          Reconcile sent and completed quote threads with Sage without overwriting
          original commercial records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (nextQuery.trim().length < FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH) {
                  if (searchTimerRef.current) {
                    clearTimeout(searchTimerRef.current);
                    searchTimerRef.current = null;
                  }
                  searchRequestId.current += 1;
                  searchAbortControllerRef.current?.abort();
                  searchAbortControllerRef.current = null;
                  activeSearchTermRef.current = null;
                  setResults([]);
                  setHasSearched(false);
                  setLoadingSearch(false);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSearch) submitSearch();
              }}
              placeholder="Search quote, customer, invoice, adjustment or Sage reference"
              className={`${FORM_CONTROL_CLASS} bg-slate-950/60 pl-9`}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={submitSearch}
            disabled={loadingSearch || !canSearch}
            className={SECONDARY_ACTION_CLASS}
          >
            {loadingSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Job Number</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Customer</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Details</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Version</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    {loadingSearch
                      ? 'Searching quotes…'
                      : hasSearched
                        ? 'No matching quote threads found.'
                        : canSearch
                          ? 'Waiting to search…'
                          : `Enter at least ${FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH} characters to search.`}
                  </td>
                </tr>
              ) : results.map((result) => {
                const status = getQuoteStatusConfig(result.status);
                return (
                  <tr
                    key={result.quote_thread_id}
                    onClick={() => void loadWorkspace(result.id)}
                    className="cursor-pointer transition-colors hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-avs-yellow">
                      {result.quote_reference}
                    </td>
                    <td className="px-4 py-3 font-medium text-white">
                      {result.customer?.company_name || 'Unknown customer'}
                    </td>
                    <td className="max-w-[320px] px-4 py-3 text-xs text-slate-300">
                      <span className="block truncate">{result.subject_line || 'No subject'}</span>
                      <span className="mt-0.5 block text-slate-500">{result.base_quote_reference}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={status.color}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {result.is_latest_version ? 'Latest' : 'Historical'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={SECONDARY_ACTION_CLASS}
                        onClick={(event) => {
                          event.stopPropagation();
                          void loadWorkspace(result.id);
                        }}
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        Adjustments
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog
        open={workspaceOpen}
        onOpenChange={(open) => {
          setWorkspaceOpen(open);
          if (!open) {
            setWorkspace(null);
            setReversalTarget(null);
          }
        }}
      >
        <DialogContent
          hideCloseButton
          className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden border border-slate-700 bg-slate-950 p-0 text-white"
        >
          <DialogHeader className="relative border-b border-slate-700 bg-slate-900 px-5 py-4 pr-16 text-left">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-white">
              <SlidersHorizontal className="h-5 w-5 text-amber-300" />
              <span>
                {workspace
                  ? `${workspace.quote.quote_reference} financial adjustments`
                  : 'Financial adjustments'}
              </span>
              {workspaceStatus ? (
                <Badge variant="outline" className={workspaceStatus.color}>
                  {workspaceStatus.label}
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {workspace?.quote.customer?.company_name
                ? `${workspace.quote.customer.company_name} · `
                : ''}
              Record corrections, review version totals, and inspect immutable history.
            </DialogDescription>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Close financial adjustments"
                className={`absolute right-4 top-4 ${SECONDARY_ACTION_CLASS}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </DialogHeader>

          {loadingWorkspace ? (
            <div className="flex min-h-64 flex-1 items-center justify-center gap-2 text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading financial ledger…
            </div>
          ) : null}

          {workspace && !loadingWorkspace ? (
            <>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-4 sm:p-5">
                  {!workspace.can_manage ? (
                    <Alert className="border-sky-400/40 bg-sky-950/60">
                      <ShieldCheck className="h-4 w-4 text-sky-300" />
                      <AlertDescription className="text-sky-100">
                        Read-only access. Only Accounts, Admin, and Super Admin can record or
                        reverse adjustments.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {workspace.thread_summary.has_variance ? (
                    <Alert className="border-amber-400/40 bg-amber-950/50">
                      <AlertTriangle className="h-4 w-4 text-amber-300" />
                      <AlertDescription className="text-amber-100">
                        This thread has a reconciliation variance. Review the version totals
                        before recording another entry.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <section aria-label="Financial summary" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Adjusted quote" value={workspace.thread_summary.adjusted_quote_value} />
                    <Metric label="Net invoiced" value={workspace.thread_summary.net_invoiced} tone="positive" />
                    <Metric
                      label="Remaining"
                      value={workspace.thread_summary.remaining_to_invoice}
                      tone={workspace.thread_summary.has_variance ? 'warning' : 'default'}
                    />
                    <Metric label="Pending requests" value={workspace.thread_summary.pending_requested_total} />
                  </section>

                  <Tabs value={workspaceTab} onValueChange={setWorkspaceTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 border border-slate-700 bg-slate-900 p-1">
                      <TabsTrigger value="adjustment">New adjustment</TabsTrigger>
                      <TabsTrigger value="versions">Versions & totals</TabsTrigger>
                      <TabsTrigger value="history">
                        History ({workspace.adjustments.length})
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="adjustment" className="mt-4 space-y-4">
                      <section className="space-y-4 rounded-lg border border-slate-700 bg-slate-900/45 p-4">
                        <div>
                          <h3 className="font-semibold text-white">1. Choose the target</h3>
                          <p className="text-sm text-slate-400">
                            Select the adjustment type and the quote or invoice it applies to.
                          </p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Adjustment type" htmlFor="financial-adjustment-type" required>
                            <Select
                              value={form.adjustmentType}
                              onValueChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  adjustmentType: value as AdjustmentFormState['adjustmentType'],
                                  invoiceId: '',
                                  relatedAdjustmentId: '',
                                  amount: '',
                                  confirmVariance: false,
                                }))
                              }
                              disabled={!workspace.can_manage}
                              required
                            >
                              <SelectTrigger
                                id="financial-adjustment-type"
                                aria-required="true"
                                className={FORM_CONTROL_CLASS}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ADJUSTMENT_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>

                          <Field label="Quote version" htmlFor="financial-adjustment-quote-version" required>
                            <Select
                              value={form.quoteId}
                              onValueChange={(value) =>
                                setForm((current) => ({
                                  ...current,
                                  quoteId: value,
                                  invoiceId: '',
                                  relatedAdjustmentId: '',
                                }))
                              }
                              disabled={!workspace.can_manage}
                              required
                            >
                              <SelectTrigger
                                id="financial-adjustment-quote-version"
                                aria-required="true"
                                className={FORM_CONTROL_CLASS}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {workspace.versions.map((version) => (
                                  <SelectItem key={version.id} value={version.id}>
                                    {version.quote_reference} — {version.is_latest_version ? 'Latest' : 'Historical'}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        </div>

                        {selectedType.scope === 'invoice' ? (
                          <Field label="Invoice" htmlFor="financial-adjustment-invoice" required>
                            <Select
                              value={form.invoiceId}
                              onValueChange={(value) => updateForm('invoiceId', value)}
                              disabled={!workspace.can_manage || availableInvoices.length === 0}
                              required
                            >
                              <SelectTrigger
                                id="financial-adjustment-invoice"
                                aria-required="true"
                                className={FORM_CONTROL_CLASS}
                              >
                                <SelectValue placeholder="Select an invoice" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableInvoices.map((invoice) => (
                                  <SelectItem key={invoice.id} value={invoice.id}>
                                    {invoice.effective_invoice_number} — {formatCurrency(invoice.net_invoiced)} net
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        ) : null}

                        {form.adjustmentType === 'refund' ? (
                          <Field
                            label="Credit or void being refunded"
                            htmlFor="financial-adjustment-refund-source"
                            required
                          >
                            <Select
                              value={form.relatedAdjustmentId}
                              onValueChange={(value) => updateForm('relatedAdjustmentId', value)}
                              disabled={!workspace.can_manage || refundableAdjustments.length === 0}
                              required
                            >
                              <SelectTrigger
                                id="financial-adjustment-refund-source"
                                aria-required="true"
                                className={FORM_CONTROL_CLASS}
                              >
                                <SelectValue placeholder="Select source adjustment" />
                              </SelectTrigger>
                              <SelectContent>
                                {refundableAdjustments.map((adjustment) => (
                                  <SelectItem key={adjustment.id} value={adjustment.id}>
                                    {adjustment.adjustment_number} — {formatCurrency(adjustment.amount)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        ) : null}
                      </section>

                      <section className="space-y-4 rounded-lg border border-slate-700 bg-slate-900/45 p-4">
                        <div>
                          <h3 className="font-semibold text-white">2. Enter adjustment details</h3>
                          <p className="text-sm text-slate-400">
                            Every saved entry is permanent; corrections use a linked reversal.
                          </p>
                        </div>

                        {form.adjustmentType === 'invoice_metadata_correction' ? (
                          <div className="grid gap-4 rounded-lg border border-slate-600 bg-slate-950/50 p-3 md:grid-cols-2">
                            <p
                              id="financial-adjustment-correction-requirement"
                              className="text-sm text-slate-200 md:col-span-2"
                            >
                              <span aria-hidden="true" className="mr-1 font-semibold text-red-400">*</span>
                              <span className="sr-only">Required: </span>
                              Enter at least one corrected invoice field.
                            </p>
                            <Field label="Correct invoice number" htmlFor="financial-adjustment-correct-invoice-number">
                              <Input
                                id="financial-adjustment-correct-invoice-number"
                                value={form.invoiceNumber}
                                onChange={(event) => updateForm('invoiceNumber', event.target.value)}
                                disabled={!workspace.can_manage}
                                aria-describedby="financial-adjustment-correction-requirement"
                                className={FORM_CONTROL_CLASS}
                              />
                            </Field>
                            <Field label="Correct invoice date" htmlFor="financial-adjustment-correct-invoice-date">
                              <Input
                                id="financial-adjustment-correct-invoice-date"
                                type="date"
                                value={form.invoiceDate}
                                onChange={(event) => updateForm('invoiceDate', event.target.value)}
                                disabled={!workspace.can_manage}
                                aria-describedby="financial-adjustment-correction-requirement"
                                className={FORM_CONTROL_CLASS}
                              />
                            </Field>
                            <Field label="Correct scope" htmlFor="financial-adjustment-correct-scope">
                              <Select
                                value={form.invoiceScope}
                                onValueChange={(value) => updateForm('invoiceScope', value as 'full' | 'partial')}
                                disabled={!workspace.can_manage}
                              >
                                <SelectTrigger
                                  id="financial-adjustment-correct-scope"
                                  aria-describedby="financial-adjustment-correction-requirement"
                                  className={FORM_CONTROL_CLASS}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="partial">Partial</SelectItem>
                                  <SelectItem value="full">Full</SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field label="Correct comments" htmlFor="financial-adjustment-correct-comments">
                              <Input
                                id="financial-adjustment-correct-comments"
                                value={form.invoiceComments}
                                onChange={(event) => updateForm('invoiceComments', event.target.value)}
                                disabled={!workspace.can_manage}
                                aria-describedby="financial-adjustment-correction-requirement"
                                className={FORM_CONTROL_CLASS}
                              />
                            </Field>
                          </div>
                        ) : (
                          <div className="grid gap-4 md:grid-cols-2">
                            {form.adjustmentType === 'quote_value_adjustment' ? (
                              <Field label="Direction" htmlFor="financial-adjustment-direction" required>
                                <Select
                                  value={form.direction}
                                  onValueChange={(value) => updateForm('direction', value as 'increase' | 'decrease')}
                                  disabled={!workspace.can_manage}
                                  required
                                >
                                  <SelectTrigger
                                    id="financial-adjustment-direction"
                                    aria-required="true"
                                    className={FORM_CONTROL_CLASS}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="increase">Increase quote value</SelectItem>
                                    <SelectItem value="decrease">Decrease quote value</SelectItem>
                                  </SelectContent>
                                </Select>
                              </Field>
                            ) : null}
                            <Field
                              label={form.adjustmentType === 'invoice_void' ? 'Void amount (calculated)' : 'Amount'}
                              htmlFor="financial-adjustment-amount"
                              required={form.adjustmentType !== 'invoice_void'}
                            >
                              <Input
                                id="financial-adjustment-amount"
                                type="number"
                                min="0"
                                step="0.01"
                                value={form.adjustmentType === 'invoice_void' ? String(selectedInvoice?.net_invoiced || '') : form.amount}
                                onChange={(event) => updateForm('amount', event.target.value)}
                                disabled={!workspace.can_manage || form.adjustmentType === 'invoice_void'}
                                required={form.adjustmentType !== 'invoice_void'}
                                aria-required={form.adjustmentType !== 'invoice_void'}
                                className={FORM_CONTROL_CLASS}
                              />
                            </Field>
                          </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Effective date" htmlFor="financial-adjustment-effective-date" required>
                            <Input
                              id="financial-adjustment-effective-date"
                              type="date"
                              max={today()}
                              value={form.effectiveDate}
                              onChange={(event) => updateForm('effectiveDate', event.target.value)}
                              disabled={!workspace.can_manage}
                              required
                              aria-required="true"
                              className={FORM_CONTROL_CLASS}
                            />
                          </Field>
                          <Field label="Sage / external reference (optional)" htmlFor="financial-adjustment-external-reference">
                            <Input
                              id="financial-adjustment-external-reference"
                              value={form.externalReference}
                              onChange={(event) => updateForm('externalReference', event.target.value)}
                              disabled={!workspace.can_manage}
                              className={FORM_CONTROL_CLASS}
                            />
                          </Field>
                        </div>

                        <Field label="Reason" htmlFor="financial-adjustment-reason" required>
                          <Input
                            id="financial-adjustment-reason"
                            value={form.reason}
                            onChange={(event) => updateForm('reason', event.target.value)}
                            placeholder="Required audit reason"
                            disabled={!workspace.can_manage}
                            required
                            aria-required="true"
                            className={FORM_CONTROL_CLASS}
                          />
                        </Field>
                        <Field label="Notes (optional)" htmlFor="financial-adjustment-notes">
                          <Textarea
                            id="financial-adjustment-notes"
                            value={form.notes}
                            onChange={(event) => updateForm('notes', event.target.value)}
                            placeholder="Optional reconciliation detail"
                            disabled={!workspace.can_manage}
                            className={FORM_CONTROL_CLASS}
                          />
                        </Field>
                        <Field label="Quote status after adjustment (optional)" htmlFor="financial-adjustment-new-status">
                          <Select value={form.newStatus} onValueChange={(value) => updateForm('newStatus', value as QuoteStatus | 'unchanged')} disabled={!workspace.can_manage}>
                            <SelectTrigger id="financial-adjustment-new-status" className={FORM_CONTROL_CLASS}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unchanged">Leave unchanged</SelectItem>
                              {Object.entries(QUOTE_STATUS_CONFIG).map(([value, config]) => (
                                <SelectItem key={value} value={value}>{config.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </section>

                      {preview ? (
                        <section aria-label="Projected impact" className="rounded-lg border border-slate-600 bg-slate-900/70 p-4">
                          <h3 className="text-sm font-semibold text-white">3. Review projected impact</h3>
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div>
                              <span className="text-xs text-slate-400">Quote value</span>
                              <p className="font-semibold text-white">{formatCurrency(preview.adjustedQuoteValue)}</p>
                            </div>
                            <div>
                              <span className="text-xs text-slate-400">Net invoiced</span>
                              <p className="font-semibold text-white">{formatCurrency(preview.netInvoiced)}</p>
                            </div>
                            <div>
                              <span className="text-xs text-slate-400">Remaining</span>
                              <p className={preview.remaining < 0 ? 'font-semibold text-amber-300' : 'font-semibold text-white'}>{formatCurrency(preview.remaining)}</p>
                            </div>
                          </div>
                        </section>
                      ) : null}

                      {form.confirmVariance ? (
                        <label className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-950/50 p-3 text-sm text-amber-100">
                          <Checkbox
                            checked={form.confirmVariance}
                            onCheckedChange={(checked) => updateForm('confirmVariance', checked === true)}
                            className="border-amber-300 bg-slate-950 text-slate-950 focus-visible:ring-amber-300 data-[state=checked]:bg-amber-300"
                          />
                          I confirm this adjustment may leave a reconciliation variance requiring follow-up.
                        </label>
                      ) : null}
                    </TabsContent>

                    <TabsContent value="versions" className="mt-4 space-y-4">
                      <section className="rounded-lg border border-slate-700 bg-slate-900/45 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="font-semibold text-white">Reconciliation totals</h3>
                            <p className="text-sm text-slate-400">
                              Credits, refunds, write-offs, and gross invoicing across this thread.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void loadWorkspace(workspace.quote.id)}
                            aria-label="Refresh ledger"
                            className={SECONDARY_ACTION_CLASS}
                          >
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                          </Button>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <Metric label="Gross invoiced" value={workspace.thread_summary.gross_invoiced} />
                          <Metric label="Credits & voids" value={workspace.thread_summary.credits_total + workspace.thread_summary.voids_total} />
                          <Metric label="Refunded cash" value={workspace.thread_summary.refunds_total} />
                          <Metric label="Written off" value={workspace.thread_summary.write_offs_total} />
                        </div>
                      </section>

                      <section className="rounded-lg border border-slate-700 bg-slate-900/45 p-4">
                        <h3 className="font-semibold text-white">Version breakdown</h3>
                        <p className="text-sm text-slate-400">
                          Superseded base values are excluded from the thread total.
                        </p>
                        <div className="mt-4 space-y-2">
                          {workspace.versions.map((version) => {
                            const summary = workspace.version_summaries[version.id];
                            return (
                              <div key={version.id} className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-medium text-white">{version.quote_reference}</span>
                                  <Badge variant="outline">{version.revision_type.replace('_', ' ')}</Badge>
                                </div>
                                <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-slate-400">
                                  <span>Adjusted {formatCurrency(summary?.adjusted_quote_value || 0)}</span>
                                  <span>Net {formatCurrency(summary?.net_invoiced || 0)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </TabsContent>

                    <TabsContent value="history" className="mt-4">
                      <section className="rounded-lg border border-slate-700 bg-slate-900/45 p-4">
                        <h3 className="font-semibold text-white">Immutable history</h3>
                        <p className="text-sm text-slate-400">
                          Download records or create a linked reversal without changing the original.
                        </p>
                        <div className="mt-4 space-y-2">
                          {workspace.adjustments.length === 0 ? (
                            <p className="rounded-lg border border-slate-700 bg-slate-950/40 py-8 text-center text-sm text-slate-400">
                              No financial adjustments recorded.
                            </p>
                          ) : workspace.adjustments.map((adjustment) => (
                            <div key={adjustment.id} className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-white">{adjustment.adjustment_number}</span>
                                    <Badge variant={adjustment.is_reversed ? 'secondary' : 'outline'}>
                                      {adjustment.is_reversed ? 'Reversed' : formatType(adjustment.adjustment_type)}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-sm text-slate-300">{adjustment.reason}</p>
                                  <p className="mt-1 text-xs text-slate-500">{adjustment.effective_date} · {adjustment.actor?.full_name || 'Unknown user'}</p>
                                </div>
                                <span className="font-semibold tabular-nums text-white">{adjustment.amount > 0 ? formatCurrency(adjustment.amount) : 'Details'}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button asChild variant="outline" size="sm" className={SECONDARY_ACTION_CLASS}>
                                  <a href={`/api/quotes/financial-adjustments/${adjustment.id}/document`} target="_blank" rel="noreferrer">
                                    <Download className="h-3.5 w-3.5" />
                                    PDF
                                  </a>
                                </Button>
                                {workspace.can_manage && !adjustment.is_reversed && adjustment.adjustment_type !== 'reversal' ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setReversalTarget(adjustment)}
                                    className={DANGER_ACTION_CLASS}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Reverse
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </TabsContent>
                  </Tabs>
                </div>
              </ScrollArea>

              <DialogFooter className="border-t border-slate-700 bg-slate-900 px-4 py-3 sm:px-5">
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={saving} className={SECONDARY_ACTION_CLASS}>
                    Close
                  </Button>
                </DialogClose>
                {workspaceTab === 'adjustment' ? (
                  <Button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canSubmit || saving}
                    className={PRIMARY_ACTION_CLASS}
                  >
                    <FileClock className="h-4 w-4" />
                    Review immutable entry
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border-slate-700 bg-slate-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Record immutable financial adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              This entry cannot be edited or deleted. If it is wrong, Accounts must
              create a linked reversal and replacement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm">
            <div className="flex items-center gap-2 text-white">
              {form.direction === 'increase' || form.adjustmentType === 'debit_adjustment'
                ? <ArrowUpRight className="h-4 w-4 text-emerald-300" />
                : <ArrowDownRight className="h-4 w-4 text-amber-300" />}
              {formatType(form.adjustmentType)}
            </div>
            <p className="mt-2 text-slate-300">{selectedVersion?.quote_reference} · {form.reason}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving} className={SECONDARY_ACTION_CLASS}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void submitAdjustment(); }}
              disabled={saving}
              className={PRIMARY_ACTION_CLASS}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Record adjustment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(reversalTarget)} onOpenChange={(open) => { if (!open) setReversalTarget(null); }}>
        <AlertDialogContent className="border-slate-700 bg-slate-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse {reversalTarget?.adjustment_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              The original remains in history and a new linked reversal is added.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field label="Reversal reason" htmlFor="financial-adjustment-reversal-reason" required>
            <Input
              id="financial-adjustment-reversal-reason"
              value={reversalReason}
              onChange={(event) => setReversalReason(event.target.value)}
              placeholder="Required audit reason"
              required
              aria-required="true"
              className={FORM_CONTROL_CLASS}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving} className={SECONDARY_ACTION_CLASS}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void submitReversal(); }}
              disabled={saving || !reversalReason.trim()}
              className={DANGER_ACTION_CLASS}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Create reversal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  required = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-1 font-semibold text-red-400">*</span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </Label>
      {children}
    </div>
  );
}
