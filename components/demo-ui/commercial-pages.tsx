'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  SensitiveModuleGate,
  SensitiveModuleSessionManager,
  useSensitiveModuleAccess,
} from '@/components/security/SensitiveModuleGate';
import { useDemoApiData } from '@/components/demo-ui/demo-data';
import { useDemoMutation } from '@/components/demo-ui/demo-mutation-provider';
import {
  DemoDataTable,
  DemoEmptyState,
  DemoErrorState,
  DemoLoadingState,
  DemoPageHeader,
  DemoStat,
  DemoStatusPill,
  DemoToolbar,
  type DemoDataTableColumn,
} from '@/components/demo-ui/demo-primitives';

interface DemoQuote {
  id: string;
  reference: string | null;
  title: string | null;
  status: string;
  total: number | string | null;
  created_at: string;
  valid_until: string | null;
  customer?: {
    company_name?: string | null;
    short_name?: string | null;
  } | null;
}

interface QuotesResponse {
  quotes: DemoQuote[];
  summary?: {
    total_quotes?: number;
    accepted_value?: number;
    status_counts?: Record<string, number>;
  };
}

interface DemoCustomer {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  postcode: string | null;
  status: string;
}

interface CustomersResponse {
  customers: DemoCustomer[];
}

function formatMoney(value: number | string | null | undefined): string {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function QuotesData() {
  const [status, setStatus] = useState('all');
  const quotes = useDemoApiData<QuotesResponse>('quotes', '/api/quotes?limit=100');
  const rows = useMemo(
    () => (quotes.data?.quotes || []).filter((quote) => status === 'all' || quote.status === status),
    [quotes.data, status]
  );
  const statuses = useMemo(
    () => Array.from(new Set((quotes.data?.quotes || []).map((quote) => quote.status))).sort(),
    [quotes.data]
  );
  const columns: DemoDataTableColumn<DemoQuote>[] = [
    {
      key: 'reference',
      label: 'Reference',
      render: (quote) => (
        <Link
          href={quote.reference ? `/quotes/overview/${encodeURIComponent(quote.reference)}` : '/quotes'}
          className="dui-table-link"
        >
          {quote.reference || 'Open quote'}
        </Link>
      ),
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (quote) => quote.customer?.short_name || quote.customer?.company_name || 'Not assigned',
    },
    { key: 'title', label: 'Work', render: (quote) => quote.title || 'Untitled quote' },
    { key: 'created', label: 'Created', render: (quote) => formatDate(quote.created_at) },
    {
      key: 'value',
      label: 'Value',
      numeric: true,
      render: (quote) => formatMoney(quote.total),
    },
    { key: 'status', label: 'Status', render: (quote) => <DemoStatusPill status={quote.status} /> },
  ];

  if (quotes.isLoading) return <DemoLoadingState rows={8} />;
  if (quotes.error) {
    return <DemoErrorState message={quotes.error.message} onRetry={() => void quotes.refetch()} />;
  }

  return (
    <>
      <DemoToolbar>
        <label className="dui-field">
          <span>Pipeline stage</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All stages</option>
            {statuses.map((option) => (
              <option value={option} key={option}>
                {option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </DemoToolbar>
      <div className="dui-inline-stats">
        <DemoStat label="Visible quotes" value={rows.length} />
        <DemoStat
          label="Accepted value"
          value={formatMoney(quotes.data?.summary?.accepted_value)}
        />
      </div>
      {rows.length === 0 ? (
        <DemoEmptyState title="No quotes match" description="Try a different pipeline stage." />
      ) : (
        <DemoDataTable
          rows={rows}
          columns={columns}
          getRowKey={(quote) => quote.id}
          caption="Live commercial quote pipeline"
        />
      )}
    </>
  );
}

export function DemoQuotesPage() {
  const sensitiveAccess = useSensitiveModuleAccess('quotes');

  return (
    <>
      <DemoPageHeader
        title="Quotes"
        description="A gated view of the live commercial pipeline and current quote state."
        actions={
          <Link href="/quotes" className="dui-button dui-button-primary">
            Manage quotes
            <ExternalLink aria-hidden="true" />
          </Link>
        }
      />
      {sensitiveAccess.loading ? <DemoLoadingState label="Checking sensitive quote access" /> : null}
      {!sensitiveAccess.loading && !sensitiveAccess.state ? (
        <DemoErrorState
          title="Sensitive access unavailable"
          message="Quote access could not be verified, so no commercial data was requested."
          onRetry={() => void sensitiveAccess.refresh()}
        />
      ) : null}
      {!sensitiveAccess.loading && sensitiveAccess.state && !sensitiveAccess.canAccess ? (
        <SensitiveModuleGate moduleLabel="Quotes" access={sensitiveAccess} />
      ) : null}
      {!sensitiveAccess.loading && sensitiveAccess.canAccess ? (
        <>
          <SensitiveModuleSessionManager moduleLabel="Quotes" access={sensitiveAccess} />
          <QuotesData />
        </>
      ) : null}
    </>
  );
}

function CustomersData() {
  const [search, setSearch] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const { canMutate, mutationFetch, writeState } = useDemoMutation();
  const customers = useDemoApiData<CustomersResponse>(
    'customers',
    '/api/customers?limit=300'
  );
  const rows = useMemo(
    () =>
      (customers.data?.customers || []).filter((customer) => {
        const text = `${customer.company_name} ${customer.short_name || ''} ${customer.contact_name || ''} ${customer.city || ''}`.toLowerCase();
        return !deferredSearch || text.includes(deferredSearch);
      }),
    [customers.data, deferredSearch]
  );
  const columns: DemoDataTableColumn<DemoCustomer>[] = [
    {
      key: 'company',
      label: 'Company',
      render: (customer) => (
        <Link href={`/customers/${customer.id}/history`} className="dui-table-link">
          {customer.company_name}
        </Link>
      ),
    },
    { key: 'contact', label: 'Primary contact', render: (customer) => customer.contact_name || 'Not recorded' },
    { key: 'email', label: 'Email', render: (customer) => customer.contact_email || 'Not recorded' },
    { key: 'phone', label: 'Phone', render: (customer) => customer.contact_phone || 'Not recorded' },
    {
      key: 'location',
      label: 'Location',
      render: (customer) => [customer.city, customer.postcode].filter(Boolean).join(' ') || 'Not recorded',
    },
    { key: 'status', label: 'Status', render: (customer) => <DemoStatusPill status={customer.status} /> },
  ];

  if (customers.isLoading) return <DemoLoadingState rows={8} />;
  if (customers.error) {
    return (
      <DemoErrorState
        message={customers.error.message}
        onRetry={() => void customers.refetch()}
      />
    );
  }

  async function handleCreateCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await mutationFetch<{ customer: DemoCustomer }>('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          short_name: '',
          contact_name: contactName,
          contact_email: contactEmail,
          contact_phone: '',
          contact_job_title: '',
          address_line_1: '',
          address_line_2: '',
          city: '',
          county: '',
          postcode: '',
          payment_terms_days: 30,
          default_validity_days: 30,
          status: 'active',
          notes: '',
          secondary_contacts: [],
        }),
      });

      if (!result) return;
      setCompanyName('');
      setContactName('');
      setContactEmail('');
      toast.success(`${result.customer.company_name} was added.`);
      await customers.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The customer could not be added.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DemoToolbar>
        <label className="dui-field dui-field-grow">
          <span>Search directory</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Company, contact or location"
          />
        </label>
      </DemoToolbar>
      <details className="dui-inline-create">
        <summary>Add customer</summary>
        <form onSubmit={handleCreateCustomer}>
          <label className="dui-field">
            <span>Company name</span>
            <input
              required
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
          </label>
          <label className="dui-field">
            <span>Primary contact</span>
            <input value={contactName} onChange={(event) => setContactName(event.target.value)} />
          </label>
          <label className="dui-field">
            <span>Contact email</span>
            <input
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </label>
          <div className="dui-inline-create-actions">
            <small>
              {writeState === 'enabled'
                ? 'This creates a live customer record.'
                : 'Customer creation is unavailable while the demo is read-only.'}
            </small>
            <button
              type="submit"
              className="dui-button dui-button-primary"
              disabled={!canMutate || saving || companyName.trim().length === 0}
            >
              {saving ? 'Adding...' : 'Add customer'}
            </button>
          </div>
        </form>
      </details>
      {rows.length === 0 ? (
        <DemoEmptyState title="No customers match" description="Clear the search or try another company name." />
      ) : (
        <DemoDataTable
          rows={rows}
          columns={columns}
          getRowKey={(customer) => customer.id}
          caption="Live customer directory"
        />
      )}
    </>
  );
}

export function DemoCustomersPage() {
  const sensitiveAccess = useSensitiveModuleAccess('customers');

  return (
    <>
      <DemoPageHeader
        title="Customers"
        description="A protected live directory with customer and primary contact context."
      />
      {sensitiveAccess.loading ? <DemoLoadingState label="Checking sensitive customer access" /> : null}
      {!sensitiveAccess.loading && !sensitiveAccess.state ? (
        <DemoErrorState
          title="Sensitive access unavailable"
          message="Customer access could not be verified, so no directory data was requested."
          onRetry={() => void sensitiveAccess.refresh()}
        />
      ) : null}
      {!sensitiveAccess.loading && sensitiveAccess.state && !sensitiveAccess.canAccess ? (
        <SensitiveModuleGate moduleLabel="Customers" access={sensitiveAccess} />
      ) : null}
      {!sensitiveAccess.loading && sensitiveAccess.canAccess ? (
        <>
          <SensitiveModuleSessionManager moduleLabel="Customers" access={sensitiveAccess} />
          <CustomersData />
        </>
      ) : null}
    </>
  );
}
