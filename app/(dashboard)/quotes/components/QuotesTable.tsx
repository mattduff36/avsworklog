'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import {
  Search,
  Plus,
  ChevronUp,
  ChevronDown,
  Receipt,
} from 'lucide-react';
import type { Quote, QuoteStatus } from '../types';
import { QUOTE_STATUS_CONFIG } from '../types';

interface QuotesTableProps {
  quotes: Quote[];
  onAdd: () => void;
  onRowClick: (quote: Quote) => void;
  statusFilter: QuoteStatus | 'all';
  onStatusFilterChange: (s: QuoteStatus | 'all') => void;
}

type SortField = 'quote_reference' | 'customer' | 'quote_date' | 'total' | 'status';
type SortDir = 'asc' | 'desc';

export function QuotesTable({ quotes, onAdd, onRowClick, statusFilter, onStatusFilterChange }: QuotesTableProps) {
  const [search, setSearch] = useState('');
  const [poFilter, setPoFilter] = useState<'all' | 'with_po' | 'without_po'>('all');
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'not_invoiced' | 'partially_invoiced' | 'invoiced'>('all');
  const [commercialFilter, setCommercialFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [sortField, setSortField] = useState<SortField>('quote_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filtered = useMemo(() => {
    let list = quotes;

    if (statusFilter !== 'all') {
      list = list.filter(q => q.status === statusFilter);
    }

    if (poFilter === 'with_po') {
      list = list.filter(q => Boolean(q.po_number));
    } else if (poFilter === 'without_po') {
      list = list.filter(q => !q.po_number);
    }

    if (invoiceFilter !== 'all') {
      list = list.filter(q => q.invoice_summary?.status === invoiceFilter);
    }

    if (commercialFilter !== 'all') {
      list = list.filter(q => q.commercial_status === commercialFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(quote =>
        quote.quote_reference.toLowerCase().includes(q) ||
        quote.base_quote_reference.toLowerCase().includes(q) ||
        quote.customer?.company_name?.toLowerCase().includes(q) ||
        quote.subject_line?.toLowerCase().includes(q) ||
        quote.attention_name?.toLowerCase().includes(q) ||
        quote.po_number?.toLowerCase().includes(q) ||
        quote.invoice_number?.toLowerCase().includes(q) ||
        quote.manager_name?.toLowerCase().includes(q)
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
  }, [quotes, search, statusFilter, poFilter, invoiceFilter, commercialFilter, sortField, sortDir]);

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
    const counts: Partial<Record<QuoteStatus | 'all', number>> = { all: quotes.length };
    quotes.forEach(q => { counts[q.status] = (counts[q.status] || 0) + 1; });
    return counts;
  }, [quotes]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search quotes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-slate-800 border-slate-600 text-white placeholder:text-muted-foreground"
          />
        </div>
        <Button onClick={onAdd} className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90 font-semibold">
          <Plus className="h-4 w-4 mr-1" /> New Quote
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={poFilter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setPoFilter('all')}
          className={poFilter === 'all' ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90' : 'border-slate-600 text-muted-foreground'}
        >
          All PO
        </Button>
        <Button
          variant={poFilter === 'with_po' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setPoFilter('with_po')}
          className={poFilter === 'with_po' ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90' : 'border-slate-600 text-muted-foreground'}
        >
          PO Received
        </Button>
        <Button
          variant={poFilter === 'without_po' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setPoFilter('without_po')}
          className={poFilter === 'without_po' ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90' : 'border-slate-600 text-muted-foreground'}
        >
          No PO
        </Button>
        <Button
          variant={invoiceFilter === 'not_invoiced' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setInvoiceFilter(invoiceFilter === 'not_invoiced' ? 'all' : 'not_invoiced')}
          className={invoiceFilter === 'not_invoiced' ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90' : 'border-slate-600 text-muted-foreground'}
        >
          Not Invoiced
        </Button>
        <Button
          variant={invoiceFilter === 'partially_invoiced' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setInvoiceFilter(invoiceFilter === 'partially_invoiced' ? 'all' : 'partially_invoiced')}
          className={invoiceFilter === 'partially_invoiced' ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90' : 'border-slate-600 text-muted-foreground'}
        >
          Partially Invoiced
        </Button>
        <Button
          variant={commercialFilter === 'open' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCommercialFilter(commercialFilter === 'open' ? 'all' : 'open')}
          className={commercialFilter === 'open' ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90' : 'border-slate-600 text-muted-foreground'}
        >
          Open
        </Button>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'draft', 'pending_internal_approval', 'changes_requested', 'approved', 'sent', 'po_received', 'in_progress', 'completed_part', 'completed_full', 'partially_invoiced', 'invoiced', 'closed', 'lost'] as const).map(s => {
          const cfg = s === 'all' ? { label: 'All', color: '' } : QUOTE_STATUS_CONFIG[s];
          const count = statusCounts[s] || 0;
          const isActive = statusFilter === s;
          return (
            <Button
              key={s}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => onStatusFilterChange(s)}
              className={isActive
                ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90'
                : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'
              }
            >
              {cfg.label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </Button>
          );
        })}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 border-b border-slate-700">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-white" onClick={() => toggleSort('quote_reference')}>
                Reference {renderSortIcon('quote_reference')}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Version</th>
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
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Invoice</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-muted-foreground">
                  {search ? 'No quotes match your search.' : 'No quotes yet. Create your first quote to get started.'}
                </td>
              </tr>
            ) : (
              filtered.map(quote => {
                const cfg = QUOTE_STATUS_CONFIG[quote.status];
                return (
                  <tr
                    key={quote.id}
                    onClick={() => onRowClick(quote)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-avs-yellow">{quote.quote_reference}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">{quote.version_label || 'Original'}</td>
                    <td className="px-4 py-3 text-white">{quote.customer?.company_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs truncate max-w-[200px]">{quote.subject_line || '—'}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">
                      £{Number(quote.total || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">{quote.po_number || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">{quote.invoice_summary?.status.replace(/_/g, ' ') || quote.invoice_number || '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      £{Number(quote.invoice_summary?.remainingBalance ?? quote.total ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
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
            const cfg = QUOTE_STATUS_CONFIG[quote.status];
            return (
              <div
                key={quote.id}
                onClick={() => onRowClick(quote)}
                className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-2 cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-avs-yellow" />
                    <span className="font-mono font-semibold text-avs-yellow">{quote.quote_reference}</span>
                  </div>
                  <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
                </div>
                <div className="text-xs text-slate-400">{quote.version_label || 'Original'}</div>
                <div className="text-sm text-white">{quote.customer?.company_name}</div>
                {quote.subject_line && (
                  <div className="text-xs text-muted-foreground truncate">{quote.subject_line}</div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(quote.quote_date), 'dd/MM/yyyy')}</span>
                  <span className="font-semibold text-white">
                    £{Number(quote.total || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Remaining: £{Number(quote.invoice_summary?.remainingBalance ?? quote.total ?? 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
