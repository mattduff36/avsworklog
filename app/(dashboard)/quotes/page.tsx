'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { QuotesTable } from './components/QuotesTable';
import { QuoteDetailsModal } from './components/QuoteDetailsModal';
import { QuoteFormDialog } from './components/QuoteFormDialog';
import type { Quote, QuoteFormData, QuoteManagerOption, QuoteStatus } from './types';

interface CustomerOption {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  default_validity_days: number;
}

interface ApproverOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

export default function QuotesPage() {
  const { hasPermission: canViewQuotes, loading: permissionLoading } = usePermissionCheck('quotes', false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [managerOptions, setManagerOptions] = useState<QuoteManagerOption[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');

  // Modals
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  const customerId = searchParams.get('customer_id');
  const quoteIdFromQuery = searchParams.get('quote_id');

  const fetchData = useCallback(async () => {
    try {
      const url = customerId ? `/api/quotes?customer_id=${customerId}` : '/api/quotes';
      const [quotesRes, customersRes, metadataRes] = await Promise.all([
        fetch(url),
        fetch('/api/customers'),
        fetch('/api/quotes/metadata'),
      ]);

      if (quotesRes.ok) {
        const data = await quotesRes.json();
        setQuotes(data.quotes || []);
      }
      if (customersRes.ok) {
        const data = await customersRes.json();
        setCustomers(data.customers || []);
      }
      if (metadataRes.ok) {
        const data = await metadataRes.json();
        setManagerOptions(data.managerOptions || []);
        setApprovers(data.approvers || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load quotes');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (permissionLoading) return;
    if (!canViewQuotes) {
      toast.error('Access denied');
      router.push('/dashboard');
      return;
    }
    fetchData();
  }, [permissionLoading, canViewQuotes, router, fetchData]);

  useEffect(() => {
    if (quoteIdFromQuery) {
      setDetailQuoteId(quoteIdFromQuery);
    }
  }, [quoteIdFromQuery]);

  async function handleCreate(data: QuoteFormData) {
    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create quote');
    }
    toast.success('Quote created');
    await fetchData();
  }

  async function handleUpdate(data: QuoteFormData) {
    if (!editingQuote) return;
    const res = await fetch(`/api/quotes/${editingQuote.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update quote');
    }
    toast.success('Quote updated');
    setEditingQuote(null);
    await fetchData();
  }

  async function handleSubmit(data: QuoteFormData, isEdit: boolean) {
    if (isEdit) {
      await handleUpdate(data);
    } else {
      await handleCreate(data);
    }
  }

  function handleRowClick(quote: Quote) {
    setDetailQuoteId(quote.id);
  }

  function handleEditFromModal(quote: Quote) {
    setEditingQuote(quote);
    setFormOpen(true);
  }

  if (permissionLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-avs-yellow" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-avs-yellow/10">
          <Receipt className="h-5 w-5 text-avs-yellow" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            {customerId ? 'Customer quotes' : 'Manage customer quotations'}
          </p>
        </div>
      </div>

      <QuotesTable
        quotes={quotes}
        onAdd={() => { setEditingQuote(null); setFormOpen(true); }}
        onRowClick={handleRowClick}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <QuoteDetailsModal
        open={!!detailQuoteId}
        onClose={() => setDetailQuoteId(null)}
        quoteId={detailQuoteId}
        onEdit={handleEditFromModal}
        onRefresh={fetchData}
      />

      <QuoteFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingQuote(null); }}
        onSubmit={handleSubmit}
        quote={editingQuote}
        customers={customers}
        managerOptions={managerOptions}
        approvers={approvers}
        initialCustomerId={customerId}
      />
    </div>
  );
}
