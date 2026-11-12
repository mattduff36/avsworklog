/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { registerAuthRecoveryHandlers } from '@/lib/app-auth/recovery-bridge';
import { createAuthAwareFetch } from '@/lib/utils/fetch-with-auth';

import QuotesPage from '@/app/(dashboard)/quotes/page';

const replaceMock = vi.fn();
const pushMock = vi.fn();
const routerMock = { push: pushMock, replace: replaceMock };
const mockUsePermissionCheck = vi.fn();
const mockUseAuth = vi.fn();
const mockFetchAllPaginatedItems = vi.fn();
const quotesTableMock = vi.fn();
const quoteFormDialogMock = vi.fn();
const customerFormDialogMock = vi.fn();
const quoteDetailsModalMock = vi.fn();
const projectNumbersTabMock = vi.fn();
const refreshSensitiveAccessMock = vi.fn();
const recoverFromAuthFailureMock = vi.fn();
const forceAuthRedirectMock = vi.fn();
let searchParamsMock = new URLSearchParams();
let sensitiveCanAccess = true;
let unregisterAuthRecovery: () => void;

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/quotes',
  useSearchParams: () => searchParamsMock,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: (moduleName: string, redirectOnFail?: boolean) =>
    mockUsePermissionCheck(moduleName, redirectOnFail),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/client/paginated-fetch', () => ({
  fetchAllPaginatedItems: (...args: unknown[]) => mockFetchAllPaginatedItems(...args),
}));

