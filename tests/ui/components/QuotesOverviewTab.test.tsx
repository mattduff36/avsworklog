/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuotesOverviewTab } from '@/app/(dashboard)/quotes/components/QuotesOverviewTab';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('QuotesOverviewTab', () => {
  it('OV-003: failed fetch shows error and retry, not empty activity copy', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'Unable to load quotes overview right now.' }, 500))
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<QuotesOverviewTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load quotes overview right now.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No recent quote or job activity found.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load quotes overview right now.');
    expect(screen.queryByText('No recent quote or job activity found.')).not.toBeInTheDocument();
  });
});
