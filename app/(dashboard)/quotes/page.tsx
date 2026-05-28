'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { CalendarClock, Plus, Receipt, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { PageLoader } from '@/components/ui/page-loader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SensitiveModuleGate, SensitiveModuleSessionManager, useSensitiveModuleAccess } from '@/components/security/SensitiveModuleGate';
import { QuotesTable } from './components/QuotesTable';
import { QuoteDetailsModal } from './components/QuoteDetailsModal';
import { QuoteFormDialog } from './components/QuoteFormDialog';
import { QuoteSettingsTab, type QuoteSettingsSubTab } from './components/settings/QuoteSettingsTab';
import { uploadQuoteAttachment } from './quote-attachment-client';
import type { Quote, QuoteFormData, QuoteListSummary, QuoteManagerOption, QuoteStatus } from './types';

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

type QuotePageTab = 'overview' | 'settings';

function isQuotePageTab(value: string): value is QuotePageTab {
  return value === 'overview' || value === 'settings';
}

function isQuoteSettingsSubTab(value: string): value is QuoteSettingsSubTab {
  return ['notifications', 'managers', 'sending', 'schedule', 'admin-tools'].includes(value);
}

function buildFormRequestError(payload: { error?: string; field_errors?: Record<string, string> }, fallback: string) {
  const error = new Error(payload.error || fallback) as Error & { fieldErrors?: Record<string, string> };
  error.fieldErrors = payload.field_errors || {};
  return error;
}

async function buildResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(payload?.error || fallback);
}

function buildQuotePayload(data: QuoteFormData) {
  const { attachment_files: _attachmentFiles, ...payload } = data;
  return payload;
}

async function uploadClientQuoteAttachments(quoteId: string, files?: File[]) {
  if (!files?.length) return;

  await Promise.all(files.map(file => uploadQuoteAttachment({
    quoteId,
    file,
    isClientVisible: true,
    attachmentPurpose: 'client_pricing',
  })));
}

