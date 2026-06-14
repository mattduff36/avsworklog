'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import { buildQuoteDisplayName } from '@/lib/quotes/quote-display-name';
import { cn } from '@/lib/utils';
import type { Quote, QuoteListSummary, QuoteSageStatus, QuoteStatus } from '../types';
import { ACTIVE_QUOTE_STATUS_ORDER, getQuoteStatusConfig } from '../types';

interface QuotesTableProps {
  quotes: Quote[];
  statusCounts?: QuoteListSummary['status_counts'];
  onRowClick: (quote: Quote) => void;
  managerFilter?: string;
}

type SortField = 'quote_reference' | 'customer' | 'quote_date' | 'total' | 'status';
type SortDir = 'asc' | 'desc';
type PoFilter = 'with_po' | 'without_po';
type BillingFilter = 'not_invoiced' | 'ready_to_invoice' | 'partially_invoiced' | 'invoiced';

const BILLING_FILTER_OPTIONS = [
  { value: 'not_invoiced', label: 'Not billed' },
  { value: 'ready_to_invoice', label: 'Ready to invoice' },
  { value: 'partially_invoiced', label: 'Part billed' },
  { value: 'invoiced', label: 'Fully billed' },
] as const;

const PO_FILTER_OPTIONS = [
  { value: 'with_po', label: 'With PO' },
  { value: 'without_po', label: 'No PO' },
] as const;

const SAGE_FILTER_OPTIONS = [
  { value: 'not_on_sage', label: 'Not on Sage' },
  { value: 'on_sage', label: 'On Sage' },
] as const;

const STATUS_COLUMN_BADGE_CLASS = 'whitespace-nowrap';