vi.mock('@/components/layout/AppPageShell', () => ({
  AppPageShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/page-loader', () => ({
  PageLoader: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock('@/components/ui/tabs', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  interface TabsContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  interface TabsProps extends TabsContextValue {
    children: ReactNode;
    className?: string;
  }

  interface TabsTriggerProps {
    value: string;
    children: ReactNode;
    className?: string;
    title?: string;
  }

  interface TabsContentProps {
    value: string;
    children: ReactNode;
    className?: string;
  }

  const TabsContext = React.createContext<TabsContextValue>({});

  return {
    Tabs: ({ children, value, onValueChange, className }: TabsProps) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div className={className}>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    TabsTrigger: ({ children, value, className, title }: TabsTriggerProps) => {
      const tabs = React.useContext(TabsContext);

      return (
        <button
          type="button"
          role="tab"
          aria-selected={tabs.value === value}
          className={className}
          title={title}
          onMouseDown={() => tabs.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ children, value, className }: TabsContentProps) => {
      const tabs = React.useContext(TabsContext);
      if (tabs.value !== value) return null;

      return <div className={className}>{children}</div>;
    },
  };
});

vi.mock('@/components/security/SensitiveModuleGate', () => ({
  SensitiveModuleGate: () => <div>Sensitive module gate</div>,
  SensitiveModuleSessionManager: () => null,
  useSensitiveModuleAccess: () => ({
    canAccess: sensitiveCanAccess,
    loading: false,
    status: {
      requiresSensitivePin: false,
      hasPin: true,
      unlocked: true,
      expiresAt: null,
    },
    refresh: refreshSensitiveAccessMock,
  }),
}));

vi.mock('@/app/(dashboard)/quotes/components/QuotesTable', () => ({
  QuotesTable: (props: { quotes: Array<{ id: string }>; managerFilter?: string; emptyMessage?: string }) => {
    quotesTableMock(props);
    return <div>Quotes table</div>;
  },
}));

vi.mock('@/app/(dashboard)/quotes/components/QuoteDetailsModal', () => ({
  QuoteDetailsModal: (props: { onEdit: (quote: { id: string }) => Promise<void> }) => {
    quoteDetailsModalMock(props);
    return <button onClick={() => void props.onEdit({ id: 'quote-1' })}>Edit quote</button>;
  },
}));

vi.mock('@/app/(dashboard)/quotes/components/QuoteFormDialog', () => ({
  QuoteFormDialog: (props: { open: boolean; customers: Array<{ id: string; company_name: string }>; onAddCustomer: () => void }) => {
    quoteFormDialogMock(props);
    return props.open ? <div data-testid="quote-form-dialog"><button onClick={props.onAddCustomer}>Add customer</button></div> : null;
  },
}));

vi.mock('@/app/(dashboard)/customers/components/CustomerFormDialog', () => ({
  CustomerFormDialog: (props: { open: boolean }) => {
    customerFormDialogMock(props);
    return props.open ? <div data-testid="customer-form-dialog" /> : null;
  },
}));

vi.mock('@/app/(dashboard)/quotes/components/ProjectNumbersTab', () => ({
  ProjectNumbersTab: (props: { customers: Array<{ id: string }>; managerOptions: Array<{ profile_id: string }> }) => {
    projectNumbersTabMock(props);
    return <div>Quote projects</div>;
  },
}));

describe('Quotes page customer access states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sensitiveCanAccess = true;
    refreshSensitiveAccessMock.mockResolvedValue(undefined);
    recoverFromAuthFailureMock.mockResolvedValue(false);
    forceAuthRedirectMock.mockResolvedValue(undefined);
    unregisterAuthRecovery = registerAuthRecoveryHandlers({
      recoverFromAuthFailure: recoverFromAuthFailureMock,
      forceAuthRedirect: forceAuthRedirectMock,
    });
    searchParamsMock = new URLSearchParams();
    window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
      isAdmin: false,
      isSuperAdmin: false,
      isActualSuperAdmin: false,
      forceAuthRedirect: forceAuthRedirectMock,
    });

    mockUsePermissionCheck.mockImplementation((moduleName: string) => {
      if (moduleName === 'quotes') {
        return { hasPermission: true, loading: false };
      }

      if (moduleName === 'customers') {
        return { hasPermission: false, loading: false };
      }

      return { hasPermission: false, loading: false };
    });

    mockFetchAllPaginatedItems.mockResolvedValue({
      items: [],
      firstPagePayload: null,
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    unregisterAuthRecovery();
    vi.restoreAllMocks();
  });

  function allowCustomers() {
    mockUsePermissionCheck.mockReturnValue({ hasPermission: true, loading: false });
  }

  function mockMetadataResponses(
    customersResponse: () => Promise<Response>,
    metadataResponse: () => Promise<Response> = async () => Response.json({ managerOptions: [], approvers: [] })
  ) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/quotes/metadata?include_customers=true') return (await customersResponse()).clone();
      if (url === '/api/quotes/metadata') return (await metadataResponse()).clone();
      return Response.json({});
    });
    global.fetch = fetchMock;
    return fetchMock;
  }

  it.each([
    { loading: true, user: { id: 'user-1' } },
    { loading: false, user: null },
  ])('does not fetch quotes or customer metadata before auth readiness: %j', async (auth) => {
    allowCustomers();
    searchParamsMock = new URLSearchParams('tab=projects');
    const readyAuth = mockUseAuth();
    mockUseAuth.mockReturnValue({ ...readyAuth, ...auth });
    const fetchMock = mockMetadataResponses(async () => Response.json({ customers: [] }));
    const { rerender } = render(<QuotesPage />);

    expect(screen.getByText('Loading quotes...')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFetchAllPaginatedItems).not.toHaveBeenCalled();

    mockUseAuth.mockReturnValue(readyAuth);
    rerender(<QuotesPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/quotes/metadata?include_customers=true'));
    await screen.findByText('Quote projects');
  });

  it('recovers a customer metadata 401 without opening a form or logging an unexpected error', async () => {
    allowCustomers();
    searchParamsMock = new URLSearchParams('tab=current&manager=manager-filter');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = mockMetadataResponses(async () => Response.json(
      { error: 'You must be signed in to use quotes.' }, { status: 401 }
    ));
    // Exercise the same global 401 interception installed by AuthProvider.
    global.fetch = createAuthAwareFetch(fetchMock);
    let resolveRecovery!: (recovered: boolean) => void;
    recoverFromAuthFailureMock.mockReturnValue(new Promise<boolean>((resolve) => { resolveRecovery = resolve; }));

    render(<QuotesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));

    await screen.findByText('Refreshing your session...');
    expect(recoverFromAuthFailureMock).toHaveBeenCalledExactlyOnceWith({ statusCode: 401 });
    expect(toast.info).toHaveBeenCalledWith(
      'Refreshing your session. Sign in again if prompted.', { id: 'quotes-session-required' }
    );
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('customer-form-dialog')).not.toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    await act(async () => { resolveRecovery(false); });
    await screen.findByText('Redirecting to sign in...');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/quotes/metadata?include_customers=true')).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('requires a fresh successful customer request after session recovery before opening a form', async () => {
    allowCustomers();
    searchParamsMock = new URLSearchParams('tab=current');
    recoverFromAuthFailureMock.mockResolvedValue(true);
    const customer = { id: 'customer-1', company_name: 'Example customer' };
    const customerResponses = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'You must be signed in to use quotes.' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ customers: [customer] }));
    const fetchMock = mockMetadataResponses(customerResponses);
    render(<QuotesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await waitFor(() => {
      expect(recoverFromAuthFailureMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/quotes/metadata')).toHaveLength(2);
    });
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await screen.findByTestId('quote-form-dialog');
    expect(customerResponses).toHaveBeenCalledTimes(2);
    expect(quoteFormDialogMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ customers: [customer] }));
  });

  it('redirects rather than looping if a fresh request is still unauthorized after recovery', async () => {
    allowCustomers();
    recoverFromAuthFailureMock.mockResolvedValue(true);
    const metadataResponse = vi.fn()
      .mockResolvedValueOnce(Response.json({ managerOptions: [], approvers: [] }))
      .mockResolvedValue(Response.json({ error: 'You must be signed in to use quotes.' }, { status: 401 }));
    const fetchMock = mockMetadataResponses(
      async () => Response.json({ error: 'You must be signed in to use quotes.' }, { status: 401 }),
      metadataResponse
    );
    global.fetch = createAuthAwareFetch(fetchMock);
    render(<QuotesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await screen.findByText('Redirecting to sign in...');
    expect(recoverFromAuthFailureMock).toHaveBeenCalled();
    expect(forceAuthRedirectMock).toHaveBeenCalledExactlyOnceWith(401);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/quotes/metadata')).toHaveLength(2);
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();
  });

  it.each([403, 500])('preserves customer metadata HTTP %i as an unexpected failure', async (status) => {
    allowCustomers();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMetadataResponses(async () => Response.json({ error: 'Metadata network request failed' }, { status }));
    render(<QuotesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Unable to load customers right now.', { id: 'quotes-fetch-customers-error' }
    ));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error fetching quote customers:', expect.objectContaining({ status }),
      { errorContextId: 'quotes-fetch-customers-error' }
    );
    expect(recoverFromAuthFailureMock).not.toHaveBeenCalled();
    expect(forceAuthRedirectMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();
  });

  it('preserves the sensitive PIN recovery flow on customer metadata 428', async () => {
    allowCustomers();
    refreshSensitiveAccessMock.mockImplementation(async () => { sensitiveCanAccess = false; });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMetadataResponses(async () => Response.json({ error: 'Sensitive PIN required' }, { status: 428 }));
    render(<QuotesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await screen.findByText('Sensitive module gate');
    expect(refreshSensitiveAccessMock).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      'Quotes locked. Enter your sensitive PIN to continue.', { id: 'quotes-fetch-customers-error' }
    );
    expect(recoverFromAuthFailureMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();
  });

  it('clears loaded customers, managers, approvers and open forms after an initial-metadata refresh returns 401', async () => {
    allowCustomers();
    searchParamsMock = new URLSearchParams('tab=current');
    const staleCustomer = { id: 'stale-customer', company_name: 'Example customer' };
    const staleManager = { profile_id: 'stale-manager', initials: 'EX', profile: { full_name: 'Example manager' } };
    let unauthorized = false;
    let freshMetadata = false;
    let resolveRecovery!: (recovered: boolean) => void;
    recoverFromAuthFailureMock.mockReturnValue(new Promise<boolean>((resolve) => { resolveRecovery = resolve; }));
    mockMetadataResponses(
      async () => Response.json({
        customers: freshMetadata ? [] : [staleCustomer],
        managerOptions: freshMetadata ? [] : [staleManager],
        approvers: freshMetadata ? [] : [{ id: 'stale-approver' }],
      }),
      async () => unauthorized
        ? Response.json({ error: 'You must be signed in to use quotes.' }, { status: 401 })
        : Response.json({ managerOptions: [], approvers: [] })
    );
    const { rerender } = render(<QuotesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await screen.findByTestId('quote-form-dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    await screen.findByTestId('customer-form-dialog');

    unauthorized = true;
    searchParamsMock = new URLSearchParams('tab=current&customer_id=another-customer');
    rerender(<QuotesPage />);
    await screen.findByText('Refreshing your session...');
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('customer-form-dialog')).not.toBeInTheDocument();

    unauthorized = false;
    freshMetadata = true;
    await act(async () => { resolveRecovery(true); });
    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await screen.findByTestId('quote-form-dialog');
    expect(quoteFormDialogMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      customers: [],
      managerOptions: [],
      approvers: [],
      quote: null,
      createdCustomerId: null,
    }));
    expect(screen.queryByTestId('customer-form-dialog')).not.toBeInTheDocument();
    expect(recoverFromAuthFailureMock).toHaveBeenCalledExactlyOnceWith({ statusCode: 401 });
  });

  it('does not open the edit form when fetching its customers returns 401', async () => {
    allowCustomers();
    searchParamsMock = new URLSearchParams('tab=current&quote_id=quote-1');
    mockFetchAllPaginatedItems.mockResolvedValue({
      items: [{ id: 'quote-1', status: 'draft', commercial_status: 'open' }],
      firstPagePayload: null,
    });
    mockMetadataResponses(async () => Response.json(
      { error: 'You must be signed in to use quotes.' }, { status: 401 }
    ));
    render(<QuotesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit quote' }));
    await screen.findByText('Redirecting to sign in...');
    expect(screen.queryByRole('button', { name: 'Edit quote' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();
    expect(recoverFromAuthFailureMock).toHaveBeenCalledExactlyOnceWith({ statusCode: 401 });
  });

  it('recovers an initial quote-list 401 without treating it as an unexpected error', async () => {
    searchParamsMock = new URLSearchParams('tab=current');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetchAllPaginatedItems.mockRejectedValue(Object.assign(
      new Error('You must be signed in to use quotes.'), { status: 401 }
    ));
    render(<QuotesPage />);

    await screen.findByText('Redirecting to sign in...');
    expect(recoverFromAuthFailureMock).toHaveBeenCalledExactlyOnceWith({ statusCode: 401 });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Quotes table')).not.toBeInTheDocument();
  });

  it.each(['legacy', 'projects'])('holds the %s tab on 401 without retrying or exposing stale data', async (tab) => {
    allowCustomers();
    searchParamsMock = new URLSearchParams(`tab=${tab}`);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetchAllPaginatedItems.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/quotes/legacy') {
        throw Object.assign(new Error('You must be signed in to use quotes.'), { status: 401 });
      }
      return { items: [], firstPagePayload: null };
    });
    const fetchMock = mockMetadataResponses(async () => Response.json({ customers: [] }));
    global.fetch = vi.fn(async (input: RequestInfo | URL) => input === '/api/quotes/project-numbers'
      ? Response.json({ error: 'You must be signed in to use quotes.' }, { status: 401 })
      : fetchMock(input));
    render(<QuotesPage />);

    await screen.findByText('Redirecting to sign in...');
    expect(recoverFromAuthFailureMock).toHaveBeenCalledExactlyOnceWith({ statusCode: 401 });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Quote projects')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();
  });

  it('discards an old successful customer response arriving after a metadata 401 and recovery', async () => {
    allowCustomers();
    searchParamsMock = new URLSearchParams('tab=current');
    recoverFromAuthFailureMock.mockResolvedValue(true);
    let resolveCustomers!: (response: Response) => void;
    const customerResponses = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveCustomers = resolve; }))
      .mockResolvedValue(Response.json({ customers: [], managerOptions: [], approvers: [] }));
    const metadataResponse = vi.fn()
      .mockResolvedValueOnce(Response.json({ managerOptions: [], approvers: [] }))
      .mockResolvedValueOnce(Response.json({ error: 'You must be signed in to use quotes.' }, { status: 401 }))
      .mockResolvedValue(Response.json({ managerOptions: [], approvers: [] }));
    mockMetadataResponses(customerResponses, metadataResponse);
    const { rerender } = render(<QuotesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'New Quote' }));
    await waitFor(() => expect(customerResponses).toHaveBeenCalledTimes(1));
    searchParamsMock = new URLSearchParams('tab=current&customer_id=another-customer');
    rerender(<QuotesPage />);
    await waitFor(() => expect(metadataResponse).toHaveBeenCalledTimes(3));
    await screen.findByRole('button', { name: 'New Quote' });
    await act(async () => {
      resolveCustomers(Response.json({
        customers: [{ id: 'stale-customer', company_name: 'Example customer' }],
        managerOptions: [{ profile_id: 'stale-manager' }],
        approvers: [{ id: 'stale-approver' }],
      }));
    });
    expect(screen.queryByTestId('quote-form-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New Quote' }));
    await screen.findByTestId('quote-form-dialog');
    expect(customerResponses).toHaveBeenCalledTimes(2);
    expect(quoteFormDialogMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      customers: [], managerOptions: [], approvers: [],
    }));
  });

  it('disables the new quote button when the user cannot access customers', async () => {
    render(<QuotesPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New Quote' })).toBeDisabled();
    });

    expect(screen.getByText('Customer access is required to create quotes.')).toBeInTheDocument();
    expect(
      mockFetchAllPaginatedItems.mock.calls.some(([endpoint]) => endpoint === '/api/quotes')
    ).toBe(true);
    expect(
      mockFetchAllPaginatedItems.mock.calls.some(([endpoint]) => endpoint === '/api/customers')
    ).toBe(false);
  });

  it('loads customers before opening the new quote form when initial metadata omits them', async () => {
    mockUsePermissionCheck.mockImplementation((moduleName: string) => {
      if (moduleName === 'quotes' || moduleName === 'customers') {
        return { hasPermission: true, loading: false };
      }

      return { hasPermission: false, loading: false };
    });

    const customer = {
      id: 'customer-1',
      company_name: 'Acme Ltd',
      short_name: null,
      contact_name: 'Alice Example',
      contact_email: 'alice@example.com',
      address_line_1: '1 Example Street',
      address_line_2: null,
      city: 'Nottingham',
      county: null,
      postcode: 'NG1 1AA',
      default_validity_days: 30,
      secondary_contacts: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === '/api/quotes/metadata?include_customers=true') {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
            customers: [customer],
          }),
        } as Response;
      }

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<QuotesPage />);

    const newQuoteButton = await screen.findByRole('button', { name: 'New Quote' });
    await waitFor(() => expect(newQuoteButton).not.toBeDisabled());

    fireEvent.click(newQuoteButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/quotes/metadata?include_customers=true');
      expect(screen.getByTestId('quote-form-dialog')).toBeInTheDocument();
    });
    expect(quoteFormDialogMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      customers: [customer],
    }));
  });

  it('does not log transient customer metadata fetch failures as console errors', async () => {
    mockUsePermissionCheck.mockImplementation((moduleName: string) => {
      if (moduleName === 'quotes' || moduleName === 'customers') {
        return { hasPermission: true, loading: false };
      }

      return { hasPermission: false, loading: false };
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === '/api/quotes/metadata?include_customers=true') {
        throw new TypeError('Load failed');
      }

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      render(<QuotesPage />);

      const newQuoteButton = await screen.findByRole('button', { name: 'New Quote' });
      await waitFor(() => expect(newQuoteButton).not.toBeDisabled());

      fireEvent.click(newQuoteButton);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/quotes/metadata?include_customers=true');
      });
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        'Error fetching quote customers:',
        expect.any(TypeError),
        expect.objectContaining({ errorContextId: 'quotes-fetch-customers-error' })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('renders quote page tabs in the requested order', async () => {
    render(<QuotesPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New Quote' })).toBeDisabled();
    });

    const tabNames = screen
      .getAllByRole('tab')
      .map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());

    expect(tabNames.slice(0, 6)).toEqual(['Overview', 'Current', 'Projects', 'Archived', 'Legacy', 'Settings']);
    expect(screen.queryByRole('tab', { name: 'Legacy Quotes' })).not.toBeInTheDocument();
  });

  it('passes only current quotes into the current table', async () => {
    searchParamsMock = new URLSearchParams('tab=current');
    mockFetchAllPaginatedItems.mockImplementation(async (endpoint: string) => ({
      items: endpoint === '/api/quotes'
        ? [
          {
            id: 'current-open',
            quote_reference: '50001-LC',
            requester_id: 'current-manager',
            manager_name: 'Current Manager',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'archived-commercial',
            quote_reference: '50002-LC',
            requester_id: 'archived-manager',
            manager_name: 'Archived Manager',
            status: 'sent',
            commercial_status: 'closed',
          },
          {
            id: 'archived-status',
            quote_reference: '50003-LC',
            requester_id: 'archived-status-manager',
            manager_name: 'Archived Status Manager',
            status: 'closed',
            commercial_status: 'open',
          },
        ]
        : [],
      firstPagePayload: null,
    }));

    render(<QuotesPage />);

    await waitFor(() => {
      expect(quotesTableMock).toHaveBeenCalled();
    });

    const props = quotesTableMock.mock.calls.at(-1)?.[0] as { quotes: Array<{ id: string }> };
    expect(props.quotes.map((quote) => quote.id)).toEqual(['current-open']);
  });

  it('passes only archived quotes into the archived table and manager tabs', async () => {
    searchParamsMock = new URLSearchParams('tab=archived');
    mockFetchAllPaginatedItems.mockImplementation(async (endpoint: string) => ({
      items: endpoint === '/api/quotes'
        ? [
          {
            id: 'current-open',
            quote_reference: '50001-LC',
            requester_id: 'current-manager',
            manager_name: 'Current Manager',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'archived-commercial',
            quote_reference: '50002-LC',
            requester_id: 'archived-manager',
            manager_name: 'Archived Manager',
            status: 'sent',
            commercial_status: 'closed',
          },
          {
            id: 'archived-status',
            quote_reference: '50003-LC',
            requester_id: 'archived-status-manager',
            manager_name: 'Archived Status Manager',
            status: 'closed',
            commercial_status: 'open',
          },
        ]
        : [],
      firstPagePayload: null,
    }));

    render(<QuotesPage />);

    await waitFor(() => {
      expect(quotesTableMock).toHaveBeenCalled();
    });

    const props = quotesTableMock.mock.calls.at(-1)?.[0] as { quotes: Array<{ id: string }>; emptyMessage?: string };
    expect(props.quotes.map((quote) => quote.id)).toEqual(['archived-commercial', 'archived-status']);
    expect(props.emptyMessage).toBe('No archived quotes yet.');
    expect(screen.getByRole('tab', { name: 'Archived Manager' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Archived Status Manager' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Current Manager' })).not.toBeInTheDocument();
  });

  it('renders current manager tabs from quotes instead of all manager metadata', async () => {
    searchParamsMock = new URLSearchParams('tab=current');
    mockFetchAllPaginatedItems.mockImplementation(async (endpoint: string) => ({
      items: endpoint === '/api/quotes'
        ? [
          {
            id: 'quote-with-manager',
            requester_id: 'manager-with-quote',
            requester_initials: 'LC',
            manager_name: 'Louis Cree',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'quote-name-only-manager',
            requester_id: null,
            requester_initials: null,
            manager_name: 'Name Only Manager',
            status: 'sent',
            commercial_status: 'open',
          },
          {
            id: 'quote-without-manager-label',
            requester_id: null,
            requester_initials: null,
            manager_name: '   ',
            status: 'sent',
            commercial_status: 'open',
          },
        ]
        : [],
      firstPagePayload: null,
    }));

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/quotes/metadata')) {
        return {
          ok: true,
          json: async () => ({
            managerOptions: [
              {
                profile_id: 'manager-with-quote',
                initials: 'LC',
                signoff_name: null,
                is_active: true,
                profile: { full_name: 'Louis Cree' },
              },
              {
                profile_id: 'manager-without-quote',
                initials: 'MD',
                signoff_name: null,
                is_active: true,
                profile: { full_name: 'Matt Duffill' },
              },
            ],
            approvers: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;

    render(<QuotesPage />);

    const louisTab = await screen.findByRole('tab', { name: 'Louis Cree' });
    expect(screen.getByRole('tab', { name: 'All Quotes' })).toBeInTheDocument();
    expect(louisTab).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Name Only Manager' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Matt Duffill' })).not.toBeInTheDocument();

    act(() => {
      fireEvent.mouseDown(louisTab, { button: 0, ctrlKey: false });
    });

    expect(replaceMock).toHaveBeenCalledWith('/quotes?tab=current&manager=manager-with-quote', { scroll: false });
  });
});
