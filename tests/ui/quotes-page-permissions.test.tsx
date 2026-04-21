/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import QuotesPage from '@/app/(dashboard)/quotes/page';

const replaceMock = vi.fn();
const pushMock = vi.fn();
const mockUsePermissionCheck = vi.fn();
const mockFetchAllPaginatedItems = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  usePathname: () => '/quotes',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: (moduleName: string, redirectOnFail?: boolean) =>
    mockUsePermissionCheck(moduleName, redirectOnFail),
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

vi.mock('@/app/(dashboard)/quotes/components/QuotesTable', () => ({
  QuotesTable: () => <div>Quotes table</div>,
}));

vi.mock('@/app/(dashboard)/quotes/components/QuoteDetailsModal', () => ({
  QuoteDetailsModal: () => null,
}));

vi.mock('@/app/(dashboard)/quotes/components/QuoteFormDialog', () => ({
  QuoteFormDialog: () => null,
}));

describe('Quotes page customer access states', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
});