function formatCurrency(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return `£${amount.toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function quoteMatchesStatus(quote: Quote, status: QuoteStatus) {
  if (status === 'closed') {
    return quote.status === 'closed' || quote.commercial_status === 'closed';
  }

  return quote.status === status;
}

function isTestCustomerName(name: string | null | undefined) {
  return name?.toLowerCase().includes('test customer') ?? false;
}

function getBillingStatusConfig(status: NonNullable<Quote['invoice_summary']>['status'] | undefined) {
  switch (status) {
    case 'ready_to_invoice':
      return { label: 'Ready to invoice', color: 'border-violet-500/30 text-violet-300 bg-violet-500/10' };
    case 'partially_invoiced':
      return { label: 'Part billed', color: 'border-fuchsia-500/30 text-fuchsia-300 bg-fuchsia-500/10' };
    case 'invoiced':
      return { label: 'Fully billed', color: 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' };
    default:
      return { label: 'Not billed', color: 'border-slate-500/30 text-slate-300 bg-slate-500/10' };
  }
}

function getQuoteSageStatus(quote: Pick<Quote, 'sage_posted_at'>): QuoteSageStatus {
  return quote.sage_posted_at ? 'on_sage' : 'not_on_sage';
}

function getSageStatusConfig(status: QuoteSageStatus) {
  switch (status) {
    case 'on_sage':
      return { label: 'On Sage', color: 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' };
    default:
      return { label: 'Not on Sage', color: 'border-slate-500/30 text-slate-300 bg-slate-500/10' };
  }
}

function getInvoiceProgress(quote: Quote) {
  const total = Number(quote.total || 0);
  const invoicedTotal = Number(quote.invoice_summary?.invoicedTotal || 0);
  const pendingRequestedTotal = Number(quote.invoice_summary?.pendingRequestedTotal || 0);
  const invoicedPercent = total > 0
    ? Math.min(100, Math.max(0, Math.round((invoicedTotal / total) * 100)))
    : 0;
  const pendingPercent = total > 0
    ? Math.min(100 - invoicedPercent, Math.max(0, Math.round((pendingRequestedTotal / total) * 100)))
    : 0;

  return {
    invoicedTotal,
    pendingRequestedTotal,
    invoicedPercent,
    pendingPercent,
  };
}

function InvoiceProgressBadge({ quote }: { quote: Quote }) {
  const { invoicedTotal, pendingRequestedTotal, invoicedPercent, pendingPercent } = getInvoiceProgress(quote);

  return (
    <div
      className="relative inline-flex min-w-[150px] overflow-hidden rounded-full border border-emerald-500/30 bg-slate-800 text-xs font-semibold text-emerald-100"
      title={`${formatCurrency(invoicedTotal)} invoiced${pendingRequestedTotal > 0 ? `, ${formatCurrency(pendingRequestedTotal)} pending request` : ''}`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-emerald-500/35"
        style={{ width: `${invoicedPercent}%` }}
      />
      {pendingPercent > 0 ? (
        <span
          className="absolute inset-y-0 bg-violet-500/45"
          style={{
            left: `${invoicedPercent}%`,
            width: `${pendingPercent}%`,
          }}
        />
      ) : null}
      <span className="relative z-10 w-full px-3 py-1 text-center">
        {formatCurrency(invoicedTotal)}
      </span>
    </div>
  );
}

interface MultiSelectFilterOption<TValue extends string> {
  value: TValue;
  label: string;
  count?: number;
}

interface MultiSelectFilterProps<TValue extends string> {
  label: string;
  allLabel: string;
  selectedValues: TValue[];
  options: readonly MultiSelectFilterOption<TValue>[];
  onSelectedValuesChange: (values: TValue[]) => void;
  triggerClassName?: string;
}

interface DateRangeFilterProps {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
}

function getMultiSelectTriggerLabel<TValue extends string>({
  allLabel,
  selectedValues,
  options,
}: {
  allLabel: string;
  selectedValues: TValue[];
  options: readonly MultiSelectFilterOption<TValue>[];
}) {
  if (selectedValues.length === 0) return allLabel;
  if (selectedValues.length === 1) {
    return options.find((option) => option.value === selectedValues[0])?.label || allLabel;
  }
  return `${selectedValues.length} selected`;
}

function MultiSelectFilter<TValue extends string>({
  label,
  allLabel,
  selectedValues,
  options,
  onSelectedValuesChange,
  triggerClassName,
}: MultiSelectFilterProps<TValue>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-filter-menu`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!containerRef.current?.contains(target)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function toggleValue(value: TValue) {
    if (selectedValues.includes(value)) {
      onSelectedValuesChange(selectedValues.filter((selectedValue) => selectedValue !== value));
      return;
    }

    onSelectedValuesChange([...selectedValues, value]);
  }

  return (
    <div ref={containerRef} className={cn('relative w-full sm:w-[150px]', triggerClassName)}>
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="w-full justify-between border-slate-600 bg-slate-800 text-white hover:bg-slate-700"
      >
        <span className="truncate">
          {getMultiSelectTriggerLabel({ allLabel, selectedValues, options })}
        </span>
        <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </Button>

      {open ? (
        <div
          id={panelId}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-1 text-sm text-slate-200 shadow-xl"
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <label className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left hover:bg-slate-800">
            <input
              type="checkbox"
              checked={selectedValues.length === 0}
              onChange={() => onSelectedValuesChange([])}
              className="h-4 w-4 accent-avs-yellow"
            />
            <span>{allLabel}</span>
          </label>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left hover:bg-slate-800"
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value)}
                onChange={() => toggleValue(option.value)}
                className="h-4 w-4 accent-avs-yellow"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {typeof option.count === 'number' && option.count > 0 ? (
                <span className="text-xs text-slate-400">({option.count})</span>
              ) : null}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getDateRangeTriggerLabel(fromDate: string, toDate: string) {
  if (fromDate && toDate) return `${fromDate} to ${toDate}`;
  if (fromDate) return `From ${fromDate}`;
  if (toDate) return `To ${toDate}`;
  return 'All dates';
}

function DateRangeFilter({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = 'quote-date-range-filter-menu';

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!containerRef.current?.contains(target)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full sm:w-[210px]">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="w-full justify-between border-slate-600 bg-slate-800 text-white hover:bg-slate-700"
      >
        <span className="truncate">{getDateRangeTriggerLabel(fromDate, toDate)}</span>
        <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </Button>

      {open ? (
        <div
          id={panelId}
          className="absolute left-0 top-full z-40 mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 shadow-xl"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Date Range</p>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">From</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(event) => onFromDateChange(event.target.value)}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">To</span>
              <Input
                type="date"
                value={toDate}
                onChange={(event) => onToDateChange(event.target.value)}
                className="border-slate-700 bg-slate-900 text-white"
              />
            </label>
            {(fromDate || toDate) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onFromDateChange('');
                  onToDateChange('');
                }}
                className="w-full text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Clear dates
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function QuotesTable({
  quotes,
  statusCounts: providedStatusCounts,
  onRowClick,
  managerFilter = 'all',
}: QuotesTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<QuoteStatus[]>([]);
  const [poFilters, setPoFilters] = useState<PoFilter[]>([]);
  const [invoiceFilters, setInvoiceFilters] = useState<BillingFilter[]>([]);
  const [sageFilters, setSageFilters] = useState<QuoteSageStatus[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortField, setSortField] = useState<SortField>('quote_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

  function quoteMatchesSearch(quote: Quote, query: string) {
    return (
      quote.quote_reference.toLowerCase().includes(query) ||
      quote.base_quote_reference.toLowerCase().includes(query) ||
      buildQuoteDisplayName(quote).toLowerCase().includes(query) ||
      quote.customer?.company_name?.toLowerCase().includes(query) ||
      quote.subject_line?.toLowerCase().includes(query) ||
      quote.attention_name?.toLowerCase().includes(query) ||
      quote.po_number?.toLowerCase().includes(query) ||
      quote.invoice_number?.toLowerCase().includes(query) ||
      quote.manager_name?.toLowerCase().includes(query)
    );
  }

  const filtered = useMemo(() => {
    let list = quotes;

    if (statusFilters.length > 0) {
      list = list.filter(q => statusFilters.some((status) => quoteMatchesStatus(q, status)));
    }

    if (managerFilter !== 'all') {
      list = list.filter(q => q.requester_id === managerFilter);
    }

    if (poFilters.length > 0) {
      list = list.filter(q =>
        poFilters.some((poFilter) => (
          poFilter === 'with_po' ? Boolean(q.po_number) : !q.po_number
        ))
      );
    }

    if (invoiceFilters.length > 0) {
      list = list.filter(q => invoiceFilters.includes(q.invoice_summary?.status as BillingFilter));
    }

    if (sageFilters.length > 0) {
      list = list.filter(q => sageFilters.includes(getQuoteSageStatus(q)));
    }

    if (fromDate) {
      list = list.filter(q => q.quote_date >= fromDate);
    }

    if (toDate) {
      list = list.filter(q => q.quote_date <= toDate);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(quote =>
        quoteMatchesSearch(quote, q) ||
        (quote.previous_versions || []).some(version => quoteMatchesSearch(version, q))
      );
    }

    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'quote_reference':
          cmp = a.quote_reference.localeCompare(b.quote_reference);
          break;
        case 'customer':
          cmp = (a.customer?.company_name || '').localeCompare(b.customer?.company_name || '');
          break;
        case 'quote_date':
          cmp = a.quote_date.localeCompare(b.quote_date);
          break;
        case 'total':
          cmp = Number(a.total) - Number(b.total);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [quotes, search, statusFilters, managerFilter, poFilters, invoiceFilters, sageFilters, fromDate, toDate, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 inline ml-1" />
      : <ChevronDown className="h-3 w-3 inline ml-1" />;
  }

  const statusCounts = useMemo(() => {
    const localCounts = ACTIVE_QUOTE_STATUS_ORDER.reduce<Record<QuoteStatus | 'all', number>>(
      (acc, status) => ({ ...acc, [status]: 0 }),
      { all: quotes.length } as Record<QuoteStatus | 'all', number>
    );

    quotes.forEach((quote) => {
      localCounts[quote.status] = (localCounts[quote.status] || 0) + 1;
      if (quote.commercial_status === 'closed' && quote.status !== 'closed') {
        localCounts.closed = (localCounts.closed || 0) + 1;
      }
    });

    if (providedStatusCounts) {
      return {
        ...providedStatusCounts,
        closed: Math.max(providedStatusCounts.closed || 0, localCounts.closed || 0),
      };
    }

    return localCounts;
  }, [providedStatusCounts, quotes]);

  const statusFilterOptions = useMemo<MultiSelectFilterOption<QuoteStatus>[]>(
    () => ACTIVE_QUOTE_STATUS_ORDER
      .filter((status) => (statusCounts[status] || 0) > 0)
      .map((status) => ({
        value: status,
        label: getQuoteStatusConfig(status).label,
        count: statusCounts[status] || 0,
      })),
    [statusCounts]
  );

  function toggleThread(threadId: string) {
    setExpandedThreads(prev => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  }

  const hasAnyFilters = statusFilters.length > 0 || poFilters.length > 0 || invoiceFilters.length > 0 || sageFilters.length > 0 || Boolean(fromDate || toDate);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search quotes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-slate-800 border-slate-600 text-white placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 lg:items-end">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Filters</p>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          {hasAnyFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilters([]);
                setPoFilters([]);
                setInvoiceFilters([]);
                setSageFilters([]);
                setFromDate('');
                setToDate('');
              }}
              className="border-slate-600 text-muted-foreground hover:bg-slate-700/50"
            >
              Reset Filters
            </Button>
          ) : null}

          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
          />

          <MultiSelectFilter
            label="Workflow Status"
            allLabel="All workflow"
            selectedValues={statusFilters}
            options={statusFilterOptions}
            onSelectedValuesChange={setStatusFilters}
            triggerClassName="sm:w-[170px]"
          />

          <MultiSelectFilter
            label="PO"
            allLabel="All PO"
            selectedValues={poFilters}
            options={PO_FILTER_OPTIONS}
            onSelectedValuesChange={setPoFilters}
            triggerClassName="sm:w-[140px]"
          />

          <MultiSelectFilter
            label="Billing"
            allLabel="All billing"
            selectedValues={invoiceFilters}
            options={BILLING_FILTER_OPTIONS}
            onSelectedValuesChange={setInvoiceFilters}
            triggerClassName="sm:w-[150px]"
          />

          <MultiSelectFilter
            label="Sage"
            allLabel="All Sage"
            selectedValues={sageFilters}
            options={SAGE_FILTER_OPTIONS}
            onSelectedValuesChange={setSageFilters}
            triggerClassName="sm:w-[150px]"
          />
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 border-b border-slate-700">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('quote_reference')}>
                Job Number {renderSortIcon('quote_reference')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('customer')}>
                Customer {renderSortIcon('customer')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Details</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('quote_date')}>
                Date {renderSortIcon('quote_date')}
              </th>
              <th className="text-right px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('total')}>
                Total {renderSortIcon('total')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">PO Number</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('status')}>
                Status {renderSortIcon('status')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Invoiced</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-muted-foreground">
                  {search ? 'No quotes match your search.' : 'No quotes yet. Create your first quote to get started.'}
                </td>
              </tr>
            ) : (
              filtered.map(quote => {
                const cfg = getQuoteStatusConfig(quote.status);
                const billingCfg = getBillingStatusConfig(quote.invoice_summary?.status);
                const sageCfg = getSageStatusConfig(getQuoteSageStatus(quote));
                const previousVersions = quote.previous_versions || [];
                const isExpanded = Boolean(expandedThreads[quote.quote_thread_id]);
                const quoteDisplayName = buildQuoteDisplayName(quote);
                const quoteCustomerName = quote.customer?.company_name;
                return (
                  <Fragment key={quote.id}>
                    <tr
                      key={quote.id}
                      onClick={() => onRowClick(quote)}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-avs-yellow">
                        <div className="flex items-center gap-2">
                          {previousVersions.length > 0 ? (
                            <button
                              type="button"
                              aria-label={isExpanded ? 'Collapse quote versions' : 'Expand quote versions'}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleThread(quote.quote_thread_id);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-700"
                            >
                              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          ) : (
                            <span className="inline-flex h-6 w-6" />
                          )}
                          <span>{quote.quote_reference}</span>
                        </div>
                      </td>
                      <td className={cn('px-4 py-3 text-white', isTestCustomerName(quoteCustomerName) && 'text-red-300')}>
                        {quoteCustomerName || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs max-w-[240px]">
                        <span className="line-clamp-2 leading-snug text-white">{quoteDisplayName}</span>
                        {quote.subject_line ? (
                          <span className="mt-1 block truncate text-muted-foreground">{quote.subject_line}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white">
                        {formatCurrency(quote.total)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">{quote.po_number || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, cfg.color)}>{cfg.label}</Badge>
                          {quote.commercial_status === 'closed' && (
                            <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, 'border-slate-300/30 text-slate-200 bg-slate-400/10')}>Archived</Badge>
                          )}
                          <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, billingCfg.color)}>{billingCfg.label}</Badge>
                          <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, sageCfg.color)}>{sageCfg.label}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        <InvoiceProgressBadge quote={quote} />
                      </td>
                    </tr>
                    {isExpanded ? previousVersions.map(version => {
                      const versionCfg = getQuoteStatusConfig(version.status);
                      const versionBillingCfg = getBillingStatusConfig(version.invoice_summary?.status);
                      const versionSageCfg = getSageStatusConfig(getQuoteSageStatus(version));
                      const versionDisplayName = buildQuoteDisplayName(version);
                      const versionCustomerName = version.customer?.company_name || quote.customer?.company_name;
                      return (
                        <tr
                          key={version.id}
                          onClick={() => onRowClick(version)}
                          className="cursor-pointer bg-slate-900/40 text-slate-400 transition-colors hover:bg-slate-800/40"
                        >
                          <td className="px-4 py-3 font-mono">
                            <div className="flex items-center gap-2 pl-8">
                              <ChevronRight className="h-3.5 w-3.5 rotate-90 text-slate-500" />
                              <span>{version.quote_reference}</span>
                            </div>
                          </td>
                          <td className={cn('px-4 py-3', isTestCustomerName(versionCustomerName) && 'text-red-300')}>
                            {versionCustomerName || '—'}
                          </td>
                          <td className="px-4 py-3 text-xs max-w-[240px]">
                            <span className="line-clamp-2 leading-snug">{versionDisplayName}</span>
                            {version.subject_line ? (
                              <span className="mt-1 block truncate text-slate-500">{version.subject_line}</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs">{format(new Date(version.quote_date), 'dd/MM/yyyy')}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatCurrency(version.total)}
                          </td>
                          <td className="px-4 py-3 text-xs">{version.po_number || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, versionCfg.color)}>{versionCfg.label}</Badge>
                              {version.commercial_status === 'closed' && (
                                <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, 'border-slate-300/30 text-slate-300 bg-slate-400/10')}>Archived</Badge>
                              )}
                              <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, versionBillingCfg.color)}>{versionBillingCfg.label}</Badge>
                              <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, versionSageCfg.color)}>{versionSageCfg.label}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <InvoiceProgressBadge quote={version} />
                          </td>
                        </tr>
                      );
                    }) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? 'No quotes match your search.' : 'No quotes yet.'}
          </div>
        ) : (
          filtered.map(quote => {
            const cfg = getQuoteStatusConfig(quote.status);
            const billingCfg = getBillingStatusConfig(quote.invoice_summary?.status);
            const sageCfg = getSageStatusConfig(getQuoteSageStatus(quote));
            const previousVersions = quote.previous_versions || [];
            const isExpanded = Boolean(expandedThreads[quote.quote_thread_id]);
            const quoteDisplayName = buildQuoteDisplayName(quote);
            const quoteCustomerName = quote.customer?.company_name;
            return (
              <div
                key={quote.id}
                onClick={() => onRowClick(quote)}
                className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-2 cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {previousVersions.length > 0 ? (
                      <button
                        type="button"
                        aria-label={isExpanded ? 'Collapse quote versions' : 'Expand quote versions'}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleThread(quote.quote_thread_id);
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-700"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>
                    ) : null}
                    <Receipt className="h-4 w-4 text-avs-yellow" />
                    <span className="font-mono font-semibold text-avs-yellow">{quote.quote_reference}</span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, cfg.color)}>{cfg.label}</Badge>
                    {quote.commercial_status === 'closed' && (
                      <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, 'border-slate-300/30 text-slate-200 bg-slate-400/10')}>Archived</Badge>
                    )}
                    <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, billingCfg.color)}>{billingCfg.label}</Badge>
                    <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, sageCfg.color)}>{sageCfg.label}</Badge>
                  </div>
                </div>
                <div className="text-xs text-slate-400">{quote.version_label || 'Original'}</div>
                <div className="text-sm text-white">{quoteDisplayName}</div>
                <div className={cn('text-xs text-slate-400', isTestCustomerName(quoteCustomerName) && 'text-red-300')}>
                  {quoteCustomerName}
                </div>
                {quote.subject_line && (
                  <div className="text-xs text-muted-foreground truncate">{quote.subject_line}</div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</span>
                  <span className="font-semibold text-white">
                    {formatCurrency(quote.total)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <InvoiceProgressBadge quote={quote} />
                </div>
                {isExpanded && previousVersions.length > 0 ? (
                  <div className="space-y-2 border-t border-slate-700/60 pt-3">
                    {previousVersions.map(version => {
                      const versionCfg = getQuoteStatusConfig(version.status);
                      const versionDisplayName = buildQuoteDisplayName(version);
                      return (
                        <button
                          key={version.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRowClick(version);
                          }}
                          className="block w-full rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2 text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <ChevronRight className="h-3.5 w-3.5 rotate-90 text-slate-500" />
                              <span className="truncate font-mono text-xs text-slate-300">{version.quote_reference}</span>
                            </div>
                            <Badge variant="outline" className={cn(STATUS_COLUMN_BADGE_CLASS, versionCfg.color)}>{versionCfg.label}</Badge>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {version.version_label || 'Original'}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] text-slate-300">
                            {versionDisplayName}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