export default function QuotesPage() {
  const { hasPermission: canViewQuotes, loading: permissionLoading } = usePermissionCheck('quotes', false);
  const { hasPermission: canViewCustomers, loading: customerPermissionLoading } = usePermissionCheck('customers', false);
  const sensitiveAccess = useSensitiveModuleAccess('quotes');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const syncQuoteQuery = useCallback((nextQuoteId: string | null) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextQuoteId) {
      nextParams.set('quote_id', nextQuoteId);
    } else {
      nextParams.delete('quote_id');
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);


  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteSummary, setQuoteSummary] = useState<QuoteListSummary | null>(null);
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
  const tabParam = searchParams.get('tab') || 'overview';
  const pageTab: QuotePageTab = isQuotePageTab(tabParam) ? tabParam : 'overview';
  const settingsParam = searchParams.get('settings') || 'notifications';
  const settingsTab: QuoteSettingsSubTab = isQuoteSettingsSubTab(settingsParam) ? settingsParam : 'notifications';
  const managerParam = searchParams.get('manager') || 'all';
  const activeManagerOptions = useMemo(
    () => managerOptions.filter(option => option.is_active),
    [managerOptions]
  );
  const activeManagerIds = useMemo(
    () => new Set(activeManagerOptions.map(option => option.profile_id)),
    [activeManagerOptions]
  );
  const managerFilter = managerParam === 'all' || activeManagerIds.has(managerParam) ? managerParam : 'all';

  const fetchData = useCallback(async () => {
    try {
      const url = customerId ? `/api/quotes?customer_id=${customerId}` : '/api/quotes';
      const [quotesResult, metadataRes] = await Promise.all([
        fetchAllPaginatedItems<Quote>(url, 'quotes', {
          limit: 250,
          errorMessage: 'Failed to load quotes',
        }),
        fetch('/api/quotes/metadata'),
      ]);

      setQuotes(quotesResult.items);
      setQuoteSummary((quotesResult.firstPagePayload?.summary as QuoteListSummary | undefined) || null);
      if (metadataRes.ok) {
        const data = await metadataRes.json();
        setCustomers(canViewCustomers ? data.customers || [] : []);
        setManagerOptions(data.managerOptions || []);
        setApprovers(data.approvers || []);
      }
    } catch (error) {
      const errorContextId = 'quotes-fetch-data-error';
      console.error('Error fetching data:', error, { errorContextId });
      toast.error('Unable to load quotes right now.', { id: errorContextId });
    } finally {
      setLoading(false);
    }
  }, [canViewCustomers, customerId]);

  useEffect(() => {
    if (permissionLoading || customerPermissionLoading || sensitiveAccess.loading) return;
    if (!canViewQuotes) {
      toast.error('You do not have access to quotes.', { id: 'quotes-access-denied' });
      router.push('/dashboard');
      return;
    }
    if (!sensitiveAccess.canAccess) return;
    fetchData();
  }, [permissionLoading, customerPermissionLoading, sensitiveAccess.loading, sensitiveAccess.canAccess, canViewQuotes, router, fetchData]);

  useEffect(() => {
    setDetailQuoteId(quoteIdFromQuery);
  }, [quoteIdFromQuery]);

  async function handleCreate(data: QuoteFormData) {
    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQuotePayload(data)),
    });
    if (!res.ok) {
      const err = await res.json();
      throw buildFormRequestError(err, 'Failed to create quote');
    }
    const payload = await res.json();
    await uploadClientQuoteAttachments(payload.quote.id, data.attachment_files);
    toast.success('Quote created');
    await fetchData();
  }

  async function handleUpdate(data: QuoteFormData) {
    if (!editingQuote) return;
    const res = await fetch(`/api/quotes/${editingQuote.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQuotePayload(data)),
    });
    if (!res.ok) {
      const err = await res.json();
      throw buildFormRequestError(err, 'Failed to update quote');
    }
    await uploadClientQuoteAttachments(editingQuote.id, data.attachment_files);
    toast.success('Quote updated');
    setEditingQuote(null);
    await fetchData();
  }

  async function handleEditingQuoteAttachmentsChange(quoteId: string) {
    const res = await fetch(`/api/quotes/${quoteId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(err?.error || 'Unable to refresh quote attachments.');
    }

    const payload = await res.json() as { quote: Quote };
    setEditingQuote(current => current?.id === quoteId ? payload.quote : current);
    await fetchData();
    return payload.quote;
  }

  async function handleSubmit(data: QuoteFormData, isEdit: boolean) {
    if (isEdit) {
      await handleUpdate(data);
    } else {
      await handleCreate(data);
    }
  }

  function handleOpenQuoteDetails(nextQuoteId: string) {
    setDetailQuoteId(nextQuoteId);
    syncQuoteQuery(nextQuoteId);
  }

  function handleCloseQuoteDetails() {
    setDetailQuoteId(null);
    syncQuoteQuery(null);
  }

  function handleRowClick(quote: Quote) {
    handleOpenQuoteDetails(quote.id);
  }

  function handleEditFromModal(quote: Quote) {
    setEditingQuote(quote);
    setFormOpen(true);
  }

  function handlePageTabChange(nextTab: QuotePageTab) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', nextTab);
    if (nextTab === 'settings') {
      nextParams.set('settings', settingsTab);
    } else {
      nextParams.delete('settings');
    }
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  function handleManagerFilterChange(nextManagerId: string) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', 'overview');
    nextParams.delete('settings');
    if (nextManagerId === 'all') {
      nextParams.delete('manager');
    } else {
      nextParams.set('manager', nextManagerId);
    }
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  function handleSettingsTabChange(nextTab: QuoteSettingsSubTab) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', 'settings');
    nextParams.set('settings', nextTab);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  async function handleDeleteQuote(quote: Quote) {
    try {
      const res = await fetch(`/api/quotes/${quote.id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw await buildResponseError(res, 'Unable to delete this quote right now.');
      }

      toast.success(`Quote ${quote.quote_reference} deleted`);
      if (detailQuoteId === quote.id) {
        handleCloseQuoteDetails();
      }
      await fetchData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete this quote right now.';
      toast.error(message);
    }
  }

  if (permissionLoading || customerPermissionLoading || sensitiveAccess.loading || (sensitiveAccess.canAccess && loading)) {
    return <PageLoader message="Loading quotes..." />;
  }

  if (!canViewQuotes) {
    return <PageLoader message="Redirecting..." />;
  }

  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell>
        <SensitiveModuleGate moduleLabel="Quotes" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell>
      <SensitiveModuleSessionManager moduleLabel="Quotes" access={sensitiveAccess} />
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-border p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-avs-yellow/10">
              <Receipt className="h-5 w-5 text-avs-yellow" />
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-foreground">Quotes</h1>
              <p className="text-muted-foreground">
                {customerId ? 'Track and manage quotes for this customer.' : 'Create, review, and manage customer quotations.'}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Link href="/quotes/work-calendar" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full border-border text-muted-foreground sm:w-auto">
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Work Calendar
                </Button>
              </Link>
              <Button
                onClick={() => {
                  if (!canViewCustomers) return;
                  setEditingQuote(null);
                  setFormOpen(true);
                }}
                disabled={!canViewCustomers}
                aria-describedby={!canViewCustomers ? 'quotes-customer-access-note' : undefined}
                className="w-full bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90 font-semibold disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Quote
              </Button>
            </div>
            {!canViewCustomers ? (
              <p id="quotes-customer-access-note" className="text-xs text-muted-foreground">
                Customer access is required to create quotes.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs
        value={pageTab}
        onValueChange={(value) => {
          if (isQuotePageTab(value)) handlePageTabChange(value);
        }}
      >
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <Receipt className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {pageTab === 'overview' ? (
          <div className="mt-3 flex justify-end">
            <Tabs value={managerFilter} onValueChange={handleManagerFilterChange}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="all" className="gap-2">
                  All Quotes
                </TabsTrigger>
                {activeManagerOptions.map(option => (
                  <TabsTrigger key={option.profile_id} value={option.profile_id} className="gap-2">
                    {option.profile?.full_name || option.signoff_name || option.initials}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <TabsContent value="overview" className="space-y-6 mt-0">
          <QuotesTable
            quotes={quotes}
            statusCounts={quoteSummary?.status_counts}
            onRowClick={handleRowClick}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            managerFilter={managerFilter}
          />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6 mt-0">
          <QuoteSettingsTab
            activeTab={settingsTab}
            onTabChange={handleSettingsTabChange}
            quotes={quotes}
            onDeleteQuote={handleDeleteQuote}
            onRefresh={fetchData}
          />
        </TabsContent>
      </Tabs>

      <QuoteDetailsModal
        open={!!detailQuoteId}
        onClose={handleCloseQuoteDetails}
        quoteId={detailQuoteId}
        onQuoteChange={handleOpenQuoteDetails}
        onEdit={handleEditFromModal}
        onRefresh={fetchData}
      />

      <QuoteFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingQuote(null); }}
        onSubmit={handleSubmit}
        onAttachmentsChange={handleEditingQuoteAttachmentsChange}
        quote={editingQuote}
        customers={customers}
        managerOptions={managerOptions}
        approvers={approvers}
        initialCustomerId={customerId}
      />
    </AppPageShell>
  );
}
